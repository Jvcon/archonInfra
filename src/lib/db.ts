/**
 * Dexie 数据库 Schema（IndexedDB）
 * 替代 worker/db.ts 的 D1 数据库，用于浏览器本地存储
 */
import Dexie, { type Table } from 'dexie';
import type {
  Entity, VLAN, Subnet, IPAddress, SwitchPort, Edge,
  NetworkInterface, LogicalInterface, WiFiSSID,
  FirewallZone, VlanPolicy, StaticRoute, NatRule,
} from '../types';

export interface SwitchPortVlan {
  id?: number;
  switch_port_id: string;
  vlan_id: number;
  tagged: number; // 0=untagged, 1=tagged
}

/** 离线写操作队列条目 */
export interface PendingOp {
  id?: number;
  op: 'upsert' | 'delete';
  table: string;
  key: string;
  payload: unknown;
  created_at: number;
}

export class InfraDB extends Dexie {
  entities!: Table<Entity, string>;
  vlans!: Table<VLAN, number>;
  subnets!: Table<Subnet, string>;
  ip_addresses!: Table<IPAddress, string>;
  switch_ports!: Table<SwitchPort, string>;
  switch_port_vlans!: Table<SwitchPortVlan, number>;
  network_interfaces!: Table<NetworkInterface, string>;
  logical_interfaces!: Table<LogicalInterface, string>;
  wifi_ssids!: Table<WiFiSSID, string>;
  firewall_zones!: Table<FirewallZone, string>;
  vlan_policies!: Table<VlanPolicy, string>;
  static_routes!: Table<StaticRoute, string>;
  nat_rules!: Table<NatRule, string>;
  edges!: Table<Edge, string>;
  pending_ops!: Table<PendingOp, number>;

  constructor() {
    super('archoninfra');
    this.version(1).stores({
      entities:            'id, type, category',
      vlans:               'id, entity_id',
      subnets:             'id, vlan_id, entity_id',
      ip_addresses:        'id, &address, subnet_id, entity_id',
      switch_ports:        'id, switch_id, [switch_id+port_number], interface_id',
      switch_port_vlans:   '++id, [switch_port_id+vlan_id], switch_port_id, vlan_id',
      network_interfaces:  'id, entity_id',
      logical_interfaces:  'id, entity_id, physical_port_id',
      wifi_ssids:          'id, entity_id',
      firewall_zones:      'id, &name',
      vlan_policies:       'id, source_zone_id, dest_zone_id',
      static_routes:       'id, entity_id',
      nat_rules:           'id, entity_id',
      edges:               'id, source_id, target_id, edge_type, source_interface_id, target_interface_id',
    });
    // v2：添加 pending_ops 表用于离线同步队列
    this.version(2).stores({
      entities:            'id, type, category',
      vlans:               'id, entity_id',
      subnets:             'id, vlan_id, entity_id',
      ip_addresses:        'id, &address, subnet_id, entity_id',
      switch_ports:        'id, switch_id, [switch_id+port_number], interface_id',
      switch_port_vlans:   '++id, [switch_port_id+vlan_id], switch_port_id, vlan_id',
      network_interfaces:  'id, entity_id',
      logical_interfaces:  'id, entity_id, physical_port_id',
      wifi_ssids:          'id, entity_id',
      firewall_zones:      'id, &name',
      vlan_policies:       'id, source_zone_id, dest_zone_id',
      static_routes:       'id, entity_id',
      nat_rules:           'id, entity_id',
      edges:               'id, source_id, target_id, edge_type, source_interface_id, target_interface_id',
      pending_ops:         '++id, table, created_at',
    });
  }
}

export const db = new InfraDB();
