import type {
  Entity, VLAN, Subnet, IPAddress, SwitchPort, Edge,
  NetworkInterface, LogicalInterface, WiFiSSID,
  FirewallZone, VlanPolicy, StaticRoute, NatRule,
} from '../../types';
import type { SwitchPortVlan } from '../db';

/** 全量快照（用于导入导出和后端同步） */
export interface InfraSnapshot {
  version: number;
  exported_at: string;
  entities: Entity[];
  vlans: VLAN[];
  subnets: Subnet[];
  ip_addresses: IPAddress[];
  switch_ports: SwitchPort[];
  switch_port_vlans: SwitchPortVlan[];
  network_interfaces: NetworkInterface[];
  logical_interfaces: LogicalInterface[];
  wifi_ssids: WiFiSSID[];
  firewall_zones: FirewallZone[];
  vlan_policies: VlanPolicy[];
  static_routes: StaticRoute[];
  nat_rules: NatRule[];
  edges: Edge[];
}

/** 分页参数 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

/** 分页结果 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 存储驱动接口 — 三后端统一抽象 */
export interface StorageDriver {
  init(): Promise<void>;

  // 实体
  getEntities(filter?: { type?: string; category?: string }, pagination?: PaginationParams): Promise<PaginatedResult<Entity>>;
  getEntity(id: string): Promise<Entity | undefined>;
  saveEntity(entity: Entity): Promise<void>;
  updateEntity(id: string, updates: Partial<Entity>): Promise<void>;
  deleteEntity(id: string): Promise<void>;

  // VLAN
  getVlans(): Promise<VLAN[]>;
  saveVlan(vlan: VLAN): Promise<void>;
  updateVlan(id: number, updates: Partial<VLAN>): Promise<void>;
  deleteVlan(id: number): Promise<void>;

  // 子网
  getSubnets(filter?: { vlan_id?: number }): Promise<Subnet[]>;
  saveSubnet(subnet: Subnet): Promise<void>;
  updateSubnet(id: string, updates: Partial<Subnet>): Promise<void>;
  deleteSubnet(id: string): Promise<void>;

  // IP 地址
  getIPAddresses(filter?: { subnet_id?: string; entity_id?: string }): Promise<IPAddress[]>;
  saveIPAddress(ip: IPAddress): Promise<void>;
  updateIPAddress(id: string, updates: Partial<IPAddress>): Promise<void>;
  deleteIPAddress(id: string): Promise<void>;

  // 网口
  getNetworkInterfaces(entity_id: string): Promise<NetworkInterface[]>;
  saveNetworkInterface(iface: NetworkInterface): Promise<void>;
  deleteNetworkInterface(id: string): Promise<void>;

  // 逻辑接口
  getLogicalInterfaces(entity_id: string): Promise<LogicalInterface[]>;
  saveLogicalInterface(iface: LogicalInterface): Promise<void>;
  deleteLogicalInterface(id: string): Promise<void>;

  // 交换机端口
  getSwitchPorts(switch_id: string): Promise<SwitchPort[]>;
  saveSwitchPort(port: SwitchPort): Promise<void>;
  updateSwitchPort(id: string, updates: Partial<SwitchPort>): Promise<void>;
  deleteSwitchPort(id: string): Promise<void>;

  // 端口 VLAN 关联
  getSwitchPortVlans(switch_port_id: string): Promise<SwitchPortVlan[]>;
  setSwitchPortVlans(switch_port_id: string, vlans: SwitchPortVlan[]): Promise<void>;

  // 边（连接）
  getEdges(filter?: { type?: string; source_id?: string; target_id?: string }): Promise<Edge[]>;
  saveEdge(edge: Edge): Promise<void>;
  deleteEdge(id: string): Promise<void>;

  // WiFi
  getWifiSSIDs(entity_id: string): Promise<WiFiSSID[]>;
  saveWifiSSID(ssid: WiFiSSID): Promise<void>;
  deleteWifiSSID(id: string): Promise<void>;

  // 防火墙
  getFirewallZones(): Promise<FirewallZone[]>;
  saveFirewallZone(zone: FirewallZone): Promise<void>;
  deleteFirewallZone(id: string): Promise<void>;

  // VLAN 策略
  getVlanPolicies(): Promise<VlanPolicy[]>;
  saveVlanPolicy(policy: VlanPolicy): Promise<void>;
  deleteVlanPolicy(id: string): Promise<void>;

  // 静态路由
  getStaticRoutes(entity_id: string): Promise<StaticRoute[]>;
  saveStaticRoute(route: StaticRoute): Promise<void>;
  deleteStaticRoute(id: string): Promise<void>;

  // NAT 规则
  getNatRules(entity_id: string): Promise<NatRule[]>;
  saveNatRule(rule: NatRule): Promise<void>;
  deleteNatRule(id: string): Promise<void>;

  // 快照
  exportAll(): Promise<InfraSnapshot>;
  importAll(snapshot: InfraSnapshot): Promise<void>;
}
