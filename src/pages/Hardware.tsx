/** 硬件设备管理页面 - TanStack Table v9 + 侧滑抽屉 + 行内编辑 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { simpleFeatures, flexRender, useTable } from '../../lib/table';
import type { SimpleFeatures } from '../../lib/table';
import type { ColumnDef, CellContext } from '@tanstack/react-table';
import { useStorageDriver } from '../hooks/useStorage';
import { useApp } from '../context/AppContext';
import { Drawer } from '../components/Drawer';
import { Pagination } from '../components/Pagination';
import { IconPicker } from '../components/IconPicker';
import { InlineEditCell, InlineIconCell, type TableMeta } from '../components/InlineEdit';
import { FormInput } from '../components/forms/FormInput';
import { FormField } from '../components/forms/FormField';
import { useHardwareForm } from '../hooks/forms/useHardwareForm';
import type { HardwareFormValues, HardwareMetadataValues } from '../../lib/schemas/hardware';
import { HARDWARE_DEFAULT_VALUES } from '../../lib/schemas/hardware';
import type { Entity, HardwareCategory, HardwareMetadata, Subnet, NetworkInterface, MediaType, ConnectorType, InterfaceSpeed, IPAddress } from '../types';
import { CATEGORY_LABELS } from '../types';
import { Plus, Trash2, Edit, Network, Cable, ExternalLink } from 'lucide-react';

const HW_CATEGORIES: HardwareCategory[] = ['switch', 'router', 'ont', 'server', 'pc', 'phone', 'iot', 'camera', 'ap', 'ac', 'patch_panel', 'panel_ap'];

/** 从 driver 数据构造网络摘要 */
async function buildNetworkSummary(driver: any, entityId: string, entityName: string): Promise<any> {
  const [interfaces, logicalInterfaces, ips, staticRoutes, natRules, edges, vlans] = await Promise.all([
    driver.getNetworkInterfaces(entityId),
    driver.getLogicalInterfaces(entityId),
    driver.getIPAddresses({ entity_id: entityId }),
    driver.getStaticRoutes(entityId),
    driver.getNatRules(entityId),
    driver.getEdges({ source_id: entityId }),
    driver.getVlans(),
  ]);

  return {
    interfaces: interfaces.map((i: any) => ({
      ...i,
      switch_port_id: undefined,
      port_number: undefined,
      mode: undefined,
      sp_vlan_id: undefined,
      native_vlan_id: undefined,
      allowed_vlans: undefined,
    })),
    logical_interfaces: logicalInterfaces.map((li: any) => ({
      ...li,
      admin_status: 'up',
    })),
    ips: ips.map((ip: any) => ({
      id: ip.id,
      address: ip.address,
      status: ip.status,
      description: ip.description,
      subnet_cidr: undefined,
      interface_name: undefined,
    })),
    gateway_subnets: [],
    vlans: vlans,
    static_routes: staticRoutes.map((r: any) => ({
      id: r.id,
      destination: r.destination,
      gateway: r.next_hop,
      interface_name: r.out_interface,
      metric: r.metric,
    })),
    nat_rules: natRules.map((n: any) => ({
      id: n.id,
      type: n.nat_type,
      source: n.src_ip,
      destination: n.dest_ip,
      translated: n.translate_ip,
      description: `${n.protocol} ${n.src_zone}→${n.dest_zone}`,
    })),
    edges: edges.map((e: any) => ({
      id: e.id,
      source_name: entityName,
      target_name: entityName,
      source_nic: undefined,
      target_nic: undefined,
      edge_type: e.edge_type,
    })),
  };
}

/** 行内编辑 - 分类下拉（Hardware 专用，使用固定分类列表） */
function InlineCategoryCell({ getValue, row, table }: CellContext<SimpleFeatures, Entity, unknown>) {
  const currentValue = (getValue() as string) || 'server';
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span
        className="cursor-pointer px-2 py-0.5 bg-slate-100 rounded text-xs hover:bg-slate-200 inline-block"
        onClick={() => setEditing(true)}
        title="点击编辑"
      >
        {CATEGORY_LABELS[currentValue] || currentValue}
      </span>
    );
  }

  return (
    <select
      autoFocus
      value={currentValue}
      onChange={e => {
        setEditing(false);
        (table.options.meta as TableMeta)?.updateData(row.original, 'category', e.target.value);
      }}
      onBlur={() => setEditing(false)}
      className="px-2 py-1 border rounded text-xs focus:ring-2 focus:ring-blue-500"
    >
      {HW_CATEGORIES.map(cat => (
        <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
      ))}
    </select>
  );
}

export function Hardware() {
  const { showToast } = useApp();
  const driver = useStorageDriver();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');

  // 抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editItem, setEditItem] = useState<Entity | null>(null);

  // IP 相关
  const [entityIPs, setEntityIPs] = useState<Record<string, Array<{ address: string; status: string; interface_name?: string | null }>>>({});
  const [ipEntity, setIPEntity] = useState<Entity | null>(null);
  const [subnets, setSubnets] = useState<Subnet[]>([]);
  const [ipSubnet, setIPSubnet] = useState('');
  const [ipAddress, setIPAddress] = useState('');

  // 网口管理状态
  const [nicEntity, setNICEntity] = useState<Entity | null>(null);
  const [nicList, setNICList] = useState<NetworkInterface[]>([]);
  const [nicForm, setNicForm] = useState<{
    nic_name: string; nic_index: number; port_index: number;
    media_type: MediaType; connector_type: ConnectorType | ''; speed: InterfaceSpeed | '';
    mac_address: string; description: string;
  }>({ nic_name: '', nic_index: 0, port_index: 0, media_type: 'ethernet', connector_type: 'rj45', speed: '1G', mac_address: '', description: '' });
  const [nicEditId, setNicEditId] = useState<string | null>(null);
  // 网口数量缓存
  const [entityNICCounts, setEntityNICCounts] = useState<Record<string, number>>({});

  // 抽屉 Tab 状态
  type DrawerTab = 'basic' | 'ports' | 'ips' | 'network';
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('basic');

  // 网络摘要数据（打开抽屉时加载）
  interface NetworkSummary {
    interfaces: Array<{ id: string; nic_name: string; nic_index: number; port_index: number; media_type: string; connector_type: string | null; speed: string | null; mac_address: string | null; admin_status: string; description: string; switch_port_id?: string; port_number?: number; mode?: string; sp_vlan_id?: number; native_vlan_id?: number; allowed_vlans?: string }>;
    logical_interfaces: Array<{ id: string; name: string; type: string; vlan_id: number | null; ip_address: string | null; physical_port_name?: string; admin_status: string }>;
    ips: Array<{ id: string; address: string; status: string; description: string; subnet_cidr?: string; interface_name?: string | null }>;
    gateway_subnets: Array<{ id: string; cidr: string; gateway: string; vlan_name?: string; description: string }>;
    vlans: Array<{ id: number; name: string; description: string }>;
    static_routes: Array<{ id: string; destination: string; gateway: string; interface_name?: string; metric: number }>;
    nat_rules: Array<{ id: string; type: string; source: string; destination: string; translated: string; description: string }>;
    edges: Array<{ id: string; source_name: string; target_name: string; source_nic?: string; target_nic?: string; edge_type: string }>;
  }
  const [networkSummary, setNetworkSummary] = useState<NetworkSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const loadData = useCallback(async () => {
    const res = await driver.getEntities(
      { type: 'hardware', ...(filter && { category: filter }) },
      { page, pageSize: 15 }
    );
    setEntities(res.data);
    setTotal(res.total);
    if (res.data.length > 0) {
      // 加载IP信息
      const ips: Record<string, Array<{ address: string; status: string; interface_name?: string | null }>> = {};
      for (const entity of res.data) {
        const entityIPs = await driver.getIPAddresses({ entity_id: entity.id });
        ips[entity.id] = entityIPs.map(ip => ({
          address: ip.address,
          status: ip.status,
          interface_name: undefined, // IP address interface_name is not available from getIPAddresses
        }));
      }
      setEntityIPs(ips);
      // 加载网口数量
      const counts: Record<string, number> = {};
      for (const e of res.data) {
        const nicList = await driver.getNetworkInterfaces(e.id);
        counts[e.id] = nicList.length;
      }
      setEntityNICCounts(counts);
    }
  }, [driver, page, filter]);

  // 表单提交处理
  const handleFormSubmit = useCallback(async (values: HardwareFormValues) => {
    const now = new Date().toISOString();
    try {
      if (editItem) {
        await driver.updateEntity(editItem.id, {
          name: values.name,
          category: values.category,
          metadata: values.metadata as Record<string, unknown>,
          updated_at: now,
        });
        showToast('更新成功', 'success');
      } else {
        const newEntity: Entity = {
          id: crypto.randomUUID(),
          name: values.name,
          type: 'hardware',
          category: values.category,
          metadata: values.metadata as Record<string, unknown>,
          created_at: now,
          updated_at: now,
        };
        await driver.saveEntity(newEntity);
        showToast('创建成功', 'success');
      }
      setDrawerOpen(false);
      setEditItem(null);
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    }
  }, [editItem, driver, showToast, loadData]);

  const form = useHardwareForm({ onSubmit: handleFormSubmit });

  useEffect(() => { loadData(); }, [loadData]);

  // 切换到 IP Tab 时加载子网列表
  useEffect(() => {
    if (drawerTab === 'ips' && editItem) {
      driver.getSubnets().then(r => setSubnets(r));
      setIPEntity(editItem);
      setIPSubnet('');
      setIPAddress('');
    }
  }, [drawerTab, editItem, driver]);

  // 行内更新
  const handleInlineUpdate = useCallback(async (entity: Entity, field: string, value: string) => {
    try {
      if (field === 'name') {
        await driver.updateEntity(entity.id, { name: value });
      } else if (field === 'category') {
        await driver.updateEntity(entity.id, { category: value as any });
      } else {
        // metadata 字段
        const currentMeta = (entity.metadata || {}) as HardwareMetadata;
        const newMeta = { ...currentMeta, [field]: value };
        await driver.updateEntity(entity.id, { metadata: newMeta });
      }
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '更新失败', 'error');
    }
  }, [loadData, showToast, driver]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该设备？')) return;
    await driver.deleteEntity(id);
    showToast('已删除', 'success');
    loadData();
  };

  const openAdd = () => {
    setEditItem(null);
    form.reset(HARDWARE_DEFAULT_VALUES);
    setDrawerOpen(true);
  };

  const openEdit = async (item: Entity) => {
    setEditItem(item);
    const meta = (item.metadata || {}) as HardwareMetadataValues;
    form.reset({
      name: item.name,
      category: item.category as HardwareCategory,
      metadata: meta,
    });
    setDrawerTab('basic');
    setDrawerOpen(true);
    // 加载网络摘要
    setSummaryLoading(true);
    try {
      const summary = await buildNetworkSummary(driver, item.id, item.name);
      setNetworkSummary(summary);
      // 同步更新网口列表供端口 Tab 使用
      setNICEntity(item);
      setNICList(summary.interfaces);
    } catch { /* ignore */ }
    setSummaryLoading(false);
  };

  // IP 管理 - 打开 Drawer 的 ips tab
  const openIPManager = async (entity: Entity) => {
    // 如果抽屉已打开且正在编辑同一设备，直接切到 IP Tab
    if (drawerOpen && editItem?.id === entity.id) {
      setDrawerTab('ips');
    } else {
      await openEdit(entity);
      setDrawerTab('ips');
    }
  };

  const handleAssignIP = async () => {
    if (!ipEntity && !editItem) { showToast('无目标设备', 'error'); return; }
    const targetEntity = ipEntity || editItem;
    if (!ipSubnet) { showToast('请选择子网', 'error'); return; }
    try {
      // Get available IPs in subnet, or create new one
      const allIPs = await driver.getIPAddresses({ subnet_id: ipSubnet });
      let assignedIP: IPAddress | undefined;

      if (ipAddress) {
        // User specified IP - check if available
        assignedIP = allIPs.find(ip => ip.address === ipAddress);
      } else {
        // Find first available IP
        assignedIP = allIPs.find(ip => ip.status === 'available');
      }

      if (!assignedIP) {
        showToast('无可用 IP 地址', 'error');
        return;
      }

      // Update IP assignment
      await driver.updateIPAddress(assignedIP.id, {
        entity_id: targetEntity!.id,
        status: 'assigned',
      });

      showToast(`已分配 IP: ${assignedIP.address}`, 'success');
      setIPAddress('');
      // 刷新网络摘要（IP Tab 使用）
      if (drawerOpen && editItem) {
        const summary = await buildNetworkSummary(driver, editItem.id, editItem.name);
        setNetworkSummary(summary);
      }
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '分配失败', 'error');
    }
  };

  const handleReleaseIP = async (address: string) => {
    const targetEntity = ipEntity || editItem;
    if (!targetEntity) return;
    try {
      // Find IP and release it
      const allIPs = await driver.getIPAddresses({ entity_id: targetEntity.id });
      const ipToRelease = allIPs.find(ip => ip.address === address);
      if (ipToRelease) {
        await driver.updateIPAddress(ipToRelease.id, {
          entity_id: null,
          status: 'available',
        });
      }
      showToast('已释放', 'success');
      // 刷新网络摘要
      if (drawerOpen && editItem) {
        const summary = await buildNetworkSummary(driver, editItem.id, editItem.name);
        setNetworkSummary(summary);
      }
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '释放失败', 'error');
    }
  };

  // 网口管理 - 打开 Drawer 的 ports tab
  const openNICManager = async (entity: Entity) => {
    // 如果抽屉已打开且正在编辑同一设备，直接切到 ports Tab
    if (drawerOpen && editItem?.id === entity.id) {
      setDrawerTab('ports');
    } else {
      await openEdit(entity);
      setDrawerTab('ports');
    }
  };

  const resetNICForm = () => {
    setNicForm({ nic_name: '', nic_index: 0, port_index: 0, media_type: 'ethernet', connector_type: 'rj45', speed: '1G', mac_address: '', description: '' });
    setNicEditId(null);
  };

  const handleNICSave = async () => {
    if (!nicEntity || !nicForm.nic_name.trim()) { showToast('请输入网口名称', 'error'); return; }
    try {
      const payload = {
        connector_type: nicForm.connector_type || null,
        speed: nicForm.speed || null,
        mac_address: nicForm.mac_address || null,
        nic_name: nicForm.nic_name,
        nic_index: nicForm.nic_index,
        port_index: nicForm.port_index,
        media_type: nicForm.media_type,
        description: nicForm.description,
      };
      if (nicEditId) {
        // Update existing interface - need to get current one and update
        const currentInterface = nicList.find(n => n.id === nicEditId);
        if (currentInterface) {
          await driver.saveNetworkInterface({
            ...currentInterface,
            ...payload,
          });
        }
        showToast('网口已更新', 'success');
      } else {
        // Create new interface
        const newInterface: NetworkInterface = {
          id: crypto.randomUUID(),
          entity_id: nicEntity.id,
          nic_name: nicForm.nic_name,
          nic_index: nicForm.nic_index,
          port_index: nicForm.port_index,
          media_type: nicForm.media_type,
          connector_type: nicForm.connector_type || null,
          speed: nicForm.speed || null,
          mac_address: nicForm.mac_address || null,
          admin_status: 'down',
          description: nicForm.description,
        };
        await driver.saveNetworkInterface(newInterface);
        showToast('网口已添加', 'success');
      }
      resetNICForm();
      const nicListUpdated = await driver.getNetworkInterfaces(nicEntity.id);
      setNICList(nicListUpdated);
      // 刷新网络摘要
      if (drawerOpen && editItem) {
        const summary = await buildNetworkSummary(driver, editItem.id, editItem.name);
        setNetworkSummary(summary);
      }
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    }
  };

  const handleNICDelete = async (id: string) => {
    if (!nicEntity || !confirm('确定删除该网口？关联的端口配置和逻辑接口将一并清理。')) return;
    try {
      await driver.deleteNetworkInterface(id);
      showToast('已删除', 'success');
      const nicListUpdated = await driver.getNetworkInterfaces(nicEntity.id);
      setNICList(nicListUpdated);
      // 刷新网络摘要
      if (drawerOpen && editItem) {
        const summary = await buildNetworkSummary(driver, editItem.id, editItem.name);
        setNetworkSummary(summary);
      }
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败', 'error');
    }
  };

  const handleNICEdit = (iface: NetworkInterface) => {
    setNicEditId(iface.id);
    setNicForm({
      nic_name: iface.nic_name,
      nic_index: iface.nic_index,
      port_index: iface.port_index,
      media_type: iface.media_type,
      connector_type: iface.connector_type || '',
      speed: iface.speed || '',
      mac_address: iface.mac_address || '',
      description: iface.description,
    });
  };

  const handleBatchAddNIC = async (count: number, mediaType: MediaType, connType: ConnectorType, spd: InterfaceSpeed) => {
    if (!nicEntity) return;
    const existingMax = nicList.length;
    try {
      // Create and save each interface
      for (let i = 0; i < count; i++) {
        const newInterface: NetworkInterface = {
          id: crypto.randomUUID(),
          entity_id: nicEntity.id,
          nic_name: mediaType === 'wifi' ? `wifi${existingMax + i}` : `eth${existingMax + i}`,
          nic_index: existingMax + i,
          port_index: 0,
          media_type: mediaType,
          connector_type: mediaType === 'wifi' ? null : connType,
          speed: spd,
          mac_address: null,
          admin_status: 'down',
          description: '',
        };
        await driver.saveNetworkInterface(newInterface);
      }
      showToast(`已批量添加 ${count} 个网口`, 'success');
      const nicListUpdated = await driver.getNetworkInterfaces(nicEntity.id);
      setNICList(nicListUpdated);
      // 刷新网络摘要
      if (drawerOpen && editItem) {
        const summary = await buildNetworkSummary(driver, editItem.id, editItem.name);
        setNetworkSummary(summary);
      }
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '批量添加失败', 'error');
    }
  };

  // TanStack Table v9 列定义
  const columns = useMemo(() => [
    {
      id: 'icon',
      header: '',
      size: 48,
      cell: InlineIconCell,
    },
    {
      accessorKey: 'name',
      header: '名称',
      cell: InlineEditCell,
    },
    {
      id: 'hostname',
      header: 'Hostname',
      accessorFn: (row: Entity) => ((row.metadata || {}) as HardwareMetadata).hostname || '',
      cell: (info: CellContext<SimpleFeatures, Entity, unknown>) => <InlineEditCell {...info} column={{ ...info.column, id: 'hostname' }} />,
    },
    {
      accessorKey: 'category',
      header: '类型',
      cell: InlineCategoryCell,
    },
    {
      id: 'os',
      header: 'OS',
      accessorFn: (row: Entity) => ((row.metadata || {}) as HardwareMetadata).os || '',
      size: 100,
      cell: (info: CellContext<SimpleFeatures, Entity, unknown>) => {
        const val = info.getValue() as string;
        return val ? <span className="text-xs text-slate-600">{val}</span> : <span className="text-slate-300 text-xs">-</span>;
      },
    },
    {
      id: 'ip',
      header: 'IP 地址',
      cell: ({ row }: CellContext<SimpleFeatures, Entity, unknown>) => {
        const ips = entityIPs[row.original.id];
        return (
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
              {ips?.length ? ips.map(ip => (
                <span key={ip.address} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono" title={ip.interface_name ? `来源: ${ip.interface_name}` : '设备直接分配'}>
                  {ip.address}{ip.interface_name ? <span className="ml-1 text-blue-400 text-[10px]">({ip.interface_name})</span> : null}
                </span>
              )) : <span className="text-slate-300 text-xs">未分配</span>}
            </div>
            <button onClick={() => openIPManager(row.original)} className="p-1 hover:bg-blue-50 rounded shrink-0" title="管理IP">
              <Network className="w-4 h-4 text-blue-500" />
            </button>
          </div>
        );
      },
    },
    {
      id: 'location',
      header: '位置',
      accessorFn: (row: Entity) => ((row.metadata || {}) as HardwareMetadata).location || '',
      cell: (info: CellContext<SimpleFeatures, Entity, unknown>) => <InlineEditCell {...info} column={{ ...info.column, id: 'location' }} />,
    },
    {
      id: 'nics',
      header: '网口',
      size: 80,
      cell: ({ row }: CellContext<SimpleFeatures, Entity, unknown>) => {
        const count = entityNICCounts[row.original.id] || 0;
        return (
          <button
            onClick={() => openNICManager(row.original)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium hover:bg-green-50 text-green-700"
            title="管理网口"
          >
            <Cable className="w-3.5 h-3.5" />
            {count > 0 ? count : '-'}
          </button>
        );
      },
    },
    {
      id: 'actions',
      header: '操作',
      size: 100,
      cell: ({ row }: CellContext<SimpleFeatures, Entity, unknown>) => (
        <div className="flex items-center justify-end gap-1">
          <button onClick={() => openEdit(row.original)} className="p-1 hover:bg-slate-100 rounded" title="编辑详情">
            <Edit className="w-4 h-4 text-slate-500" />
          </button>
          <button onClick={() => handleDelete(row.original.id)} className="p-1 hover:bg-red-50 rounded" title="删除">
            <Trash2 className="w-4 h-4 text-red-500" />
          </button>
        </div>
      ),
    },
  ] as ColumnDef<SimpleFeatures, Entity>[], [entityIPs, entityNICCounts]);

  const table = useTable({
    features: simpleFeatures,
    columns,
    data: entities,
    meta: { updateData: handleInlineUpdate } as TableMeta,
  });

  const isDirty = form.state.isDirty;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">硬件设备</h2>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> 添加设备
        </button>
      </div>

      {/* 筛选 */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => { setFilter(''); setPage(1); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${!filter ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          全部
        </button>
        {HW_CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => { setFilter(cat); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === cat ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* TanStack Table */}
      <div className="bg-white rounded-xl border overflow-visible">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => (
                  <th key={header.id} className="px-4 py-3 text-left font-medium">
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="hover:bg-slate-50">
                {row.getAllCells().map(cell => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {entities.length === 0 && (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-slate-400">暂无设备数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={15} total={total} onChange={setPage} />

      {/* 侧滑抽屉 - 设备详情编辑（Tab 布局） */}
      <Drawer
        open={drawerOpen}
        onClose={() => { form.reset(HARDWARE_DEFAULT_VALUES); setDrawerOpen(false); }}
        title={editItem ? `设备详情 - ${editItem.name}` : '添加设备'}
        onBeforeClose={() => !isDirty}
        footer={drawerTab !== 'network' ? (
          <>
            <button onClick={() => { form.reset(HARDWARE_DEFAULT_VALUES); setDrawerOpen(false); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
              取消
            </button>
            <button onClick={() => form.handleSubmit()} disabled={!isDirty && !!editItem}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              保存
            </button>
          </>
        ) : undefined}
      >
        <div className="flex flex-col h-full">
          {/* Tab 导航 */}
          {editItem && (
            <div className="flex gap-1 border-b mb-4 -mt-1">
              {([['basic', '基础信息'], ['ports', '网口 & 端口'], ['ips', 'IP 地址'], ['network', '网络角色']] as [DrawerTab, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setDrawerTab(key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${drawerTab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Tab 内容区 */}
          <div className="flex-1 overflow-y-auto">
            {/* ===== 基础信息 Tab ===== */}
            {(drawerTab === 'basic' || !editItem) && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <form.Field name="name">
                      {(field) => (
                        <FormInput field={field} label="设备名称" required placeholder="如：核心交换机-1F" />
                      )}
                    </form.Field>
                  </div>
                  <div>
                    <form.Field name="category">
                      {(field) => (
                        <FormField label="设备类型">
                          <select
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value as HardwareCategory)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                          >
                            {HW_CATEGORIES.map(cat => <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>)}
                          </select>
                        </FormField>
                      )}
                    </form.Field>
                  </div>
                  <div>
                    <form.Field name="metadata.hostname">
                      {(field) => (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Hostname</label>
                          <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="如：sw-core-01" />
                        </div>
                      )}
                    </form.Field>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-600 mb-3 border-b pb-2">硬件规格</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <form.Field name="metadata.os">
                      {(field) => (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">操作系统</label>
                          <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="如：Ubuntu 22.04" />
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="metadata.cpu">
                      {(field) => (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">CPU</label>
                          <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="如：Intel i7-12700" />
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="metadata.cpu_cores">
                      {(field) => (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">CPU 核心数</label>
                          <input type="number" value={(field.state.value as number) ?? ''} onChange={e => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="如：8" />
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="metadata.ram">
                      {(field) => (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">内存 (GB)</label>
                          <input type="number" value={(field.state.value as number) ?? ''} onChange={e => field.handleChange(e.target.value ? Number(e.target.value) : undefined)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="如：32" />
                        </div>
                      )}
                    </form.Field>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-600 mb-3 border-b pb-2">设备标识</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <form.Field name="metadata.make">
                      {(field) => (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">品牌 (Make)</label>
                          <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="如：Dell" />
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="metadata.model">
                      {(field) => (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">型号 (Model)</label>
                          <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="如：PowerEdge R740" />
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="metadata.serial_number">
                      {(field) => (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">序列号</label>
                          <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="如：SN-20240101-001" />
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="metadata.location">
                      {(field) => (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">位置</label>
                          <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="如：机房A-机柜03-U12" />
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="metadata.hypervisor_type">
                      {(field) => (
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">虚拟化角色</label>
                          <select value={(field.state.value as string) || ''} onChange={e => field.handleChange((e.target.value || undefined) as HardwareMetadata['hypervisor_type'])}
                            className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                            <option value="">无</option>
                            <option value="kvm">KVM</option>
                            <option value="vmware">VMware ESXi</option>
                            <option value="hyperv">Hyper-V</option>
                            <option value="proxmox">Proxmox VE</option>
                            <option value="other">其他</option>
                          </select>
                        </div>
                      )}
                    </form.Field>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-600 mb-3 border-b pb-2">图标</h4>
                  <form.Field name="metadata.icon">
                    {(field) => (
                      <IconPicker value={(field.state.value as string) || ''} onChange={icon => field.handleChange(icon || undefined)} />
                    )}
                  </form.Field>
                </div>
                <form.Field name="metadata.note">
                  {(field) => (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">备注</label>
                      <textarea value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                        rows={3} placeholder="设备备注信息..." />
                    </div>
                  )}
                </form.Field>
              </div>
            )}

            {/* ===== 网口 & 端口 Tab ===== */}
            {drawerTab === 'ports' && editItem && (
              <div className="space-y-4">
                {/* 快捷批量添加 */}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => handleBatchAddNIC(4, 'ethernet', 'rj45', '1G')} className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100">+ 4口千兆电口</button>
                  <button onClick={() => handleBatchAddNIC(2, 'ethernet', 'rj45', '2.5G')} className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100">+ 2口2.5G电口</button>
                  <button onClick={() => handleBatchAddNIC(2, 'ethernet', 'sfp_plus', '10G')} className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-100">+ 2口万兆光口</button>
                  <button onClick={() => handleBatchAddNIC(1, 'wifi', 'rj45', '1G')} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-100">+ 1个WiFi</button>
                </div>

                {/* 物理网口列表（含端口配置） */}
                {networkSummary && networkSummary.interfaces.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left">名称</th>
                          <th className="px-3 py-2 text-left">类型/速率</th>
                          <th className="px-3 py-2 text-left">端口模式</th>
                          <th className="px-3 py-2 text-left">VLAN</th>
                          <th className="px-3 py-2 text-left">状态</th>
                          <th className="px-3 py-2 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {networkSummary.interfaces.map(iface => (
                          <tr key={iface.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono">{iface.nic_name}</td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${iface.media_type === 'wifi' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
                                {iface.media_type === 'wifi' ? '无线' : '有线'}
                              </span>
                              {iface.speed && <span className="ml-1 text-slate-500">{iface.speed}</span>}
                            </td>
                            <td className="px-3 py-2">
                              {iface.switch_port_id ? (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${iface.mode === 'trunk' ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'}`}>
                                  {iface.mode || 'access'}
                                </span>
                              ) : <span className="text-slate-300">-</span>}
                            </td>
                            <td className="px-3 py-2">
                              {iface.sp_vlan_id ? (
                                <span className="font-mono text-blue-600">VLAN {iface.sp_vlan_id}</span>
                              ) : iface.native_vlan_id ? (
                                <span className="font-mono text-amber-600">Native {iface.native_vlan_id}</span>
                              ) : <span className="text-slate-300">-</span>}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`w-2 h-2 rounded-full inline-block mr-1 ${iface.admin_status === 'up' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                              {iface.admin_status}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button onClick={() => handleNICEdit(iface as unknown as NetworkInterface)} className="text-blue-500 hover:text-blue-700 mr-2">编辑</button>
                              <button onClick={() => handleNICDelete(iface.id)} className="text-red-500 hover:text-red-700">删除</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center text-slate-400 py-6">暂无网口</div>
                )}

                {/* 逻辑接口列表 */}
                {networkSummary && networkSummary.logical_interfaces.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-slate-600 mb-2">逻辑子接口</h4>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-slate-600">
                          <tr>
                            <th className="px-3 py-2 text-left">名称</th>
                            <th className="px-3 py-2 text-left">类型</th>
                            <th className="px-3 py-2 text-left">VLAN</th>
                            <th className="px-3 py-2 text-left">IP</th>
                            <th className="px-3 py-2 text-left">物理端口</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {networkSummary.logical_interfaces.map(li => (
                            <tr key={li.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-mono">{li.name}</td>
                              <td className="px-3 py-2"><span className="px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px]">{li.type}</span></td>
                              <td className="px-3 py-2">{li.vlan_id ? <span className="font-mono text-blue-600">VLAN {li.vlan_id}</span> : '-'}</td>
                              <td className="px-3 py-2 font-mono">{li.ip_address || <span className="text-slate-300">未配置</span>}</td>
                              <td className="px-3 py-2">{li.physical_port_name || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 手动添加网口表单 */}
                <div className="border-t pt-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-3">{nicEditId ? '编辑网口' : '手动添加网口'}</h4>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">名称 *</label>
                      <input value={nicForm.nic_name} onChange={e => setNicForm({ ...nicForm, nic_name: e.target.value })}
                        className="w-full px-2 py-1.5 border rounded text-sm" placeholder="如 eth0" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">类型</label>
                      <select value={nicForm.media_type} onChange={e => setNicForm({ ...nicForm, media_type: e.target.value as MediaType })}
                        className="w-full px-2 py-1.5 border rounded text-sm">
                        <option value="ethernet">有线 Ethernet</option>
                        <option value="wifi">无线 WiFi</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">速率</label>
                      <select value={nicForm.speed} onChange={e => setNicForm({ ...nicForm, speed: e.target.value as InterfaceSpeed | '' })}
                        className="w-full px-2 py-1.5 border rounded text-sm">
                        <option value="">未知</option>
                        <option value="100M">100M</option>
                        <option value="1G">1G</option>
                        <option value="2.5G">2.5G</option>
                        <option value="10G">10G</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={handleNICSave} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                      {nicEditId ? '保存修改' : '添加'}
                    </button>
                    {nicEditId && (
                      <button onClick={resetNICForm} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消编辑</button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ===== IP 地址 Tab ===== */}
            {drawerTab === 'ips' && editItem && (
              <div className="space-y-4">
                {summaryLoading ? (
                  <div className="text-center text-slate-400 py-6">加载中...</div>
                ) : networkSummary ? (
                  <>
                    {/* 统一 IP 列表（含来源标注） */}
                    {networkSummary.ips.length > 0 ? (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-600 mb-2">所有 IP 地址</h4>
                        <div className="space-y-1">
                          {networkSummary.ips.map(ip => (
                            <div key={ip.id} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm">{ip.address}</span>
                                {ip.subnet_cidr && <span className="text-xs text-slate-400">({ip.subnet_cidr})</span>}
                                <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                  ip.status === 'reserved' ? 'bg-amber-100 text-amber-700' :
                                  ip.interface_name ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {ip.status === 'reserved' ? '网关(reserved)' : ip.interface_name ? `接口(${ip.interface_name})` : '直接分配'}
                                </span>
                              </div>
                              {ip.status !== 'reserved' && (
                                <button onClick={() => handleReleaseIP(ip.address)} className="text-xs text-red-500 hover:text-red-700">释放</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-slate-400 py-4">暂无 IP 地址</div>
                    )}

                    {/* 分配新 IP */}
                    <div className="border-t pt-4">
                      <label className="block text-sm font-medium text-slate-700 mb-2">分配新 IP</label>
                      <div className="space-y-3">
                        <select value={ipSubnet} onChange={e => setIPSubnet(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm">
                          <option value="">选择子网</option>
                          {subnets.map(s => <option key={s.id} value={s.id}>{s.cidr} {s.description ? `(${s.description})` : ''}</option>)}
                        </select>
                        <input value={ipAddress} onChange={e => setIPAddress(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="IP 地址（留空自动分配）" />
                        <button onClick={handleAssignIP} disabled={!ipSubnet}
                          className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                          {ipAddress ? '分配指定 IP' : '自动分配下一个可用 IP'}
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )}

            {/* ===== 网络角色 Tab ===== */}
            {drawerTab === 'network' && editItem && (
              <div className="space-y-5">
                {summaryLoading ? (
                  <div className="text-center text-slate-400 py-6">加载中...</div>
                ) : networkSummary ? (
                  <>
                    {/* 作为网关的子网 */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-600 mb-2">作为网关的子网</h4>
                      {networkSummary.gateway_subnets.length > 0 ? (
                        <div className="space-y-1">
                          {networkSummary.gateway_subnets.map(s => (
                            <div key={s.id} className="flex items-center gap-3 bg-amber-50 px-3 py-2 rounded-lg">
                              <span className="font-mono text-sm">{s.cidr}</span>
                              <span className="text-xs text-slate-500">网关: {s.gateway}</span>
                              {s.vlan_name && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px]">{s.vlan_name}</span>}
                            </div>
                          ))}
                        </div>
                      ) : <p className="text-sm text-slate-400">该设备未被指定为任何子网的网关</p>}
                    </div>

                    {/* 关联的 VLAN */}
                    <div>
                      <h4 className="text-sm font-semibold text-slate-600 mb-2">关联的 VLAN</h4>
                      {networkSummary.vlans.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {networkSummary.vlans.map(v => (
                            <span key={v.id} className="px-2 py-1 bg-cyan-50 text-cyan-700 rounded-lg text-xs font-mono">
                              VLAN {v.id} ({v.name})
                            </span>
                          ))}
                        </div>
                      ) : <p className="text-sm text-slate-400">无关联 VLAN</p>}
                    </div>

                    {/* 静态路由 */}
                    {networkSummary.static_routes.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-600 mb-2">静态路由</h4>
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-50"><tr><th className="px-3 py-2 text-left">目标</th><th className="px-3 py-2 text-left">网关</th><th className="px-3 py-2 text-left">Metric</th></tr></thead>
                            <tbody className="divide-y divide-slate-100">
                              {networkSummary.static_routes.map(r => (
                                <tr key={r.id}><td className="px-3 py-2 font-mono">{r.destination}</td><td className="px-3 py-2 font-mono">{r.gateway}</td><td className="px-3 py-2">{r.metric}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* NAT 规则 */}
                    {networkSummary.nat_rules.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-600 mb-2">NAT 规则</h4>
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-50"><tr><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">源</th><th className="px-3 py-2 text-left">目标</th><th className="px-3 py-2 text-left">转换</th></tr></thead>
                            <tbody className="divide-y divide-slate-100">
                              {networkSummary.nat_rules.map(r => (
                                <tr key={r.id}><td className="px-3 py-2">{r.type}</td><td className="px-3 py-2 font-mono">{r.source}</td><td className="px-3 py-2 font-mono">{r.destination}</td><td className="px-3 py-2 font-mono">{r.translated}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* 物理连接 */}
                    {networkSummary.edges.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-600 mb-2">物理连接</h4>
                        <div className="space-y-1">
                          {networkSummary.edges.filter(e => e.edge_type === 'physical').map(e => (
                            <div key={e.id} className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg text-xs">
                              <span>{e.source_name}</span>
                              {e.source_nic && <span className="font-mono text-slate-500">({e.source_nic})</span>}
                              <span className="text-slate-400">→</span>
                              <span>{e.target_name}</span>
                              {e.target_nic && <span className="font-mono text-slate-500">({e.target_nic})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 跳转链接 */}
                    <div className="border-t pt-4">
                      <a href="./networks" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
                        <ExternalLink className="w-4 h-4" /> 前往网络管理查看完整配置
                      </a>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </Drawer>
    </div>
  );
}
