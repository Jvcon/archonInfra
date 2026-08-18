/** 统一类型定义 */

export type EntityType = 'hardware' | 'network' | 'vm' | 'storage' | 'app';

export type HardwareCategory = 'switch' | 'router' | 'ont' | 'server' | 'pc' | 'phone' | 'iot' | 'camera' | 'ap' | 'ac' | 'patch_panel' | 'panel_ap';
export type NetworkCategory = 'vlan' | 'subnet' | 'gateway' | 'ssid';
export type VMCategory = 'vm' | 'lxc';
export type VMType = 'kvm' | 'lxc';
export type StorageCategory = 'nas' | 'san' | 'disk';
export type AppCategory = 'container' | 'service' | 'application';

export type Category = HardwareCategory | NetworkCategory | VMCategory | StorageCategory | AppCategory;

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  category: Category;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface VLAN {
  id: number;
  name: string;
  description: string;
  entity_id?: string;
  zone_id?: string | null;
}

export interface Subnet {
  id: string;
  cidr: string;
  vlan_id: number | null;
  gateway: string;
  description: string;
  entity_id?: string;
}

export interface IPAddress {
  id: string;
  address: string;
  subnet_id: string;
  entity_id: string | null;
  status: 'available' | 'assigned' | 'reserved';
  description: string;
  entity_name?: string;
}

export interface SwitchPort {
  id: string;
  switch_id: string;
  port_number: number;
  vlan_id: number | null;
  native_vlan_id: number | null;
  allowed_vlans: string;
  mode: 'access' | 'trunk';
  interface_id: string | null;
  description: string;
  vlan_name?: string;
  native_vlan_name?: string;
}

export interface Edge {
  id: string;
  source_id: string;
  target_id: string;
  source_port: number | null;
  target_port: number | null;
  source_interface_id: string | null;
  target_interface_id: string | null;
  edge_type: 'physical' | 'logical' | 'vlan_member' | 'wireless' | 'management';
  metadata: Record<string, unknown>;
  created_at: string;
}

/** 网口/网卡接口 */
export type MediaType = 'ethernet' | 'wifi';
export type ConnectorType = 'rj45' | 'sfp' | 'sfp_plus';
export type InterfaceSpeed = '100M' | '1G' | '2.5G' | '5G' | '10G';

export interface NetworkInterface {
  id: string;
  entity_id: string;
  nic_name: string;
  nic_index: number;
  port_index: number;
  media_type: MediaType;
  connector_type: ConnectorType | null;
  speed: InterfaceSpeed | null;
  mac_address: string | null;
  admin_status: 'up' | 'down';
  description: string;
  created_at?: string;
}

/** 物理链路验证 */
export interface ValidationIssue {
  severity: 'error' | 'warning';
  type: 'connector_mismatch' | 'speed_mismatch' | 'port_conflict' | 'wifi_link' | 'missing_interface';
  message: string;
  related_entities: string[];
}

export interface ValidationReport {
  issues: ValidationIssue[];
  summary: { errors: number; warnings: number };
  valid: boolean;
}

export interface AutoVLANResult {
  vlan_id?: number;
  vlan_name?: string;
  assigned_ip?: string;
  subnet_cidr?: string;
}

/** VLAN 路径验证 */
export interface VLANPathHop {
  entity_id: string;
  entity_name: string;
  interface_id: string | null;
  port_mode: 'access' | 'trunk' | 'endpoint';
  native_vlan_id: number | null;
  allowed_vlans: number[];
  access_vlan_id: number | null;
}

export interface VLANPathValidationResult {
  valid: boolean;
  path: VLANPathHop[];
  target_vlan_id: number;
  issues: VLANPathIssue[];
}

export interface VLANPathIssue {
  severity: 'error' | 'warning';
  type: 'vlan_not_allowed' | 'native_mismatch' | 'port_unconfigured' | 'vlan_unreachable' | 'mode_incompatible';
  message: string;
  hop_index: number;
  related_entities: string[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 硬件设备扩展元数据 */
export type HypervisorType = 'kvm' | 'vmware' | 'hyperv' | 'proxmox' | 'other';
export const HYPERVISOR_TYPE_LABELS: Record<HypervisorType, string> = {
  kvm: 'KVM',
  vmware: 'VMware ESXi',
  hyperv: 'Hyper-V',
  proxmox: 'Proxmox VE',
  other: '其他',
};

export interface HardwareMetadata {
  hostname?: string;
  os?: string;
  cpu?: string;
  cpu_cores?: number;
  ram?: number;       // GB
  make?: string;      // 品牌
  model?: string;     // 型号
  serial_number?: string;
  location?: string;
  icon?: string;      // lucide-react 图标名
  note?: string;
  hypervisor_type?: HypervisorType;  // 虚拟化角色
}

/** NAT 端口映射 */
export interface NatMapping {
  id: string;
  host_port: number;
  vm_port: number;
  protocol: 'tcp' | 'udp' | 'both';
  description?: string;
}

/** 虚拟机/LXC 元数据 */
export interface VMMetadata {
  vm_type?: VMType;           // 区分 KVM 虚拟机和 LXC 容器
  host_id?: string;
  hostname?: string;
  ip_address?: string;
  mac_address?: string;
  os?: string;
  cpu?: string;
  ram?: number;
  disk?: number;
  icon?: string;
  note?: string;
  network_mode?: VMNetworkMode;
  nat_mappings?: NatMapping[];
  // LXC 特有字段
  template?: string;          // LXC 模板（如 ubuntu-22.04-standard）
  unprivileged?: boolean;     // 是否为非特权容器
  nesting?: boolean;          // 是否允许嵌套虚拟化
  vmid?: number;              // PVE VMID
}

export const VM_TYPE_LABELS: Record<VMType, string> = {
  kvm: 'KVM 虚拟机',
  lxc: 'LXC 容器',
};

/** WiFi SSID 配置 */
export type WiFiBand = '2.4GHz' | '5GHz' | 'dual';
export type WiFiSecurity = 'open' | 'WPA2' | 'WPA3';

/** 逻辑接口（物理端口上的虚拟接口或独立隧道接口） */
export type LogicalInterfaceType = 'vlan_sub' | 'bridge' | 'bond' | 'tunnel';

export interface LogicalInterface {
  id: string;
  physical_port_id: string | null;
  entity_id: string;
  name: string;
  type: LogicalInterfaceType;
  vlan_id: number | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
  admin_status: 'up' | 'down';
  zone_id?: string | null;
  created_at?: string;
  physical_port_name?: string;
}

export interface WiFiSSID {
  id: string;
  entity_id: string;
  ssid_name: string;
  vlan_id: number | null;
  band: WiFiBand;
  security: WiFiSecurity;
  hidden: boolean;
  enabled: boolean;
  description: string;
  created_at?: string;
  entity_name?: string;
  vlan_name?: string;
}

export type PageName = 'dashboard' | 'hardware' | 'networks' | 'vms' | 'storage' | 'apps' | 'topology' | 'settings';

export const PAGE_LABELS: Record<PageName, string> = {
  dashboard: '仪表盘',
  hardware: '硬件设备',
  networks: '网络管理',
  vms: '虚拟机/LXC',
  storage: '存储',
  apps: '应用服务',
  topology: '拓扑图',
  settings: '设置',
};

export const CATEGORY_LABELS: Record<string, string> = {
  switch: '交换机',
  router: '路由器',
  ont: '光猫',
  server: '服务器',
  pc: '电脑',
  phone: '手机',
  iot: 'IoT设备',
  camera: '摄像头',
  ap: '无线AP',
  ac: '无线控制器',
  patch_panel: '网口面板',
  panel_ap: '面板AP',
  vlan: 'VLAN',
  subnet: '子网',
  gateway: '网关',
  vm: '虚拟机',
  lxc: 'LXC容器',
  nas: 'NAS',
  san: 'SAN',
  disk: '磁盘',
  container: '容器',
  service: '服务',
  application: '应用',
};

export const TYPE_LABELS: Record<EntityType, string> = {
  hardware: '硬件设备',
  network: '网络',
  vm: '虚拟机',
  storage: '存储',
  app: '应用服务',
};

/** 端口占用状态 */
export interface PortStatus {
  interface_id: string;
  nic_name: string;
  port_index: number;
  media_type: string;
  speed: string | null;
  admin_status: string;
  link_status: 'connected' | 'free' | 'disabled';
  description: string;
  connected_to: {
    entity_name: string;
    entity_id: string;
    remote_port: string;
  } | null;
  switch_port: {
    mode: string;
    vlan_id: number | null;
    native_vlan_id: number | null;
    allowed_vlans: number[];
  } | null;
}

export interface PortStatusResponse {
  entity: { id: string; name: string; category: string };
  ports: PortStatus[];
  summary: { total: number; connected: number; free: number; disabled: number };
}

export interface PortStatusSummary {
  entity_id: string;
  entity_name: string;
  category: string;
  total: number;
  connected: number;
  free: number;
  disabled: number;
}

/** VLAN 全链路拓扑 */
export interface VLANTopologyNode {
  entity_id: string;
  entity_name: string;
  category: string;
  role: 'gateway' | 'transit' | 'access_endpoint';
}

export interface VLANTopologyLink {
  from_entity: string;
  from_port: string;
  from_mode: string;
  to_entity: string;
  to_port: string;
  to_mode: string;
}

export interface VLANTopologyEndpoint {
  entity_id: string;
  entity_name: string;
  ip_address: string | null;
  access_switch: string;
  access_port: string;
}

export interface VLANTopologyResponse {
  vlan: { id: number; name: string; description: string };
  gateway: {
    entity_id: string;
    entity_name: string;
    interface_name: string;
    ip_address: string;
  } | null;
  subnet: { cidr: string } | null;
  nodes: VLANTopologyNode[];
  links: VLANTopologyLink[];
  endpoints: VLANTopologyEndpoint[];
  issues: Array<{ type: string; message: string; affected_port: string }>;
}

/** 防火墙区域 */
export interface FirewallZone {
  id: string;
  name: string;
  display_name: string;
  trust_level: 'trusted' | 'untrusted' | 'dmz';
  input_policy: string;
  output_policy: string;
  forward_policy: string;
  description: string;
  created_at?: string;
}

/** VLAN 间策略 */
export interface VlanPolicy {
  id: string;
  source_zone_id: string;
  dest_zone_id: string;
  action: 'allow' | 'deny' | 'nat';
  protocol: string;
  src_port: string;
  dst_port: string;
  priority: number;
  enabled: number;
  description: string;
  created_at?: string;
  source_zone_name?: string;
  source_zone_display?: string;
  dest_zone_name?: string;
  dest_zone_display?: string;
}

/** 静态路由 */
export interface StaticRoute {
  id: string;
  entity_id: string;
  destination: string;
  next_hop: string;
  out_interface: string;
  metric: number;
  enabled: number;
  description: string;
  created_at?: string;
  entity_name?: string;
}

/** NAT 规则 */
export type NatType = 'snat' | 'masquerade' | 'dnat';

export interface NatRule {
  id: string;
  entity_id: string;
  nat_type: NatType;
  protocol: string;
  src_zone: string;
  src_ip: string;
  dest_zone: string;
  dest_ip: string;
  dest_port: string;
  translate_ip: string;
  translate_port: string;
  out_interface: string;
  priority: number;
  enabled: number;
  description: string;
  created_at?: string;
  entity_name?: string;
}

// ===== 应用服务元数据 =====

export type DeployType = 'standalone' | 'vm' | 'hardware';
export type VMNetworkMode = 'bridge' | 'nat' | 'host-only';
export type ContainerNetworkMode = 'bridge' | 'host' | 'macvlan' | 'none';
export type AppNetworkMode = VMNetworkMode | ContainerNetworkMode;

export const DEPLOY_TYPE_LABELS: Record<DeployType, string> = {
  standalone: 'Standalone',
  vm: 'VM（虚拟机）',
  hardware: 'Hardware（硬件）',
};

export const VM_NETWORK_MODES: Record<VMNetworkMode, string> = {
  bridge: 'Bridge（桥接）',
  nat: 'NAT（地址转换）',
  'host-only': 'Host-Only（仅主机）',
};

export const CONTAINER_NETWORK_MODES: Record<ContainerNetworkMode, string> = {
  bridge: 'Bridge（桥接）',
  host: 'Host（主机）',
  macvlan: 'Macvlan',
  none: 'None（无网络）',
};

/** 容器网络模式说明 */
export const CONTAINER_NETWORK_MODE_DESCRIPTIONS: Record<ContainerNetworkMode, string> = {
  bridge: '容器使用Docker内部网络，通过端口映射对外暴露服务',
  host: '容器直接使用宿主网络栈，共享宿主IP',
  macvlan: '容器直接获得物理网络IP（从IPAM分配）',
  none: '容器无网络连接',
};

/** Docker Bridge 默认子网 */
export const DOCKER_DEFAULT_BRIDGE_SUBNET = '172.17.0.0/16';

/** Docker 端口映射 */
export interface DockerPortMapping {
  id: string;
  host_port: number;
  container_port: number;
  protocol: 'tcp' | 'udp' | 'both';
  description?: string;
}

/** 应用服务单条地址记录 */
export interface AppAddress {
  id: string;
  label?: string;
  ip?: string;
  subnet_id?: string;
  ip_address_id?: string;
  port?: number;
  use_https?: boolean;
  external_ports?: number[];
}

/** 应用服务元数据 */
export interface AppMetadata {
  deploy_type?: DeployType;
  host_entity_id?: string;
  network_mode?: AppNetworkMode;
  hostname?: string;
  icon?: string;
  notes?: string;
  addresses?: AppAddress[];
  // Docker Bridge 模式专属字段
  docker_internal_ip?: string;        // 内部IP（如172.17.0.2）
  docker_subnet?: string;             // Docker Bridge子网（默认172.17.0.0/16）
  port_mappings?: DockerPortMapping[]; // 端口映射
}

// ===== 路由路径追踪 =====

export interface RouteTraceResult {
  paths: RouteTracePath[];
  diagnostics: RouteDiagnostic[];
  summary: {
    reachable: boolean;
    hop_count: number;
    has_nat: boolean;
    has_loop: boolean;
  };
}

export interface RouteTracePath {
  hops: RouteHop[];
}

export interface RouteHop {
  hop_index: number;
  entity_id: string;
  entity_name: string;
  category: string;
  in_interface: string | null;
  out_interface: string | null;
  matched_route: {
    destination: string;
    next_hop: string;
    metric: number;
  } | null;
  nat_actions: NatAction[];
  packet_src: string;
  packet_dst: string;
}

export interface NatAction {
  nat_type: 'snat' | 'dnat' | 'masquerade';
  original_ip: string;
  translated_ip: string;
  rule_description: string;
}

export interface RouteDiagnostic {
  severity: 'error' | 'warning' | 'info';
  type: 'no_route' | 'unreachable_next_hop' | 'loop_detected' | 'route_blackhole' | 'asymmetric_nat';
  message: string;
  at_hop: number;
  entity_id: string;
}
