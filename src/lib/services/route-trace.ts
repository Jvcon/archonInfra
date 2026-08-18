/**
 * 路由路径追踪引擎（前端版）
 * 使用 Dexie 查询替代 D1 SQL
 * 业务逻辑与 worker/route-trace.ts 完全一致
 */
import { db } from '../db';
import { isInSubnet, parseCIDR } from '../network-utils';
import type { RouteTraceResult, RouteHop, NatAction, RouteDiagnostic } from '../../types';

interface TraceOptions {
  src_entity_id?: string;
  protocol?: string;
  dst_port?: string;
}

const MAX_HOPS = 32;

/** 通过 IP 地址定位所属设备 */
async function findEntityByIP(ip: string): Promise<{ entity_id: string; entity_name: string; category: string } | null> {
  const ipRow = await db.ip_addresses.where('address').equals(ip).first();
  if (ipRow?.entity_id) {
    const entity = await db.entities.get(ipRow.entity_id);
    if (entity) return { entity_id: entity.id, entity_name: entity.name, category: entity.category };
  }

  const li = await db.logical_interfaces.filter(l => l.ip_address === ip).first();
  if (li) {
    const entity = await db.entities.get(li.entity_id);
    if (entity) return { entity_id: entity.id, entity_name: entity.name, category: entity.category };
  }

  const subnet = await db.subnets.filter(s => s.gateway === ip && !!s.entity_id).first();
  if (subnet?.entity_id) {
    const entity = await db.entities.get(subnet.entity_id);
    if (entity) return { entity_id: entity.id, entity_name: entity.name, category: entity.category };
  }
  return null;
}

/** 通过网段查找网关设备 */
async function findEntityBySubnet(cidr: string): Promise<{ entity_id: string; entity_name: string; category: string } | null> {
  const subnet = await db.subnets.filter(s => s.cidr === cidr && !!s.entity_id).first();
  if (!subnet?.entity_id) return null;
  const entity = await db.entities.get(subnet.entity_id);
  if (!entity) return null;
  return { entity_id: entity.id, entity_name: entity.name, category: entity.category };
}

/** 查找 IP 所属子网的网关设备 */
async function findGatewayForIP(ip: string): Promise<{ entity_id: string; entity_name: string; category: string } | null> {
  const subnets = await db.subnets.filter(s => !!s.entity_id && !!s.cidr).toArray();
  for (const s of subnets) {
    if (isInSubnet(ip, s.cidr)) {
      const entity = await db.entities.get(s.entity_id!);
      if (entity) return { entity_id: entity.id, entity_name: entity.name, category: entity.category };
    }
  }
  return null;
}

/** 获取 CIDR 前缀长度 */
function getPrefixLength(cidr: string): number {
  try { return parseCIDR(cidr).prefix; } catch { return -1; }
}

/** 在设备路由表中做最长前缀匹配 */
async function longestPrefixMatch(entityId: string, destIP: string): Promise<Array<{ destination: string; next_hop: string; out_interface: string; metric: number }>> {
  const routes = await db.static_routes
    .where('entity_id').equals(entityId)
    .filter(r => r.enabled === 1)
    .toArray();

  const matched = routes.filter(r => isInSubnet(destIP, r.destination));
  if (matched.length === 0) return [];

  const maxPrefix = Math.max(...matched.map(r => getPrefixLength(r.destination)));
  const best = matched.filter(r => getPrefixLength(r.destination) === maxPrefix);
  best.sort((a, b) => a.metric - b.metric);
  return best.map(r => ({ destination: r.destination, next_hop: r.next_hop, out_interface: r.out_interface, metric: r.metric }));
}

/** 评估 NAT 规则 */
async function evaluateNatRules(entityId: string, srcIP: string, dstIP: string, direction: 'pre' | 'post'): Promise<NatAction[]> {
  const actions: NatAction[] = [];
  try {
    const rules = await db.nat_rules
      .where('entity_id').equals(entityId)
      .filter(r => r.enabled === 1)
      .toArray();
    rules.sort((a, b) => a.priority - b.priority);

    for (const rule of rules) {
      if (direction === 'pre' && rule.nat_type === 'dnat') {
        if (rule.dest_ip && rule.translate_ip) {
          const cidr = rule.dest_ip.includes('/') ? rule.dest_ip : rule.dest_ip + '/32';
          if (isInSubnet(dstIP, cidr)) {
            actions.push({ nat_type: 'dnat', original_ip: dstIP, translated_ip: rule.translate_ip, rule_description: rule.description || 'DNAT' });
          }
        }
      } else if (direction === 'post' && (rule.nat_type === 'snat' || rule.nat_type === 'masquerade')) {
        if (rule.src_ip) {
          const cidr = rule.src_ip.includes('/') ? rule.src_ip : rule.src_ip + '/32';
          if (isInSubnet(srcIP, cidr)) {
            const translated = rule.nat_type === 'masquerade' ? '(出接口IP)' : (rule.translate_ip || '(出接口IP)');
            actions.push({ nat_type: rule.nat_type as 'snat' | 'masquerade', original_ip: srcIP, translated_ip: translated, rule_description: rule.description || rule.nat_type.toUpperCase() });
          }
        }
      }
    }
  } catch { /* ignore */ }
  return actions;
}

/** 解析下一跳 IP 对应的设备 */
async function resolveNextHop(nextHopIP: string): Promise<{ entity_id: string; entity_name: string; category: string; in_interface: string | null } | null> {
  const li = await db.logical_interfaces.filter(l => l.ip_address === nextHopIP).first();
  if (li) {
    const entity = await db.entities.get(li.entity_id);
    if (entity) return { entity_id: entity.id, entity_name: entity.name, category: entity.category, in_interface: li.name };
  }
  const fromIA = await findEntityByIP(nextHopIP);
  if (fromIA) return { ...fromIA, in_interface: null };
  return null;
}

/** 检查目标 IP 是否属于设备的直连子网 */
async function isDirectlyConnected(entityId: string, destIP: string): Promise<boolean> {
  try {
    const subnets = await db.subnets.filter(s => s.entity_id === entityId).toArray();
    for (const s of subnets) {
      if (s.cidr && isInSubnet(destIP, s.cidr)) return true;
    }
    const ifaces = await db.logical_interfaces
      .where('entity_id').equals(entityId)
      .filter(li => !!li.ip_address)
      .toArray();
    for (const iface of ifaces) {
      if (!iface.ip_address) continue;
      for (const s of subnets) {
        if (s.cidr && isInSubnet(iface.ip_address, s.cidr) && isInSubnet(destIP, s.cidr)) return true;
      }
      try {
        const parts = iface.ip_address.split('.');
        if (parts.length === 4) {
          const ifaceSubnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          if (isInSubnet(destIP, ifaceSubnet)) return true;
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return false;
}

// ===== 主函数 =====

/** 追踪路由路径 */
export async function traceRoutePath(srcIP: string, dstIP: string, opts?: TraceOptions): Promise<RouteTraceResult> {
  const diagnostics: RouteDiagnostic[] = [];
  const paths: { hops: RouteHop[] }[] = [];
  let hasNat = false;
  let hasLoop = false;

  try {
    const isCIDR = srcIP.includes('/');
    let displaySrcIP: string;
    let startEntity: { entity_id: string; entity_name: string; category: string } | null = null;

    if (opts?.src_entity_id) {
      const e = await db.entities.get(opts.src_entity_id);
      startEntity = e ? { entity_id: e.id, entity_name: e.name, category: e.category } : null;
      displaySrcIP = srcIP;
    } else if (isCIDR) {
      startEntity = await findEntityBySubnet(srcIP);
      const slashIndex = srcIP.indexOf('/');
      displaySrcIP = slashIndex > 0 ? srcIP.substring(0, slashIndex) : srcIP;
    } else {
      startEntity = await findEntityByIP(srcIP);
      displaySrcIP = srcIP;
    }

    if (!startEntity) {
      diagnostics.push({ severity: 'error', type: 'no_route', message: `无法定位源 IP ${displaySrcIP} 所属设备`, at_hop: 0, entity_id: '' });
      return { paths: [], diagnostics, summary: { reachable: false, hop_count: 0, has_nat: false, has_loop: false } };
    }

    const terminalCategories = ['pc', 'phone', 'iot', 'camera', 'printer', 'server', 'nas', 'vm', 'ap'];
    if (terminalCategories.includes(startEntity.category)) {
      const gwEntity = await findGatewayForIP(displaySrcIP);
      if (gwEntity) {
        diagnostics.push({ severity: 'info', type: 'no_route', message: `终端设备 ${startEntity.entity_name} 通过默认网关转发`, at_hop: 0, entity_id: startEntity.entity_id });
        startEntity = gwEntity;
      }
    }

    const targetIP = dstIP.includes('/') ? dstIP.split('/')[0]! : dstIP;

    async function trace(entityId: string, entityName: string, category: string, packetSrc: string, packetDst: string, inIface: string | null, visited: Set<string>, currentHops: RouteHop[]): Promise<void> {
      const visitKey = `${entityId}:${packetDst}`;
      if (visited.has(visitKey)) {
        hasLoop = true;
        diagnostics.push({ severity: 'error', type: 'loop_detected', message: `检测到环路：数据包在设备 ${entityName} 循环`, at_hop: currentHops.length, entity_id: entityId });
        paths.push({ hops: [...currentHops] });
        return;
      }
      if (currentHops.length >= MAX_HOPS) {
        diagnostics.push({ severity: 'error', type: 'loop_detected', message: `超过最大跳数 ${MAX_HOPS}`, at_hop: currentHops.length, entity_id: entityId });
        paths.push({ hops: [...currentHops] });
        return;
      }

      visited.add(visitKey);

      const dnatActions = await evaluateNatRules(entityId, packetSrc, packetDst, 'pre');
      let effectiveDst = packetDst;
      if (dnatActions.length > 0) { hasNat = true; effectiveDst = dnatActions[0]!.translated_ip; }

      if (await isDirectlyConnected(entityId, effectiveDst)) {
        const snatActions = await evaluateNatRules(entityId, packetSrc, effectiveDst, 'post');
        let effectiveSrc = packetSrc;
        if (snatActions.length > 0) { hasNat = true; effectiveSrc = snatActions[0]!.translated_ip; }
        const hop: RouteHop = {
          hop_index: currentHops.length, entity_id: entityId, entity_name: entityName, category,
          in_interface: inIface, out_interface: null,
          matched_route: { destination: '直连', next_hop: '', metric: 0 },
          nat_actions: [...dnatActions, ...snatActions],
          packet_src: effectiveSrc, packet_dst: effectiveDst,
        };
        paths.push({ hops: [...currentHops, hop] });
        return;
      }

      const matchedRoutes = await longestPrefixMatch(entityId, effectiveDst);
      if (matchedRoutes.length === 0) {
        const hop: RouteHop = {
          hop_index: currentHops.length, entity_id: entityId, entity_name: entityName, category,
          in_interface: inIface, out_interface: null,
          matched_route: null, nat_actions: dnatActions,
          packet_src: packetSrc, packet_dst: effectiveDst,
        };
        currentHops.push(hop);
        diagnostics.push({ severity: 'error', type: 'no_route', message: `设备 ${entityName} 无匹配路由到 ${effectiveDst}`, at_hop: currentHops.length - 1, entity_id: entityId });
        paths.push({ hops: [...currentHops] });
        return;
      }

      const snatActions = await evaluateNatRules(entityId, packetSrc, effectiveDst, 'post');
      let effectiveSrc = packetSrc;
      if (snatActions.length > 0) { hasNat = true; effectiveSrc = snatActions[0]!.translated_ip; }

      const bestMetric = matchedRoutes[0]!.metric;
      const equalRoutes = matchedRoutes.filter(r => r.metric === bestMetric);

      for (const route of equalRoutes) {
        const hop: RouteHop = {
          hop_index: currentHops.length, entity_id: entityId, entity_name: entityName, category,
          in_interface: inIface, out_interface: route.out_interface || null,
          matched_route: { destination: route.destination, next_hop: route.next_hop, metric: route.metric },
          nat_actions: [...dnatActions, ...snatActions],
          packet_src: effectiveSrc, packet_dst: effectiveDst,
        };
        const newHops = [...currentHops, hop];

        if (!route.next_hop) { paths.push({ hops: newHops }); return; }

        const nextHop = await resolveNextHop(route.next_hop);
        if (!nextHop) {
          diagnostics.push({ severity: 'warning', type: 'unreachable_next_hop', message: `设备 ${entityName} 的下一跳 ${route.next_hop} 无法解析到设备`, at_hop: currentHops.length, entity_id: entityId });
          paths.push({ hops: newHops });
          return;
        }
        await trace(nextHop.entity_id, nextHop.entity_name, nextHop.category, effectiveSrc, effectiveDst, nextHop.in_interface, new Set(visited), newHops);
      }
    }

    await trace(startEntity.entity_id, startEntity.entity_name, startEntity.category, displaySrcIP, targetIP, null, new Set(), []);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '路径计算异常';
    diagnostics.push({ severity: 'error', type: 'route_blackhole', message: msg, at_hop: 0, entity_id: '' });
  }

  const reachable = paths.length > 0 && diagnostics.filter(d => d.severity === 'error').length === 0;
  const hopCount = paths.length > 0 ? paths[0]!.hops.length : 0;
  return { paths, diagnostics, summary: { reachable, hop_count: hopCount, has_nat: hasNat, has_loop: hasLoop } };
}
