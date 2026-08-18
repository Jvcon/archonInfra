/**
 * VLAN 路径验证引擎（前端版）
 * 使用 Graphology BFS + Dexie 查询替代 SQL 查询
 * 业务逻辑与 worker/vlan-validation.ts 完全一致
 */
import { infraGraph } from '../graph';
import { db } from '../db';
import type { VLANPathValidationResult, VLANPathHop, VLANPathIssue } from '../../types';

interface PathNode {
  entityId: string;
  inIfaceId: string | null;
  outIfaceId: string | null;
}

/** BFS 在物理子图上寻找最短路径 */
function findPhysicalPath(sourceId: string, targetId: string): PathNode[] | null {
  if (!infraGraph.hasNode(sourceId) || !infraGraph.hasNode(targetId)) return null;

  const visited = new Set<string>();
  const queue: Array<{ entityId: string; path: PathNode[] }> = [];
  visited.add(sourceId);
  queue.push({ entityId: sourceId, path: [{ entityId: sourceId, inIfaceId: null, outIfaceId: null }] });

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.entityId === targetId) return current.path;

    infraGraph.forEachEdge(current.entityId, (_edge, attrs, source, target) => {
      if (attrs.type !== 'physical') return;
      const neighbor = source === current.entityId ? target : source;
      if (visited.has(neighbor)) return;
      visited.add(neighbor);

      const srcIface = source === current.entityId ? attrs.srcIface : attrs.tgtIface;
      const tgtIface = source === current.entityId ? attrs.tgtIface : attrs.srcIface;

      const newPath = [...current.path];
      const lastNode = newPath[newPath.length - 1];
      if (lastNode) {
        newPath[newPath.length - 1] = { ...lastNode, outIfaceId: srcIface ?? null };
      }
      newPath.push({ entityId: neighbor, inIfaceId: tgtIface ?? null, outIfaceId: null });
      queue.push({ entityId: neighbor, path: newPath });
    });
  }
  return null;
}

/** 检查非交换机设备的物理端口是否有匹配 VLAN 的逻辑子接口 */
async function hasLogicalInterfaceForVlan(entityId: string, interfaceId: string | null, vlanId: number): Promise<{ found: boolean; ifaceName?: string }> {
  if (!interfaceId) {
    const row = await db.logical_interfaces
      .where('entity_id').equals(entityId)
      .filter(li => li.type === 'vlan_sub' && li.vlan_id === vlanId)
      .first();
    return row ? { found: true, ifaceName: row.name } : { found: false };
  }
  const row = await db.logical_interfaces
    .where('entity_id').equals(entityId)
    .filter(li => li.physical_port_id === interfaceId && li.type === 'vlan_sub' && li.vlan_id === vlanId)
    .first();
  return row ? { found: true, ifaceName: row.name } : { found: false };
}

/** 从 switch_port_vlans 关联表获取端口允许的 VLAN ID */
async function getPortAllowedVlans(switchPortId: string): Promise<number[]> {
  const rows = await db.switch_port_vlans.where('switch_port_id').equals(switchPortId).toArray();
  return rows.map(r => r.vlan_id);
}

/** 解析 allowed_vlans 字符串 */
async function parseAllowedVlans(allowedStr: string | null): Promise<number[]> {
  if (!allowedStr || allowedStr.trim() === '') return [];
  if (allowedStr.trim() === 'all') {
    const rows = await db.vlans.toArray();
    return rows.map(r => r.id);
  }
  return allowedStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
}

/** 根据 interface_id 查找对应的 switch_port 配置 */
async function getPortConfigByInterface(interfaceId: string | null) {
  if (!interfaceId) return null;
  return db.switch_ports.where('interface_id').equals(interfaceId).first() ?? null;
}

/** 检查 VLAN 是否在端口的允许范围内 */
async function isVlanAllowedOnPort(port: { id: string; mode: string; vlan_id: number | null; native_vlan_id: number | null; allowed_vlans: string }, vlanId: number): Promise<boolean> {
  const allowed = await getPortAllowedVlans(port.id);
  if (allowed.length > 0) return allowed.includes(vlanId);
  if (port.mode === 'access') return port.vlan_id === vlanId;
  if (port.native_vlan_id === vlanId) return true;
  const parsedAllowed = await parseAllowedVlans(port.allowed_vlans);
  return parsedAllowed.includes(vlanId);
}

/**
 * 验证指定 VLAN 在两设备间的完整路径是否能正确透传
 */
export async function validateVLANPath(sourceEntityId: string, targetEntityId: string, vlanId: number): Promise<VLANPathValidationResult> {
  const issues: VLANPathIssue[] = [];

  const rawPath = findPhysicalPath(sourceEntityId, targetEntityId);
  if (!rawPath || rawPath.length === 0) {
    return {
      valid: false, path: [], target_vlan_id: vlanId,
      issues: [{ severity: 'error', type: 'vlan_unreachable', message: '源设备和目标设备之间没有物理链路路径', hop_index: -1, related_entities: [sourceEntityId, targetEntityId] }],
    };
  }

  const hops: VLANPathHop[] = [];
  for (let i = 0; i < rawPath.length; i++) {
    const node = rawPath[i]!;
    const entity = await db.entities.get(node.entityId);
    if (!entity) continue;

    const isSwitch = entity.category === 'switch';
    const isRouter = entity.category === 'router' || entity.category === 'server';
    const relevantIfaceId = i === 0 ? node.outIfaceId : node.inIfaceId;

    if (!isSwitch && !isRouter) {
      hops.push({ entity_id: entity.id, entity_name: entity.name, interface_id: relevantIfaceId, port_mode: 'endpoint', native_vlan_id: null, allowed_vlans: [], access_vlan_id: null });
      continue;
    }

    if (isRouter) {
      const logicalCheck = await hasLogicalInterfaceForVlan(entity.id, relevantIfaceId, vlanId);
      hops.push({ entity_id: entity.id, entity_name: entity.name, interface_id: relevantIfaceId, port_mode: logicalCheck.found ? 'trunk' : 'endpoint', native_vlan_id: null, allowed_vlans: logicalCheck.found ? [vlanId] : [], access_vlan_id: null });

      if (!logicalCheck.found && i > 0 && i < rawPath.length - 1) {
        issues.push({ severity: 'error', type: 'vlan_not_allowed', message: `设备 "${entity.name}" 没有 VLAN ${vlanId} 的子接口，无法转发该 VLAN 流量`, hop_index: i, related_entities: [entity.id] });
      } else if (!logicalCheck.found && (i === 0 || i === rawPath.length - 1)) {
        issues.push({ severity: 'warning', type: 'port_unconfigured', message: `设备 "${entity.name}" 没有 VLAN ${vlanId} 的子接口`, hop_index: i, related_entities: [entity.id] });
      }
      continue;
    }

    // 交换机
    const inPort = await getPortConfigByInterface(node.inIfaceId);
    const outPort = await getPortConfigByInterface(node.outIfaceId);
    const displayPort = inPort || outPort;

    hops.push({
      entity_id: entity.id, entity_name: entity.name, interface_id: relevantIfaceId,
      port_mode: displayPort ? (displayPort.mode as 'access' | 'trunk') : 'endpoint',
      native_vlan_id: displayPort?.native_vlan_id ?? null,
      allowed_vlans: displayPort ? await parseAllowedVlans(displayPort.allowed_vlans) : [],
      access_vlan_id: displayPort?.vlan_id ?? null,
    });

    if (inPort && i > 0) {
      if (!await isVlanAllowedOnPort(inPort, vlanId)) {
        issues.push({ severity: 'error', type: 'vlan_not_allowed', message: `交换机 "${entity.name}" 入口端口(${inPort.port_number}) 不允许 VLAN ${vlanId} 通过（模式: ${inPort.mode}）`, hop_index: i, related_entities: [entity.id] });
      }
    } else if (!inPort && i > 0 && i < rawPath.length - 1) {
      issues.push({ severity: 'warning', type: 'port_unconfigured', message: `交换机 "${entity.name}" 入口端口未配置 VLAN`, hop_index: i, related_entities: [entity.id] });
    }

    if (outPort && i < rawPath.length - 1) {
      if (!await isVlanAllowedOnPort(outPort, vlanId)) {
        issues.push({ severity: 'error', type: 'vlan_not_allowed', message: `交换机 "${entity.name}" 出口端口(${outPort.port_number}) 不允许 VLAN ${vlanId} 通过（模式: ${outPort.mode}）`, hop_index: i, related_entities: [entity.id] });
      }
    } else if (!outPort && i < rawPath.length - 1 && i > 0) {
      issues.push({ severity: 'warning', type: 'port_unconfigured', message: `交换机 "${entity.name}" 出口端口未配置 VLAN`, hop_index: i, related_entities: [entity.id] });
    }
  }

  // Native VLAN 一致性检查
  for (let i = 0; i < rawPath.length - 1; i++) {
    const currNode = rawPath[i]!;
    const nextNode = rawPath[i + 1]!;
    const currEntity = await db.entities.get(currNode.entityId);
    const nextEntity = await db.entities.get(nextNode.entityId);
    if (currEntity?.category !== 'switch' || nextEntity?.category !== 'switch') continue;

    const currOutPort = await getPortConfigByInterface(currNode.outIfaceId);
    const nextInPort = await getPortConfigByInterface(nextNode.inIfaceId);

    if (currOutPort?.mode === 'trunk' && nextInPort?.mode === 'trunk') {
      if (currOutPort.native_vlan_id !== nextInPort.native_vlan_id) {
        issues.push({ severity: 'warning', type: 'native_mismatch', message: `Trunk 链路两端 Native VLAN 不一致: ${currOutPort.native_vlan_id || '无'} ↔ ${nextInPort.native_vlan_id || '无'}`, hop_index: i, related_entities: [currNode.entityId, nextNode.entityId] });
      }
    }

    if (currOutPort?.mode === 'access' && nextInPort?.mode === 'trunk') {
      if (currOutPort.vlan_id && currOutPort.vlan_id !== nextInPort.native_vlan_id) {
        const allowed = await parseAllowedVlans(nextInPort.allowed_vlans);
        if (!allowed.includes(currOutPort.vlan_id)) {
          issues.push({ severity: 'error', type: 'mode_incompatible', message: `Access 端口(VLAN ${currOutPort.vlan_id}) 连接 Trunk 端口，但该 VLAN 既不是 Native 也不在 Allowed 列表中`, hop_index: i, related_entities: [currNode.entityId, nextNode.entityId] });
        }
      }
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  return { valid: errors === 0, path: hops, target_vlan_id: vlanId, issues };
}
