-- migrations/0001_init.sql
-- ArchonInfra 完整数据库 schema（D1 兼容）

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vlans (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  zone_id TEXT
);

CREATE TABLE IF NOT EXISTS subnets (
  id TEXT PRIMARY KEY,
  cidr TEXT NOT NULL,
  vlan_id INTEGER REFERENCES vlans(id) ON DELETE SET NULL,
  gateway TEXT DEFAULT '',
  description TEXT DEFAULT '',
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ip_addresses (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  subnet_id TEXT REFERENCES subnets(id) ON DELETE CASCADE,
  entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'available',
  description TEXT DEFAULT '',
  logical_interface_id TEXT
);

CREATE TABLE IF NOT EXISTS network_interfaces (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  nic_name TEXT NOT NULL,
  nic_index INTEGER NOT NULL,
  port_index INTEGER DEFAULT 0,
  media_type TEXT NOT NULL,
  connector_type TEXT,
  speed TEXT,
  mac_address TEXT,
  admin_status TEXT DEFAULT 'up',
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_id, nic_name)
);

CREATE TABLE IF NOT EXISTS switch_ports (
  id TEXT PRIMARY KEY,
  switch_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  port_number INTEGER NOT NULL,
  vlan_id INTEGER REFERENCES vlans(id) ON DELETE SET NULL,
  mode TEXT DEFAULT 'access',
  description TEXT DEFAULT '',
  interface_id TEXT REFERENCES network_interfaces(id),
  native_vlan_id INTEGER,
  UNIQUE(switch_id, port_number)
);

CREATE TABLE IF NOT EXISTS switch_port_vlans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  switch_port_id TEXT NOT NULL REFERENCES switch_ports(id) ON DELETE CASCADE,
  vlan_id INTEGER NOT NULL REFERENCES vlans(id) ON DELETE CASCADE,
  tagged INTEGER NOT NULL DEFAULT 1,
  UNIQUE(switch_port_id, vlan_id)
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_port INTEGER,
  target_port INTEGER,
  edge_type TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  source_interface_id TEXT REFERENCES network_interfaces(id),
  target_interface_id TEXT REFERENCES network_interfaces(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wifi_ssids (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  ssid_name TEXT NOT NULL,
  vlan_id INTEGER REFERENCES vlans(id) ON DELETE SET NULL,
  band TEXT DEFAULT '2.4GHz',
  security TEXT DEFAULT 'WPA2',
  hidden INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_id, ssid_name)
);

CREATE TABLE IF NOT EXISTS logical_interfaces (
  id TEXT PRIMARY KEY,
  physical_port_id TEXT REFERENCES network_interfaces(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  vlan_id INTEGER,
  ip_address TEXT,
  metadata TEXT DEFAULT '{}',
  admin_status TEXT DEFAULT 'up',
  zone_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_id, name)
);

CREATE TABLE IF NOT EXISTS firewall_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  trust_level TEXT DEFAULT 'untrusted',
  input_policy TEXT DEFAULT 'DROP',
  output_policy TEXT DEFAULT 'ACCEPT',
  forward_policy TEXT DEFAULT 'DROP',
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vlan_policies (
  id TEXT PRIMARY KEY,
  source_zone_id TEXT NOT NULL REFERENCES firewall_zones(id) ON DELETE CASCADE,
  dest_zone_id TEXT NOT NULL REFERENCES firewall_zones(id) ON DELETE CASCADE,
  action TEXT NOT NULL DEFAULT 'deny',
  protocol TEXT DEFAULT 'all',
  src_port TEXT DEFAULT '',
  dst_port TEXT DEFAULT '',
  priority INTEGER DEFAULT 100,
  enabled INTEGER DEFAULT 1,
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS static_routes (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  next_hop TEXT DEFAULT '',
  out_interface TEXT DEFAULT '',
  metric INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS nat_rules (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  nat_type TEXT NOT NULL,
  protocol TEXT DEFAULT 'all',
  src_zone TEXT DEFAULT '',
  src_ip TEXT DEFAULT '',
  dest_zone TEXT DEFAULT '',
  dest_ip TEXT DEFAULT '',
  dest_port TEXT DEFAULT '',
  translate_ip TEXT DEFAULT '',
  translate_port TEXT DEFAULT '',
  out_interface TEXT DEFAULT '',
  priority INTEGER DEFAULT 100,
  enabled INTEGER DEFAULT 1,
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);
