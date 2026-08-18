/**
 * WorkerDriver - 前端通过 fetch 调用 Cloudflare Worker 后端 API
 *
 * 鉴权：请求头 X-API-Key，值由用户在设置面板配置。
 * 本地 IndexedDB 作为读缓存，写操作先写本地再同步 Worker。
 *
 * API 端点约定（对应 worker/routes.ts 的路径）：
 *   GET/POST/PUT/DELETE /api/entities
 *   GET/POST/PUT/DELETE /api/vlans
 *   ... 等
 */
import type { StorageDriver, PaginationParams, PaginatedResult, InfraSnapshot } from './types';
import type {
  Entity, VLAN, Subnet, IPAddress, SwitchPort, Edge,
  NetworkInterface, LogicalInterface, WiFiSSID,
  FirewallZone, VlanPolicy, StaticRoute, NatRule,
} from '../../types';
import type { SwitchPortVlan } from '../db';
import { buildGraph, addNodeToGraph, removeNodeFromGraph, addEdgeToGraph, removeEdgeFromGraph } from '../graph';
import { db } from '../db';

export interface WorkerConfig {
  /** Worker 基础 URL，例如 https://archoninfra-worker.xxx.workers.dev */
  workerUrl: string;
  /** X-API-Key 鉴权头的值 */
  apiKey: string;
}

export class WorkerDriver implements StorageDriver {
  private config: WorkerConfig;

  constructor(config: WorkerConfig) {
    this.config = config;
  }

  // ─── HTTP 辅助 ────────────────────────────────────────────────────────────

  private get headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.config.apiKey,
    };
  }

  private url(path: string): string {
    // 支持带尾斜杠和不带尾斜杠的 workerUrl
    const base = this.config.workerUrl.replace(/\/$/, '');
    return `${base}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const resp = await fetch(this.url(path), {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new Error(`Worker API ${resp.status} ${path}: ${msg}`);
    }

    if (resp.status === 204) return undefined as T;
    return resp.json() as Promise<T>;
  }

  // ─── 初始化：从 Worker 全量拉取到本地 Dexie ───────────────────────────────

  async init(): Promise<void> {
    try {
      const snapshot = await this.request<InfraSnapshot>('GET', '/api/export');
      await db.transaction('rw', db.tables, async () => {
        for (const table of db.tables) await table.clear();
        if (snapshot.entities.length) await db.entities.bulkAdd(snapshot.entities);
        if (snapshot.vlans.length) await db.vlans.bulkAdd(snapshot.vlans);
        if (snapshot.subnets.length) await db.subnets.bulkAdd(snapshot.subnets);
        if (snapshot.ip_addresses.length) await db.ip_addresses.bulkAdd(snapshot.ip_addresses);
        if (snapshot.switch_ports.length) await db.switch_ports.bulkAdd(snapshot.switch_ports);
        if (snapshot.switch_port_vlans.length) await db.switch_port_vlans.bulkAdd(snapshot.switch_port_vlans);
        if (snapshot.network_interfaces.length) await db.network_interfaces.bulkAdd(snapshot.network_interfaces);
        if (snapshot.logical_interfaces.length) await db.logical_interfaces.bulkAdd(snapshot.logical_interfaces);
        if (snapshot.wifi_ssids.length) await db.wifi_ssids.bulkAdd(snapshot.wifi_ssids);
        if (snapshot.firewall_zones.length) await db.firewall_zones.bulkAdd(snapshot.firewall_zones);
        if (snapshot.vlan_policies.length) await db.vlan_policies.bulkAdd(snapshot.vlan_policies);
        if (snapshot.static_routes.length) await db.static_routes.bulkAdd(snapshot.static_routes);
        if (snapshot.nat_rules.length) await db.nat_rules.bulkAdd(snapshot.nat_rules);
        if (snapshot.edges.length) await db.edges.bulkAdd(snapshot.edges);
      });
    } catch (e) {
      // Worker 不可达时降级为本地缓存继续运行
      console.warn('WorkerDriver init: Worker 不可达，使用本地缓存', e);
    }
    await buildGraph();
  }

  // ─── 实体 ─────────────────────────────────────────────────────────────────

  async getEntities(filter?: { type?: string; category?: string }, pagination?: PaginationParams): Promise<PaginatedResult<Entity>> {
    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 50;
    let collection = db.entities.toCollection();
    if (filter?.type) collection = db.entities.where('type').equals(filter.type);
    if (filter?.category) collection = db.entities.where('category').equals(filter.category);
    const total = await collection.count();
    const data = await collection.offset((page - 1) * pageSize).limit(pageSize).toArray();
    return { data, total, page, pageSize };
  }

  async getEntity(id: string): Promise<Entity | undefined> {
    return db.entities.get(id);
  }

  async saveEntity(entity: Entity): Promise<void> {
    await db.entities.put(entity);
    addNodeToGraph(entity);
    this.request('POST', '/api/entities', entity).catch(console.error);
  }

  async updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
    await db.entities.update(id, { ...updates, updated_at: new Date().toISOString() });
    const updated = await db.entities.get(id);
    if (updated) {
      addNodeToGraph(updated);
      this.request('PUT', `/api/entities/${id}`, updates).catch(console.error);
    }
  }

  async deleteEntity(id: string): Promise<void> {
    await db.transaction('rw', [db.entities, db.edges, db.network_interfaces, db.logical_interfaces, db.switch_ports, db.ip_addresses, db.wifi_ssids, db.static_routes, db.nat_rules], async () => {
      await db.edges.where('source_id').equals(id).delete();
      await db.edges.where('target_id').equals(id).delete();
      await db.network_interfaces.where('entity_id').equals(id).delete();
      await db.logical_interfaces.where('entity_id').equals(id).delete();
      await db.switch_ports.where('switch_id').equals(id).delete();
      await db.ip_addresses.where('entity_id').equals(id).delete();
      await db.wifi_ssids.where('entity_id').equals(id).delete();
      await db.static_routes.where('entity_id').equals(id).delete();
      await db.nat_rules.where('entity_id').equals(id).delete();
      await db.entities.delete(id);
    });
    removeNodeFromGraph(id);
    this.request('DELETE', `/api/entities/${id}`).catch(console.error);
  }

  // ─── VLAN ──────────────────────────────────────────────────────────────────

  async getVlans(): Promise<VLAN[]> { return db.vlans.toArray(); }

  async saveVlan(vlan: VLAN): Promise<void> {
    await db.vlans.put(vlan);
    this.request('POST', '/api/vlans', vlan).catch(console.error);
  }

  async updateVlan(id: number, updates: Partial<VLAN>): Promise<void> {
    await db.vlans.update(id, updates);
    this.request('PUT', `/api/vlans/${id}`, updates).catch(console.error);
  }

  async deleteVlan(id: number): Promise<void> {
    await db.switch_port_vlans.where('vlan_id').equals(id).delete();
    await db.vlans.delete(id);
    this.request('DELETE', `/api/vlans/${id}`).catch(console.error);
  }

  // ─── 子网 ──────────────────────────────────────────────────────────────────

  async getSubnets(filter?: { vlan_id?: number }): Promise<Subnet[]> {
    if (filter?.vlan_id != null) return db.subnets.where('vlan_id').equals(filter.vlan_id).toArray();
    return db.subnets.toArray();
  }

  async saveSubnet(subnet: Subnet): Promise<void> {
    await db.subnets.put(subnet);
    this.request('POST', '/api/subnets', subnet).catch(console.error);
  }

  async updateSubnet(id: string, updates: Partial<Subnet>): Promise<void> {
    await db.subnets.update(id, updates);
    this.request('PUT', `/api/subnets/${id}`, updates).catch(console.error);
  }

  async deleteSubnet(id: string): Promise<void> {
    await db.ip_addresses.where('subnet_id').equals(id).delete();
    await db.subnets.delete(id);
    this.request('DELETE', `/api/subnets/${id}`).catch(console.error);
  }

  // ─── IP 地址 ───────────────────────────────────────────────────────────────

  async getIPAddresses(filter?: { subnet_id?: string; entity_id?: string }): Promise<IPAddress[]> {
    if (filter?.subnet_id) return db.ip_addresses.where('subnet_id').equals(filter.subnet_id).toArray();
    if (filter?.entity_id) return db.ip_addresses.where('entity_id').equals(filter.entity_id).toArray();
    return db.ip_addresses.toArray();
  }

  async saveIPAddress(ip: IPAddress): Promise<void> {
    await db.ip_addresses.put(ip);
    this.request('POST', '/api/ip-addresses', ip).catch(console.error);
  }

  async updateIPAddress(id: string, updates: Partial<IPAddress>): Promise<void> {
    await db.ip_addresses.update(id, updates);
    this.request('PUT', `/api/ip-addresses/${id}`, updates).catch(console.error);
  }

  async deleteIPAddress(id: string): Promise<void> {
    await db.ip_addresses.delete(id);
    this.request('DELETE', `/api/ip-addresses/${id}`).catch(console.error);
  }

  // ─── 网口 ──────────────────────────────────────────────────────────────────

  async getNetworkInterfaces(entity_id: string): Promise<NetworkInterface[]> {
    return db.network_interfaces.where('entity_id').equals(entity_id).toArray();
  }

  async saveNetworkInterface(iface: NetworkInterface): Promise<void> {
    await db.network_interfaces.put(iface);
    this.request('POST', '/api/network-interfaces', iface).catch(console.error);
  }

  async deleteNetworkInterface(id: string): Promise<void> {
    await db.network_interfaces.delete(id);
    this.request('DELETE', `/api/network-interfaces/${id}`).catch(console.error);
  }

  // ─── 逻辑接口 ─────────────────────────────────────────────────────────────

  async getLogicalInterfaces(entity_id: string): Promise<LogicalInterface[]> {
    return db.logical_interfaces.where('entity_id').equals(entity_id).toArray();
  }

  async saveLogicalInterface(iface: LogicalInterface): Promise<void> {
    await db.logical_interfaces.put(iface);
    this.request('POST', '/api/logical-interfaces', iface).catch(console.error);
  }

  async deleteLogicalInterface(id: string): Promise<void> {
    await db.logical_interfaces.delete(id);
    this.request('DELETE', `/api/logical-interfaces/${id}`).catch(console.error);
  }

  // ─── 交换机端口 ────────────────────────────────────────────────────────────

  async getSwitchPorts(switch_id: string): Promise<SwitchPort[]> {
    return db.switch_ports.where('switch_id').equals(switch_id).toArray();
  }

  async saveSwitchPort(port: SwitchPort): Promise<void> {
    await db.switch_ports.put(port);
    this.request('POST', '/api/switch-ports', port).catch(console.error);
  }

  async updateSwitchPort(id: string, updates: Partial<SwitchPort>): Promise<void> {
    await db.switch_ports.update(id, updates);
    this.request('PUT', `/api/switch-ports/${id}`, updates).catch(console.error);
  }

  async deleteSwitchPort(id: string): Promise<void> {
    await db.switch_port_vlans.where('switch_port_id').equals(id).delete();
    await db.switch_ports.delete(id);
    this.request('DELETE', `/api/switch-ports/${id}`).catch(console.error);
  }

  // ─── 端口 VLAN 关联 ────────────────────────────────────────────────────────

  async getSwitchPortVlans(switch_port_id: string): Promise<SwitchPortVlan[]> {
    return db.switch_port_vlans.where('switch_port_id').equals(switch_port_id).toArray();
  }

  async setSwitchPortVlans(switch_port_id: string, vlans: SwitchPortVlan[]): Promise<void> {
    await db.switch_port_vlans.where('switch_port_id').equals(switch_port_id).delete();
    if (vlans.length) await db.switch_port_vlans.bulkAdd(vlans);
    this.request('PUT', `/api/switch-ports/${switch_port_id}/vlans`, vlans).catch(console.error);
  }

  // ─── 边（连接）────────────────────────────────────────────────────────────

  async getEdges(filter?: { type?: string; source_id?: string; target_id?: string }): Promise<Edge[]> {
    if (filter?.source_id) return db.edges.where('source_id').equals(filter.source_id).toArray();
    if (filter?.target_id) return db.edges.where('target_id').equals(filter.target_id).toArray();
    if (filter?.type) return db.edges.where('edge_type').equals(filter.type).toArray();
    return db.edges.toArray();
  }

  async saveEdge(edge: Edge): Promise<void> {
    await db.edges.put(edge);
    addEdgeToGraph(edge);
    this.request('POST', '/api/edges', edge).catch(console.error);
  }

  async deleteEdge(id: string): Promise<void> {
    await db.edges.delete(id);
    removeEdgeFromGraph(id);
    this.request('DELETE', `/api/edges/${id}`).catch(console.error);
  }

  // ─── WiFi ─────────────────────────────────────────────────────────────────

  async getWifiSSIDs(entity_id: string): Promise<WiFiSSID[]> {
    return db.wifi_ssids.where('entity_id').equals(entity_id).toArray();
  }

  async saveWifiSSID(ssid: WiFiSSID): Promise<void> {
    await db.wifi_ssids.put(ssid);
    this.request('POST', '/api/wifi-ssids', ssid).catch(console.error);
  }

  async deleteWifiSSID(id: string): Promise<void> {
    await db.wifi_ssids.delete(id);
    this.request('DELETE', `/api/wifi-ssids/${id}`).catch(console.error);
  }

  // ─── 防火墙 ────────────────────────────────────────────────────────────────

  async getFirewallZones(): Promise<FirewallZone[]> { return db.firewall_zones.toArray(); }

  async saveFirewallZone(zone: FirewallZone): Promise<void> {
    await db.firewall_zones.put(zone);
    this.request('POST', '/api/firewall-zones', zone).catch(console.error);
  }

  async deleteFirewallZone(id: string): Promise<void> {
    await db.vlan_policies.where('source_zone_id').equals(id).delete();
    await db.vlan_policies.where('dest_zone_id').equals(id).delete();
    await db.firewall_zones.delete(id);
    this.request('DELETE', `/api/firewall-zones/${id}`).catch(console.error);
  }

  // ─── VLAN 策略 ─────────────────────────────────────────────────────────────

  async getVlanPolicies(): Promise<VlanPolicy[]> { return db.vlan_policies.toArray(); }

  async saveVlanPolicy(policy: VlanPolicy): Promise<void> {
    await db.vlan_policies.put(policy);
    this.request('POST', '/api/vlan-policies', policy).catch(console.error);
  }

  async deleteVlanPolicy(id: string): Promise<void> {
    await db.vlan_policies.delete(id);
    this.request('DELETE', `/api/vlan-policies/${id}`).catch(console.error);
  }

  // ─── 静态路由 ─────────────────────────────────────────────────────────────

  async getStaticRoutes(entity_id: string): Promise<StaticRoute[]> {
    return db.static_routes.where('entity_id').equals(entity_id).toArray();
  }

  async saveStaticRoute(route: StaticRoute): Promise<void> {
    await db.static_routes.put(route);
    this.request('POST', '/api/static-routes', route).catch(console.error);
  }

  async deleteStaticRoute(id: string): Promise<void> {
    await db.static_routes.delete(id);
    this.request('DELETE', `/api/static-routes/${id}`).catch(console.error);
  }

  // ─── NAT ──────────────────────────────────────────────────────────────────

  async getNatRules(entity_id: string): Promise<NatRule[]> {
    return db.nat_rules.where('entity_id').equals(entity_id).toArray();
  }

  async saveNatRule(rule: NatRule): Promise<void> {
    await db.nat_rules.put(rule);
    this.request('POST', '/api/nat-rules', rule).catch(console.error);
  }

  async deleteNatRule(id: string): Promise<void> {
    await db.nat_rules.delete(id);
    this.request('DELETE', `/api/nat-rules/${id}`).catch(console.error);
  }

  // ─── 快照 ──────────────────────────────────────────────────────────────────

  async exportAll(): Promise<InfraSnapshot> {
    const [entities, vlans, subnets, ip_addresses, switch_ports, switch_port_vlans,
      network_interfaces, logical_interfaces, wifi_ssids, firewall_zones,
      vlan_policies, static_routes, nat_rules, edges] = await Promise.all([
      db.entities.toArray(), db.vlans.toArray(), db.subnets.toArray(),
      db.ip_addresses.toArray(), db.switch_ports.toArray(), db.switch_port_vlans.toArray(),
      db.network_interfaces.toArray(), db.logical_interfaces.toArray(),
      db.wifi_ssids.toArray(), db.firewall_zones.toArray(),
      db.vlan_policies.toArray(), db.static_routes.toArray(),
      db.nat_rules.toArray(), db.edges.toArray(),
    ]);
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      entities, vlans, subnets, ip_addresses, switch_ports, switch_port_vlans,
      network_interfaces, logical_interfaces, wifi_ssids, firewall_zones,
      vlan_policies, static_routes, nat_rules, edges,
    };
  }

  async importAll(snapshot: InfraSnapshot): Promise<void> {
    // 先更新本地 Dexie
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) await table.clear();
      if (snapshot.entities.length) await db.entities.bulkAdd(snapshot.entities);
      if (snapshot.vlans.length) await db.vlans.bulkAdd(snapshot.vlans);
      if (snapshot.subnets.length) await db.subnets.bulkAdd(snapshot.subnets);
      if (snapshot.ip_addresses.length) await db.ip_addresses.bulkAdd(snapshot.ip_addresses);
      if (snapshot.switch_ports.length) await db.switch_ports.bulkAdd(snapshot.switch_ports);
      if (snapshot.switch_port_vlans.length) await db.switch_port_vlans.bulkAdd(snapshot.switch_port_vlans);
      if (snapshot.network_interfaces.length) await db.network_interfaces.bulkAdd(snapshot.network_interfaces);
      if (snapshot.logical_interfaces.length) await db.logical_interfaces.bulkAdd(snapshot.logical_interfaces);
      if (snapshot.wifi_ssids.length) await db.wifi_ssids.bulkAdd(snapshot.wifi_ssids);
      if (snapshot.firewall_zones.length) await db.firewall_zones.bulkAdd(snapshot.firewall_zones);
      if (snapshot.vlan_policies.length) await db.vlan_policies.bulkAdd(snapshot.vlan_policies);
      if (snapshot.static_routes.length) await db.static_routes.bulkAdd(snapshot.static_routes);
      if (snapshot.nat_rules.length) await db.nat_rules.bulkAdd(snapshot.nat_rules);
      if (snapshot.edges.length) await db.edges.bulkAdd(snapshot.edges);
    });
    await buildGraph();

    // 全量推送到 Worker
    await this.request('POST', '/api/import', snapshot);
  }
}
