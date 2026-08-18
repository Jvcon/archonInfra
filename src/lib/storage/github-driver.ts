/**
 * GitHubDriver - 将基础设施数据存储到 GitHub 仓库（按设备分目录）
 *
 * 仓库目录结构：
 *   _meta/vlans.json, subnets.json, firewall_zones.json, vlan_policies.json, edges.json
 *   devices/{entity-id}/entity.json, interfaces.json, logical_interfaces.json,
 *                        switch_ports.json, static_routes.json, nat_rules.json, wifi_ssids.json
 *   ipam/ip_addresses.json
 *
 * 鉴权：用户在设置面板填入 GitHub PAT + 仓库名（owner/repo）
 */
import type { StorageDriver, PaginationParams, PaginatedResult, InfraSnapshot } from './types';
import type {
  Entity, VLAN, Subnet, IPAddress, SwitchPort, Edge,
  NetworkInterface, LogicalInterface, WiFiSSID,
  FirewallZone, VlanPolicy, StaticRoute, NatRule,
} from '../../types';
import type { SwitchPortVlan } from '../db';
import { buildGraph } from '../graph';
import { db } from '../db';

export interface GitHubConfig {
  /** GitHub Personal Access Token */
  pat: string;
  /** 仓库名，格式 owner/repo */
  repo: string;
  /** 目标分支，默认 main */
  branch?: string;
}

/** GitHub Contents API 返回的文件信息 */
interface GHFile {
  sha: string;
  content: string; // base64 编码
}

export class GitHubDriver implements StorageDriver {
  private config: GitHubConfig;
  private branch: string;

  /** 内存缓存：path → { sha, data } */
  private cache = new Map<string, { sha: string; data: unknown }>();

  constructor(config: GitHubConfig) {
    this.config = config;
    this.branch = config.branch ?? 'main';
  }

  // ─── GitHub API 辅助 ─────────────────────────────────────────────────────

  private get headers() {
    return {
      'Authorization': `Bearer ${this.config.pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private apiUrl(path: string): string {
    return `https://api.github.com/repos/${this.config.repo}/contents/${path}`;
  }

  /** 读取文件，不存在时返回 null；命中缓存直接返回 */
  private async readFile<T>(path: string): Promise<T | null> {
    try {
      const resp = await fetch(this.apiUrl(path) + `?ref=${this.branch}`, {
        headers: this.headers,
      });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`GitHub API ${resp.status}: ${await resp.text()}`);
      const file: GHFile = await resp.json();
      const json = JSON.parse(atob(file.content.replace(/\n/g, ''))) as T;
      this.cache.set(path, { sha: file.sha, data: json });
      return json;
    } catch {
      return null;
    }
  }

  /** 写入文件（新建或更新），自动处理 SHA */
  private async writeFile(path: string, data: unknown, message: string): Promise<void> {
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
    const cached = this.cache.get(path);

    const body: Record<string, unknown> = {
      message,
      content,
      branch: this.branch,
    };
    if (cached) body['sha'] = cached.sha;

    const resp = await fetch(this.apiUrl(path), {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: resp.statusText }));
      throw new Error(`GitHub 写入失败 (${resp.status}): ${(err as { message: string }).message}`);
    }

    const result = await resp.json() as { content: { sha: string } };
    this.cache.set(path, { sha: result.content.sha, data });
  }

  /** 删除文件 */
  private async deleteFile(path: string, message: string): Promise<void> {
    const cached = this.cache.get(path);
    if (!cached) {
      // 先读取获取 SHA
      await this.readFile(path);
    }
    const sha = this.cache.get(path)?.sha;
    if (!sha) return; // 文件不存在，忽略

    const resp = await fetch(this.apiUrl(path), {
      method: 'DELETE',
      headers: this.headers,
      body: JSON.stringify({ message, sha, branch: this.branch }),
    });

    if (!resp.ok && resp.status !== 404) {
      throw new Error(`GitHub 删除失败 (${resp.status})`);
    }
    this.cache.delete(path);
  }

  // ─── 路径约定 ──────────────────────────────────────────────────────────────

  private metaPath(name: string) { return `_meta/${name}.json`; }
  private devicePath(entityId: string, name: string) { return `devices/${entityId}/${name}.json`; }
  private ipamPath() { return 'ipam/ip_addresses.json'; }

  // ─── 初始化：从 GitHub 加载数据到本地 Dexie 缓存 ─────────────────────────

  async init(): Promise<void> {
    // 先清空本地 IndexedDB，再从 GitHub 全量加载
    const snapshot = await this.fetchSnapshot();
    if (snapshot) {
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
    }
    await buildGraph();
  }

  /** 从 GitHub 仓库拉取全量快照（并行读取各目录文件） */
  private async fetchSnapshot(): Promise<InfraSnapshot | null> {
    try {
      const [vlans, subnets, firewall_zones, vlan_policies, edges, ip_addresses] = await Promise.all([
        this.readFile<VLAN[]>(this.metaPath('vlans')).then(d => d ?? []),
        this.readFile<Subnet[]>(this.metaPath('subnets')).then(d => d ?? []),
        this.readFile<FirewallZone[]>(this.metaPath('firewall_zones')).then(d => d ?? []),
        this.readFile<VlanPolicy[]>(this.metaPath('vlan_policies')).then(d => d ?? []),
        this.readFile<Edge[]>(this.metaPath('edges')).then(d => d ?? []),
        this.readFile<IPAddress[]>(this.ipamPath()).then(d => d ?? []),
      ]);

      // 读取 entities 列表（从 _meta/entities_index.json 获取设备 ID 列表）
      const entityIndex = await this.readFile<string[]>(this.metaPath('entities_index')).then(d => d ?? []);

      // 并行读取各设备目录
      const deviceData = await Promise.all(
        entityIndex.map(id => this.loadDevice(id))
      );

      const entities: Entity[] = [];
      const network_interfaces: NetworkInterface[] = [];
      const logical_interfaces: LogicalInterface[] = [];
      const switch_ports: SwitchPort[] = [];
      const switch_port_vlans: SwitchPortVlan[] = [];
      const static_routes: StaticRoute[] = [];
      const nat_rules: NatRule[] = [];
      const wifi_ssids: WiFiSSID[] = [];

      for (const d of deviceData) {
        if (!d) continue;
        entities.push(d.entity);
        network_interfaces.push(...d.interfaces);
        logical_interfaces.push(...d.logical_interfaces);
        switch_ports.push(...d.switch_ports);
        switch_port_vlans.push(...d.switch_port_vlans);
        static_routes.push(...d.static_routes);
        nat_rules.push(...d.nat_rules);
        wifi_ssids.push(...d.wifi_ssids);
      }

      return {
        version: 1,
        exported_at: new Date().toISOString(),
        entities, vlans, subnets, ip_addresses,
        switch_ports, switch_port_vlans,
        network_interfaces, logical_interfaces, wifi_ssids,
        firewall_zones, vlan_policies, static_routes, nat_rules, edges,
      };
    } catch {
      return null;
    }
  }

  /** 加载单台设备目录 */
  private async loadDevice(entityId: string) {
    const [entity, interfaces, logicalIfaces, sPorts, sRoutes, nRules, wSSIDs] = await Promise.all([
      this.readFile<Entity>(this.devicePath(entityId, 'entity')),
      this.readFile<NetworkInterface[]>(this.devicePath(entityId, 'interfaces')).then(d => d ?? []),
      this.readFile<LogicalInterface[]>(this.devicePath(entityId, 'logical_interfaces')).then(d => d ?? []),
      this.readFile<Array<SwitchPort & { _vlans?: SwitchPortVlan[] }>>(this.devicePath(entityId, 'switch_ports')).then(d => d ?? []),
      this.readFile<StaticRoute[]>(this.devicePath(entityId, 'static_routes')).then(d => d ?? []),
      this.readFile<NatRule[]>(this.devicePath(entityId, 'nat_rules')).then(d => d ?? []),
      this.readFile<WiFiSSID[]>(this.devicePath(entityId, 'wifi_ssids')).then(d => d ?? []),
    ]);

    if (!entity) return null;

    // switch_ports 携带内嵌的 _vlans 字段
    const switch_port_vlans: SwitchPortVlan[] = [];
    const switch_ports: SwitchPort[] = sPorts.map(p => {
      const { _vlans, ...port } = p;
      if (_vlans) switch_port_vlans.push(..._vlans);
      return port;
    });

    return {
      entity,
      interfaces,
      logical_interfaces: logicalIfaces,
      switch_ports,
      switch_port_vlans,
      static_routes: sRoutes,
      nat_rules: nRules,
      wifi_ssids: wSSIDs,
    };
  }

  /** 保存单台设备到 GitHub（只提交该设备目录） */
  private async saveDevice(entityId: string): Promise<void> {
    const [entity, interfaces, logicalIfaces, sPorts, sPortVlans, sRoutes, nRules, wSSIDs] = await Promise.all([
      db.entities.get(entityId),
      db.network_interfaces.where('entity_id').equals(entityId).toArray(),
      db.logical_interfaces.where('entity_id').equals(entityId).toArray(),
      db.switch_ports.where('switch_id').equals(entityId).toArray(),
      db.switch_port_vlans.toArray(), // 稍后按 port ID 过滤
      db.static_routes.where('entity_id').equals(entityId).toArray(),
      db.nat_rules.where('entity_id').equals(entityId).toArray(),
      db.wifi_ssids.where('entity_id').equals(entityId).toArray(),
    ]);

    if (!entity) return;

    // 将 switch_port_vlans 内嵌到对应端口
    const portIds = new Set(sPorts.map(p => p.id));
    const filteredSpv = sPortVlans.filter(v => portIds.has(v.switch_port_id));
    const portVlanMap = new Map<string, SwitchPortVlan[]>();
    for (const v of filteredSpv) {
      if (!portVlanMap.has(v.switch_port_id)) portVlanMap.set(v.switch_port_id, []);
      portVlanMap.get(v.switch_port_id)!.push(v);
    }
    const portsWithVlans = sPorts.map(p => ({
      ...p,
      _vlans: portVlanMap.get(p.id) ?? [],
    }));

    const msg = `update: device ${entity.name} (${entityId.slice(0, 8)})`;
    await Promise.all([
      this.writeFile(this.devicePath(entityId, 'entity'), entity, msg),
      this.writeFile(this.devicePath(entityId, 'interfaces'), interfaces, msg),
      this.writeFile(this.devicePath(entityId, 'logical_interfaces'), logicalIfaces, msg),
      this.writeFile(this.devicePath(entityId, 'switch_ports'), portsWithVlans, msg),
      this.writeFile(this.devicePath(entityId, 'static_routes'), sRoutes, msg),
      this.writeFile(this.devicePath(entityId, 'nat_rules'), nRules, msg),
      this.writeFile(this.devicePath(entityId, 'wifi_ssids'), wSSIDs, msg),
    ]);

    // 更新设备索引
    await this.updateEntityIndex(entityId, 'add');
  }

  /** 更新 _meta/entities_index.json */
  private async updateEntityIndex(entityId: string, action: 'add' | 'remove'): Promise<void> {
    const index = await this.readFile<string[]>(this.metaPath('entities_index')) ?? [];
    let updated: string[];
    if (action === 'add') {
      updated = index.includes(entityId) ? index : [...index, entityId];
    } else {
      updated = index.filter(id => id !== entityId);
    }
    await this.writeFile(this.metaPath('entities_index'), updated, `update: entities index`);
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
    // 异步推送到 GitHub（不阻塞 UI）
    this.saveDevice(entity.id).catch(console.error);
  }

  async updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
    await db.entities.update(id, { ...updates, updated_at: new Date().toISOString() });
    const updated = await db.entities.get(id);
    if (updated) this.saveDevice(id).catch(console.error);
  }

  async deleteEntity(id: string): Promise<void> {
    const entity = await db.entities.get(id);
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
    // 从 GitHub 删除设备目录（仅删除 entity.json，其他文件保留历史）
    if (entity) {
      const msg = `delete: device ${entity.name} (${id.slice(0, 8)})`;
      this.deleteFile(this.devicePath(id, 'entity'), msg)
        .then(() => this.updateEntityIndex(id, 'remove'))
        .catch(console.error);
    }
  }

  // ─── VLAN ──────────────────────────────────────────────────────────────────

  async getVlans(): Promise<VLAN[]> { return db.vlans.toArray(); }

  async saveVlan(vlan: VLAN): Promise<void> {
    await db.vlans.put(vlan);
    this.syncMeta('vlans').catch(console.error);
  }

  async updateVlan(id: number, updates: Partial<VLAN>): Promise<void> {
    await db.vlans.update(id, updates);
    this.syncMeta('vlans').catch(console.error);
  }

  async deleteVlan(id: number): Promise<void> {
    await db.switch_port_vlans.where('vlan_id').equals(id).delete();
    await db.vlans.delete(id);
    this.syncMeta('vlans').catch(console.error);
  }

  // ─── 子网 ──────────────────────────────────────────────────────────────────

  async getSubnets(filter?: { vlan_id?: number }): Promise<Subnet[]> {
    if (filter?.vlan_id != null) return db.subnets.where('vlan_id').equals(filter.vlan_id).toArray();
    return db.subnets.toArray();
  }

  async saveSubnet(subnet: Subnet): Promise<void> {
    await db.subnets.put(subnet);
    this.syncMeta('subnets').catch(console.error);
  }

  async updateSubnet(id: string, updates: Partial<Subnet>): Promise<void> {
    await db.subnets.update(id, updates);
    this.syncMeta('subnets').catch(console.error);
  }

  async deleteSubnet(id: string): Promise<void> {
    await db.ip_addresses.where('subnet_id').equals(id).delete();
    await db.subnets.delete(id);
    this.syncMeta('subnets').catch(console.error);
  }

  // ─── IP 地址 ───────────────────────────────────────────────────────────────

  async getIPAddresses(filter?: { subnet_id?: string; entity_id?: string }): Promise<IPAddress[]> {
    if (filter?.subnet_id) return db.ip_addresses.where('subnet_id').equals(filter.subnet_id).toArray();
    if (filter?.entity_id) return db.ip_addresses.where('entity_id').equals(filter.entity_id).toArray();
    return db.ip_addresses.toArray();
  }

  async saveIPAddress(ip: IPAddress): Promise<void> {
    await db.ip_addresses.put(ip);
    this.syncIpam().catch(console.error);
  }

  async updateIPAddress(id: string, updates: Partial<IPAddress>): Promise<void> {
    await db.ip_addresses.update(id, updates);
    this.syncIpam().catch(console.error);
  }

  async deleteIPAddress(id: string): Promise<void> {
    await db.ip_addresses.delete(id);
    this.syncIpam().catch(console.error);
  }

  // ─── 网口 ──────────────────────────────────────────────────────────────────

  async getNetworkInterfaces(entity_id: string): Promise<NetworkInterface[]> {
    return db.network_interfaces.where('entity_id').equals(entity_id).toArray();
  }

  async saveNetworkInterface(iface: NetworkInterface): Promise<void> {
    await db.network_interfaces.put(iface);
    this.saveDevice(iface.entity_id).catch(console.error);
  }

  async deleteNetworkInterface(id: string): Promise<void> {
    const iface = await db.network_interfaces.get(id);
    await db.network_interfaces.delete(id);
    if (iface) this.saveDevice(iface.entity_id).catch(console.error);
  }

  // ─── 逻辑接口 ─────────────────────────────────────────────────────────────

  async getLogicalInterfaces(entity_id: string): Promise<LogicalInterface[]> {
    return db.logical_interfaces.where('entity_id').equals(entity_id).toArray();
  }

  async saveLogicalInterface(iface: LogicalInterface): Promise<void> {
    await db.logical_interfaces.put(iface);
    this.saveDevice(iface.entity_id).catch(console.error);
  }

  async deleteLogicalInterface(id: string): Promise<void> {
    const iface = await db.logical_interfaces.get(id);
    await db.logical_interfaces.delete(id);
    if (iface) this.saveDevice(iface.entity_id).catch(console.error);
  }

  // ─── 交换机端口 ────────────────────────────────────────────────────────────

  async getSwitchPorts(switch_id: string): Promise<SwitchPort[]> {
    return db.switch_ports.where('switch_id').equals(switch_id).toArray();
  }

  async saveSwitchPort(port: SwitchPort): Promise<void> {
    await db.switch_ports.put(port);
    this.saveDevice(port.switch_id).catch(console.error);
  }

  async updateSwitchPort(id: string, updates: Partial<SwitchPort>): Promise<void> {
    await db.switch_ports.update(id, updates);
    const port = await db.switch_ports.get(id);
    if (port) this.saveDevice(port.switch_id).catch(console.error);
  }

  async deleteSwitchPort(id: string): Promise<void> {
    const port = await db.switch_ports.get(id);
    await db.switch_port_vlans.where('switch_port_id').equals(id).delete();
    await db.switch_ports.delete(id);
    if (port) this.saveDevice(port.switch_id).catch(console.error);
  }

  // ─── 端口 VLAN 关联 ────────────────────────────────────────────────────────

  async getSwitchPortVlans(switch_port_id: string): Promise<SwitchPortVlan[]> {
    return db.switch_port_vlans.where('switch_port_id').equals(switch_port_id).toArray();
  }

  async setSwitchPortVlans(switch_port_id: string, vlans: SwitchPortVlan[]): Promise<void> {
    await db.switch_port_vlans.where('switch_port_id').equals(switch_port_id).delete();
    if (vlans.length) await db.switch_port_vlans.bulkAdd(vlans);
    const port = await db.switch_ports.get(switch_port_id);
    if (port) this.saveDevice(port.switch_id).catch(console.error);
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
    this.syncMeta('edges').catch(console.error);
  }

  async deleteEdge(id: string): Promise<void> {
    await db.edges.delete(id);
    this.syncMeta('edges').catch(console.error);
  }

  // ─── WiFi ─────────────────────────────────────────────────────────────────

  async getWifiSSIDs(entity_id: string): Promise<WiFiSSID[]> {
    return db.wifi_ssids.where('entity_id').equals(entity_id).toArray();
  }

  async saveWifiSSID(ssid: WiFiSSID): Promise<void> {
    await db.wifi_ssids.put(ssid);
    this.saveDevice(ssid.entity_id).catch(console.error);
  }

  async deleteWifiSSID(id: string): Promise<void> {
    const ssid = await db.wifi_ssids.get(id);
    await db.wifi_ssids.delete(id);
    if (ssid) this.saveDevice(ssid.entity_id).catch(console.error);
  }

  // ─── 防火墙 ────────────────────────────────────────────────────────────────

  async getFirewallZones(): Promise<FirewallZone[]> { return db.firewall_zones.toArray(); }

  async saveFirewallZone(zone: FirewallZone): Promise<void> {
    await db.firewall_zones.put(zone);
    this.syncMeta('firewall_zones').catch(console.error);
  }

  async deleteFirewallZone(id: string): Promise<void> {
    await db.vlan_policies.where('source_zone_id').equals(id).delete();
    await db.vlan_policies.where('dest_zone_id').equals(id).delete();
    await db.firewall_zones.delete(id);
    this.syncMeta('firewall_zones').catch(console.error);
  }

  // ─── VLAN 策略 ─────────────────────────────────────────────────────────────

  async getVlanPolicies(): Promise<VlanPolicy[]> { return db.vlan_policies.toArray(); }

  async saveVlanPolicy(policy: VlanPolicy): Promise<void> {
    await db.vlan_policies.put(policy);
    this.syncMeta('vlan_policies').catch(console.error);
  }

  async deleteVlanPolicy(id: string): Promise<void> {
    await db.vlan_policies.delete(id);
    this.syncMeta('vlan_policies').catch(console.error);
  }

  // ─── 静态路由 ─────────────────────────────────────────────────────────────

  async getStaticRoutes(entity_id: string): Promise<StaticRoute[]> {
    return db.static_routes.where('entity_id').equals(entity_id).toArray();
  }

  async saveStaticRoute(route: StaticRoute): Promise<void> {
    await db.static_routes.put(route);
    this.saveDevice(route.entity_id).catch(console.error);
  }

  async deleteStaticRoute(id: string): Promise<void> {
    const route = await db.static_routes.get(id);
    await db.static_routes.delete(id);
    if (route) this.saveDevice(route.entity_id).catch(console.error);
  }

  // ─── NAT ──────────────────────────────────────────────────────────────────

  async getNatRules(entity_id: string): Promise<NatRule[]> {
    return db.nat_rules.where('entity_id').equals(entity_id).toArray();
  }

  async saveNatRule(rule: NatRule): Promise<void> {
    await db.nat_rules.put(rule);
    this.saveDevice(rule.entity_id).catch(console.error);
  }

  async deleteNatRule(id: string): Promise<void> {
    const rule = await db.nat_rules.get(id);
    await db.nat_rules.delete(id);
    if (rule) this.saveDevice(rule.entity_id).catch(console.error);
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

  /** 全量推送到 GitHub（首次切换时使用） */
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

    // 全量推送到 GitHub
    await this.pushAll();
  }

  /** 全量推送本地数据到 GitHub */
  async pushAll(): Promise<void> {
    const snapshot = await this.exportAll();

    // 推送 _meta 文件
    await Promise.all([
      this.writeFile(this.metaPath('vlans'), snapshot.vlans, 'sync: vlans'),
      this.writeFile(this.metaPath('subnets'), snapshot.subnets, 'sync: subnets'),
      this.writeFile(this.metaPath('firewall_zones'), snapshot.firewall_zones, 'sync: firewall_zones'),
      this.writeFile(this.metaPath('vlan_policies'), snapshot.vlan_policies, 'sync: vlan_policies'),
      this.writeFile(this.metaPath('edges'), snapshot.edges, 'sync: edges'),
      this.writeFile(this.ipamPath(), snapshot.ip_addresses, 'sync: ip_addresses'),
      this.writeFile(this.metaPath('entities_index'), snapshot.entities.map(e => e.id), 'sync: entities_index'),
    ]);

    // 逐设备推送
    for (const entity of snapshot.entities) {
      await this.saveDevice(entity.id);
    }
  }

  // ─── 内部同步辅助 ─────────────────────────────────────────────────────────

  /** 同步单个 _meta 文件到 GitHub */
  private async syncMeta(name: 'vlans' | 'subnets' | 'firewall_zones' | 'vlan_policies' | 'edges'): Promise<void> {
    let data: unknown;
    switch (name) {
      case 'vlans': data = await db.vlans.toArray(); break;
      case 'subnets': data = await db.subnets.toArray(); break;
      case 'firewall_zones': data = await db.firewall_zones.toArray(); break;
      case 'vlan_policies': data = await db.vlan_policies.toArray(); break;
      case 'edges': data = await db.edges.toArray(); break;
    }
    await this.writeFile(this.metaPath(name), data, `sync: ${name}`);
  }

  /** 同步 IPAM 到 GitHub */
  private async syncIpam(): Promise<void> {
    const data = await db.ip_addresses.toArray();
    await this.writeFile(this.ipamPath(), data, 'sync: ip_addresses');
  }
}
