/** 虚拟机管理页面 - 侧滑抽屉编辑 + 网络模式 + 智能 IP 分配 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStorageDriver } from '../lib/storage';
import { useApp } from '../context/AppContext';
import { Drawer } from '../components/Drawer';
import { Pagination } from '../components/Pagination';
import { IconPicker } from '../components/IconPicker';
import { InlineEditCell, InlineSelectCell, InlineIconCell, type TableMeta } from '../components/InlineEdit';
import { FormInput } from '../components/forms/FormInput';
import { useVMForm } from '../hooks/forms/useVMForm';
import type { VMFormValues, VMMetadataValues } from '../../lib/schemas/vm';
import { VM_DEFAULT_VALUES } from '../../lib/schemas/vm';
import type { Entity, Subnet, VMMetadata, VMNetworkMode, NatMapping } from '../types';
import { VM_NETWORK_MODES, VM_TYPE_LABELS } from '../types';
import { Plus, Trash2, Edit, Network, Monitor, Container } from 'lucide-react';
import { simpleFeatures, createColumnHelper, flexRender, useTable } from '../../lib/table';
import type { SimpleFeatures } from '../../lib/table';
import type { ColumnDef } from '@tanstack/react-table';

const columnHelper = createColumnHelper<SimpleFeatures, Entity>();

export function VMs() {
  const { showToast } = useApp();
  const driver = useStorageDriver();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<'all' | 'kvm' | 'lxc'>('all');

  // 抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editItem, setEditItem] = useState<Entity | null>(null);
  const [drawerTab, setDrawerTab] = useState<'basic' | 'ips'>('basic');
  // 表单默认值（驱动 useVMForm 的 defaultValues，编辑时设为 item 数据）
  const [formDefaultValues, setFormDefaultValues] = useState<VMFormValues>(VM_DEFAULT_VALUES);

  // 硬件设备列表
  const [hardwareList, setHardwareList] = useState<{ id: string; name: string }[]>([]);

  // IP 管理相关
  const [entityIPs, setEntityIPs] = useState<Record<string, Array<{ address: string; status: string }>>>({});
  const [subnets, setSubnets] = useState<Subnet[]>([]);
  const [ipSubnet, setIPSubnet] = useState('');
  const [ipAddress, setIPAddress] = useState('');
  const [entityIPList, setEntityIPList] = useState<Array<{ address: string; subnet_cidr?: string; subnet_id?: string }>>([]);

  // 宿主硬件 IP 和子网（用于 Bridge 自动关联）
  const [hostIps, setHostIps] = useState<Array<{ address: string; subnet_id?: string; subnet_cidr?: string }>>([]);
  const [hostSubnetIds, setHostSubnetIds] = useState<string[]>([]);

  // NAT 映射表单
  const [natHostPort, setNatHostPort] = useState('');
  const [natVmPort, setNatVmPort] = useState('');
  const [natProtocol, setNatProtocol] = useState<'tcp' | 'udp' | 'both'>('tcp');
  const [natDesc, setNatDesc] = useState('');
  // Host-Only 手动 IP
  const [hoManualIp, setHoManualIp] = useState('');

  const loadData = useCallback(async () => {
    const category = filterType === 'all' ? undefined : filterType;
    const res = await driver.getEntities({ type: 'vm', category }, { page, pageSize: 15 });
    setEntities(res.data);
    setTotal(res.total);
    if (res.data.length > 0) {
      const ipMap: Record<string, Array<{ address: string; status: string }>> = {};
      for (const entity of res.data) {
        const ips = await driver.getIPAddresses({ entity_id: entity.id });
        ipMap[entity.id] = ips.map(ip => ({ address: ip.address, status: ip.status }));
      }
      setEntityIPs(ipMap);
    }
  }, [page, filterType, driver]);

  const loadHardwareList = useCallback(async () => {
    const res = await driver.getEntities({ type: 'hardware' }, { page: 1, pageSize: 999 });
    // 只显示设置了虚拟化角色的硬件设备
    const hypervisors = res.data.filter(e => (e.metadata as Record<string, unknown>)?.hypervisor_type);
    setHardwareList(hypervisors.map(e => ({ id: e.id, name: e.name })));
  }, [driver]);

  // 表单提交处理
  const handleFormSubmit = useCallback(async (values: VMFormValues) => {
    const meta = { ...values.metadata };
    const category = meta.vm_type === 'lxc' ? 'lxc' : 'vm';
    const now = new Date().toISOString();
    try {
      if (editItem) {
        await driver.updateEntity(editItem.id, {
          name: values.name.trim(),
          category,
          metadata: meta as Record<string, unknown>,
          updated_at: now,
        });
      } else {
        const newEntity: Entity = {
          id: crypto.randomUUID(),
          name: values.name.trim(),
          type: 'vm',
          category,
          metadata: meta as Record<string, unknown>,
          created_at: now,
          updated_at: now,
        };
        await driver.saveEntity(newEntity);
      }
      showToast(editItem ? '更新成功' : '创建成功', 'success');
      setDrawerOpen(false);
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    }
  }, [editItem, driver, showToast, loadData]);

  const form = useVMForm({ defaultValues: formDefaultValues, onSubmit: handleFormSubmit });

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadHardwareList(); }, [loadHardwareList]);

  /** 行内编辑回调 */
  const handleInlineUpdate = useCallback(async (entity: Entity, field: string, value: string) => {
    try {
      if (field === 'name') {
        await driver.updateEntity(entity.id, { name: value });
      } else if (field === 'host_id') {
        const currentMeta = (entity.metadata || {}) as VMMetadata;
        await driver.updateEntity(entity.id, { metadata: { ...currentMeta, host_id: value || undefined } });
      } else {
        const currentMeta = (entity.metadata || {}) as VMMetadata;
        await driver.updateEntity(entity.id, { metadata: { ...currentMeta, [field]: value || undefined } });
      }
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '更新失败', 'error');
    }
  }, [loadData, showToast, driver]);

  /** 硬件列表选项（用于行内下拉） */
  const hardwareOptions = useMemo(() => hardwareList.map(h => ({ value: h.id, label: h.name })), [hardwareList]);

  /** 加载宿主硬件 IP（推导子网） */
  const loadHostIps = async (hostId: string) => {
    if (!hostId) { setHostIps([]); setHostSubnetIds([]); return; }
    const ips = await driver.getIPAddresses({ entity_id: hostId });
    const subnets = await driver.getSubnets();
    const ipList = ips.map(ip => {
      const subnet = subnets.find(s => s.id === ip.subnet_id);
      return { address: ip.address, subnet_id: ip.subnet_id, subnet_cidr: subnet?.cidr };
    });
    setHostIps(ipList);
    const subIds = [...new Set(ips.map(ip => ip.subnet_id).filter(Boolean))] as string[];
    setHostSubnetIds(subIds);
  };

  /** 加载实体 IP 和子网 */
  const loadEntityIPs = async (entityId: string) => {
    setIPSubnet(''); setIPAddress('');
    const [allSubnets, ips] = await Promise.all([
      driver.getSubnets(),
      driver.getIPAddresses({ entity_id: entityId }),
    ]);
    setSubnets(allSubnets);
    const ipList = ips.map(ip => {
      const subnet = allSubnets.find(s => s.id === ip.subnet_id);
      return { address: ip.address, subnet_cidr: subnet?.cidr, subnet_id: ip.subnet_id };
    });
    setEntityIPList(ipList);
  };

  const openCreate = () => {
    setEditItem(null);
    setFormDefaultValues({
      ...VM_DEFAULT_VALUES,
      metadata: { vm_type: filterType === 'all' ? 'kvm' : filterType },
    });
    setDrawerTab('basic');
    setHostIps([]); setHostSubnetIds([]); setEntityIPList([]);
    setDrawerOpen(true);
  };

  const openEdit = (item: Entity) => {
    setEditItem(item);
    const meta = (item.metadata || {}) as VMMetadataValues;
    setFormDefaultValues({
      name: item.name,
      metadata: meta,
    });
    setDrawerTab('basic');
    setDrawerOpen(true);
    loadEntityIPs(item.id);
    if (meta.host_id) loadHostIps(meta.host_id);
  };

  const openIPTab = (item: Entity) => {
    setEditItem(item);
    const meta = (item.metadata || {}) as VMMetadataValues;
    setFormDefaultValues({
      name: item.name,
      metadata: meta,
    });
    setDrawerTab('ips');
    setDrawerOpen(true);
    loadEntityIPs(item.id);
    if (meta.host_id) loadHostIps(meta.host_id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除？')) return;
    await driver.deleteEntity(id);
    showToast('已删除', 'success'); loadData();
  };

  /** Bridge：分配 IP（手动选子网+可选地址） */
  const handleAssignIP = async () => {
    if (!editItem || !ipSubnet) { showToast('请选择子网', 'error'); return; }
    try {
      const address = ipAddress.trim() || crypto.randomUUID();
      await driver.saveIPAddress({
        id: crypto.randomUUID(),
        address,
        subnet_id: ipSubnet,
        entity_id: editItem.id,
        status: 'assigned',
        description: '',
      });
      showToast(`已分配 IP: ${address}`, 'success');
      setIPAddress(''); loadEntityIPs(editItem.id); loadData();
    } catch (e) { showToast(e instanceof Error ? e.message : '分配失败', 'error'); }
  };

  /** Bridge：一键从宿主子网自动分配 */
  const handleAutoAssignFromHost = async () => {
    if (!editItem) return;
    if (hostSubnetIds.length === 0) { showToast('宿主硬件尚未分配 IP，无法推导子网', 'error'); return; }
    try {
      const address = crypto.randomUUID();
      await driver.saveIPAddress({
        id: crypto.randomUUID(),
        address,
        subnet_id: hostSubnetIds[0]!,
        entity_id: editItem.id,
        status: 'assigned',
        description: '',
      });
      showToast(`已自动分配 IP: ${address}（与宿主同子网）`, 'success');
      loadEntityIPs(editItem.id); loadData();
    } catch (e) { showToast(e instanceof Error ? e.message : '自动分配失败', 'error'); }
  };

  /** 释放 IP */
  const handleReleaseIP = async (address: string) => {
    if (!editItem) return;
    const ips = await driver.getIPAddresses({ entity_id: editItem.id });
    const ipToDelete = ips.find(ip => ip.address === address);
    if (ipToDelete) {
      await driver.deleteIPAddress(ipToDelete.id);
      showToast('已释放', 'success');
      loadEntityIPs(editItem.id);
      loadData();
    }
  };

  /** NAT：添加端口映射 */
  const handleAddNatMapping = () => {
    if (!natHostPort || !natVmPort) { showToast('请填写端口', 'error'); return; }
    const mapping: NatMapping = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      host_port: parseInt(natHostPort), vm_port: parseInt(natVmPort),
      protocol: natProtocol, description: natDesc.trim() || undefined,
    };
    const currentMappings = (form.getFieldValue('metadata.nat_mappings') || []);
    form.setFieldValue('metadata.nat_mappings', [...currentMappings, mapping]);
    setNatHostPort(''); setNatVmPort(''); setNatDesc('');
  };

  /** NAT：删除映射 */
  const handleRemoveNatMapping = (id: string) => {
    const currentMappings = (form.getFieldValue('metadata.nat_mappings') || []);
    form.setFieldValue('metadata.nat_mappings', currentMappings.filter(m => m.id !== id));
  };

  /** Host-Only：手动记录 IP */
  const handleSetHostOnlyIp = () => {
    if (!hoManualIp.trim()) return;
    form.setFieldValue('metadata.ip_address', hoManualIp.trim());
    setHoManualIp(''); showToast('已记录 IP 地址', 'success');
  };

  /** Host-Only：从隔离子网分配 */
  const handleHostOnlyAssign = async () => {
    if (!editItem || !ipSubnet) { showToast('请选择子网', 'error'); return; }
    try {
      const address = ipAddress.trim() || crypto.randomUUID();
      await driver.saveIPAddress({
        id: crypto.randomUUID(),
        address,
        subnet_id: ipSubnet,
        entity_id: editItem.id,
        status: 'assigned',
        description: '',
      });
      showToast(`已分配 IP: ${address}`, 'success');
      setIPAddress(''); loadEntityIPs(editItem.id); loadData();
    } catch (e) { showToast(e instanceof Error ? e.message : '分配失败', 'error'); }
  };

  /** 网络模式变更 → Bridge 自动分配提示 */
  const handleNetworkModeChange = (mode: VMNetworkMode | '') => {
    const newMode = mode || undefined;
    form.setFieldValue('metadata.network_mode', newMode as VMNetworkMode | undefined);
    if (mode === 'bridge' && editItem && hostSubnetIds.length > 0 && entityIPList.length === 0) {
      if (confirm('检测到宿主硬件有可用子网，是否立即为此 VM 自动分配 IP？')) {
        handleAutoAssignFromHost();
      }
    }
  };

  /** 所属硬件变更 */
  const handleHostChange = (hostId: string) => {
    form.setFieldValue('metadata.host_id', hostId || undefined);
    loadHostIps(hostId);
  };

  const isDirty = form.state.isDirty;

  /* 表格列 */
  const columns = [
    columnHelper.display({ id: 'icon', header: '图标', cell: (ctx) => InlineIconCell({ ...ctx }) }),
    columnHelper.display({ id: 'name', header: '名称', cell: (ctx) => {
      const mockCtx = { ...ctx, getValue: () => ctx.row.original.name, column: { ...ctx.column, id: 'name' } };
      return InlineEditCell(mockCtx as any);
    }}),
    columnHelper.display({ id: 'vm_type', header: '类型', cell: ({ row }) => {
      const meta = (row.original.metadata || {}) as VMMetadata;
      const isLxc = meta.vm_type === 'lxc' || row.original.category === 'lxc';
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${isLxc ? 'bg-teal-50 text-teal-700' : 'bg-indigo-50 text-indigo-700'}`}>
          {isLxc ? <Container className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
          {isLxc ? 'LXC' : 'KVM'}
        </span>
      );
    }}),
    columnHelper.display({ id: 'host_id', header: '所属硬件', cell: (ctx) => {
      const meta = (ctx.row.original.metadata || {}) as VMMetadata;
      const mockCtx = { ...ctx, getValue: () => meta.host_id || '', column: { ...ctx.column, id: 'host_id' } };
      return InlineSelectCell({ ...mockCtx, options: hardwareOptions, field: 'host_id' } as any);
    }}),
    columnHelper.display({ id: 'os', header: 'OS', cell: (ctx) => {
      const meta = (ctx.row.original.metadata || {}) as VMMetadata;
      const mockCtx = { ...ctx, getValue: () => meta.os || '', column: { ...ctx.column, id: 'os' } };
      return InlineEditCell(mockCtx as any);
    }}),
    columnHelper.display({ id: 'cpu', header: 'CPU', cell: (ctx) => {
      const meta = (ctx.row.original.metadata || {}) as VMMetadata;
      const mockCtx = { ...ctx, getValue: () => meta.cpu || '', column: { ...ctx.column, id: 'cpu' } };
      return InlineEditCell(mockCtx as any);
    }}),
    columnHelper.display({ id: 'ram', header: '内存', cell: (ctx) => {
      const meta = (ctx.row.original.metadata || {}) as VMMetadata;
      const mockCtx = { ...ctx, getValue: () => meta.ram ? String(meta.ram) : '', column: { ...ctx.column, id: 'ram' } };
      return InlineEditCell(mockCtx as any);
    }}),
    columnHelper.display({ id: 'network_mode', header: '网络模式', cell: ({ row }) => {
      const meta = (row.original.metadata || {}) as VMMetadata;
      return meta.network_mode ? <span className="text-xs text-slate-600">{VM_NETWORK_MODES[meta.network_mode]}</span> : <span className="text-slate-400 text-xs">-</span>;
    }}),
    columnHelper.display({ id: 'ips', header: 'IP 地址', cell: ({ row }) => {
      const ips = entityIPs[row.original.id];
      return (
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 flex-1">
            {ips?.length ? ips.map(ip => (
              <span key={ip.address} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-mono">{ip.address}</span>
            )) : <span className="text-slate-400 text-xs">未分配</span>}
          </div>
          <button onClick={(e) => { e.stopPropagation(); openIPTab(row.original); }} className="p-1 hover:bg-blue-50 rounded shrink-0" title="管理IP">
            <Network className="w-3.5 h-3.5 text-blue-500" />
          </button>
        </div>
      );
    }}),
    columnHelper.display({ id: 'actions', header: () => <span className="block text-right">操作</span>, cell: ({ row }) => (
      <div className="text-right whitespace-nowrap">
        <button onClick={(e) => { e.stopPropagation(); openEdit(row.original); }} className="p-1 hover:bg-slate-100 rounded"><Edit className="w-4 h-4 text-slate-500" /></button>
        <button onClick={(e) => { e.stopPropagation(); handleDelete(row.original.id); }} className="p-1 hover:bg-red-50 rounded ml-1"><Trash2 className="w-4 h-4 text-red-500" /></button>
      </div>
    )}),
  ] as ColumnDef<SimpleFeatures, Entity>[];

  const table = useTable({ features: simpleFeatures, columns, data: entities, meta: { updateData: handleInlineUpdate } as TableMeta });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">虚拟机 / LXC 管理</h2>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium">
          <Plus className="w-4 h-4" />新建
        </button>
      </div>

      {/* 类型筛选 Tab */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {([['all', '全部'], ['kvm', 'KVM 虚拟机'], ['lxc', 'LXC 容器']] as const).map(([key, label]) => (
          <button key={key} onClick={() => { setFilterType(key); setPage(1); }}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${filterType === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-visible">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>{hg.headers.map(h => (
                <th key={h.id} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}</tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                {row.getAllCells().map((cell: any) => (
                  <td key={cell.id} className="px-4 py-3">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
            {entities.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400">暂无数据</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={15} total={total} onChange={setPage} />

      {/* 抽屉 */}
      <Drawer open={drawerOpen} onClose={() => { setFormDefaultValues(VM_DEFAULT_VALUES); setDrawerOpen(false); }} title={editItem ? `编辑 - ${editItem.name}` : `新建${form.getFieldValue('metadata.vm_type') === 'lxc' ? ' LXC 容器' : '虚拟机'}`}
        onBeforeClose={isDirty ? () => confirm('有未保存的更改，确定关闭？') : undefined}
        footer={<div className="flex gap-2 justify-end"><button onClick={() => { setFormDefaultValues(VM_DEFAULT_VALUES); setDrawerOpen(false); }} className="px-4 py-2 text-sm border rounded-lg hover:bg-slate-50">取消</button><button onClick={() => form.handleSubmit()} disabled={form.state.isSubmitting} className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50">保存</button></div>}
      >
        {/* Tab 切换 */}
        <div className="flex border-b mb-4">
          <button onClick={() => setDrawerTab('basic')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${drawerTab === 'basic' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>基本信息</button>
          {editItem && <button onClick={() => setDrawerTab('ips')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${drawerTab === 'ips' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>IP / 网络</button>}
        </div>

        {/* 基本信息 Tab */}
        {drawerTab === 'basic' && (
          <div className="space-y-4">
            {/* 类型选择（KVM / LXC） */}
            <form.Field name="metadata.vm_type">
              {(field) => (
                <div><label className="block text-xs font-medium text-slate-600 mb-1">类型 *</label>
                  <div className="flex gap-2">
                    {(['kvm', 'lxc'] as const).map(t => (
                      <button key={t} type="button" onClick={() => field.handleChange(t)}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${field.state.value === t ? (t === 'lxc' ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-indigo-500 bg-indigo-50 text-indigo-700') : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                        {t === 'lxc' ? <Container className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
                        {VM_TYPE_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form.Field>

            {/* 名称 */}
            <form.Field name="name">
              {(field) => (
                <FormInput field={field} label="名称" required placeholder="如：web-server-01" />
              )}
            </form.Field>

            {/* 所属硬件 */}
            <form.Field name="metadata.host_id">
              {(field) => (
                <div><label className="block text-xs font-medium text-slate-600 mb-1">所属硬件</label>
                  <select value={(field.state.value as string) || ''} onChange={e => handleHostChange(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">未指定</option>
                    {hardwareList.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select></div>
              )}
            </form.Field>

            {/* PVE VMID + 网络模式 */}
            <div className="grid grid-cols-2 gap-3">
              <form.Field name="metadata.vmid">
                {(field) => (
                  <div><label className="block text-xs font-medium text-slate-600 mb-1">VMID</label>
                    <input type="number" value={(field.state.value as number) ?? ''} onChange={e => field.handleChange(e.target.value ? Number(e.target.value) : undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="PVE 编号" /></div>
                )}
              </form.Field>
              <form.Field name="metadata.network_mode">
                {(field) => (
                  <div><label className="block text-xs font-medium text-slate-600 mb-1">网络模式</label>
                    <select value={(field.state.value as string) || ''} onChange={e => handleNetworkModeChange(e.target.value as VMNetworkMode | '')} className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="">未指定</option>
                      {Object.entries(VM_NETWORK_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></div>
                )}
              </form.Field>
            </div>

            {/* LXC 特有字段 */}
            <form.Subscribe selector={(s) => s.values.metadata.vm_type}>
              {(vmType) => vmType === 'lxc' && (
                <div className="space-y-3 p-3 bg-teal-50/50 border border-teal-100 rounded-lg">
                  <p className="text-xs font-semibold text-teal-700">LXC 容器配置</p>
                  <form.Field name="metadata.template">
                    {(field) => (
                      <div><label className="block text-xs font-medium text-slate-600 mb-1">模板</label>
                        <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="如 ubuntu-22.04-standard" /></div>
                    )}
                  </form.Field>
                  <div className="flex gap-4">
                    <form.Field name="metadata.unprivileged">
                      {(field) => (
                        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                          <input type="checkbox" checked={field.state.value ?? true} onChange={e => field.handleChange(e.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                          非特权容器
                        </label>
                      )}
                    </form.Field>
                    <form.Field name="metadata.nesting">
                      {(field) => (
                        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                          <input type="checkbox" checked={field.state.value ?? false} onChange={e => field.handleChange(e.target.checked)} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                          允许嵌套
                        </label>
                      )}
                    </form.Field>
                  </div>
                </div>
              )}
            </form.Subscribe>

            <div className="grid grid-cols-2 gap-3">
              <form.Field name="metadata.hostname">
                {(field) => (
                  <div><label className="block text-xs font-medium text-slate-600 mb-1">Hostname</label>
                    <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                )}
              </form.Field>
              <form.Field name="metadata.mac_address">
                {(field) => (
                  <div><label className="block text-xs font-medium text-slate-600 mb-1">MAC 地址</label>
                    <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="xx:xx:xx:xx:xx:xx" /></div>
                )}
              </form.Field>
            </div>

            <form.Field name="metadata.os">
              {(field) => (
                <div><label className="block text-xs font-medium text-slate-600 mb-1">操作系统</label>
                  <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              )}
            </form.Field>

            <div className="grid grid-cols-3 gap-3">
              <form.Field name="metadata.cpu">
                {(field) => (
                  <div><label className="block text-xs font-medium text-slate-600 mb-1">CPU</label>
                    <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                )}
              </form.Field>
              <form.Field name="metadata.ram">
                {(field) => (
                  <div><label className="block text-xs font-medium text-slate-600 mb-1">内存(GB)</label>
                    <input type="number" value={(field.state.value as number) ?? ''} onChange={e => field.handleChange(e.target.value ? Number(e.target.value) : undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                )}
              </form.Field>
              <form.Field name="metadata.disk">
                {(field) => (
                  <div><label className="block text-xs font-medium text-slate-600 mb-1">磁盘(GB)</label>
                    <input type="number" value={(field.state.value as number) ?? ''} onChange={e => field.handleChange(e.target.value ? Number(e.target.value) : undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                )}
              </form.Field>
            </div>

            <form.Field name="metadata.icon">
              {(field) => (
                <div><label className="block text-xs font-medium text-slate-600 mb-1">图标</label>
                  <IconPicker value={(field.state.value as string) || ''} onChange={v => field.handleChange(v || undefined)} /></div>
              )}
            </form.Field>

            <form.Field name="metadata.note">
              {(field) => (
                <div><label className="block text-xs font-medium text-slate-600 mb-1">备注</label>
                  <textarea value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} /></div>
              )}
            </form.Field>
          </div>
        )}

        {/* IP/网络 Tab — 根据网络模式显示不同内容 */}
        {drawerTab === 'ips' && editItem && (
          <form.Subscribe selector={(s) => ({ networkMode: s.values.metadata.network_mode, natMappings: s.values.metadata.nat_mappings, ipAddress: s.values.metadata.ip_address })}>
            {({ networkMode, natMappings, ipAddress: formIpAddress }) => (
          <div className="space-y-4">
            {/* 模式标题 */}
            <div className="text-xs text-slate-500">当前网络模式：<span className="font-medium text-slate-700">{networkMode ? VM_NETWORK_MODES[networkMode] : '未指定'}</span></div>

            {/* ====== Bridge 模式 ====== */}
            {networkMode === 'bridge' && (
              <div className="space-y-3">
                {/* 宿主子网信息 */}
                {hostIps.length > 0 && (
                  <div className="p-3 bg-blue-50 rounded-lg text-xs">
                    <p className="font-medium text-blue-700 mb-1">宿主硬件 IP（同子网）</p>
                    <div className="flex flex-wrap gap-1">{hostIps.map(ip => <span key={ip.address} className="px-2 py-0.5 bg-white rounded font-mono text-blue-600">{ip.address}{ip.subnet_cidr ? ` (${ip.subnet_cidr})` : ''}</span>)}</div>
                  </div>
                )}
                {/* 一键分配 */}
                <button onClick={handleAutoAssignFromHost} disabled={hostSubnetIds.length === 0}
                  className="w-full px-3 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white rounded-lg">
                  ⚡ 一键分配（从宿主子网自动选取）
                </button>
                {/* 已分配 IP 列表 */}
                {entityIPList.length > 0 && (
                  <div><p className="text-xs font-medium text-slate-600 mb-1">已分配 IP</p>
                    <div className="space-y-1">{entityIPList.map(ip => (
                      <div key={ip.address} className="flex items-center justify-between px-3 py-1.5 bg-slate-50 rounded">
                        <span className="font-mono text-xs text-slate-700">{ip.address}{ip.subnet_cidr ? ` (${ip.subnet_cidr})` : ''}</span>
                        <button onClick={() => handleReleaseIP(ip.address)} className="text-red-500 hover:text-red-700 text-xs">释放</button>
                      </div>
                    ))}</div>
                  </div>
                )}
                {/* 手动选子网分配 */}
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">手动分配</p>
                  <select value={ipSubnet} onChange={e => setIPSubnet(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mb-2">
                    <option value="">选择子网...</option>
                    {subnets.map(s => <option key={s.id} value={s.id}>{s.cidr} - {s.description || s.gateway}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <input value={ipAddress} onChange={e => setIPAddress(e.target.value)} placeholder="IP（留空自动）" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                    <button onClick={handleAssignIP} disabled={!ipSubnet} className="px-3 py-2 text-sm bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg">分配</button>
                  </div>
                </div>
              </div>
            )}

            {/* ====== NAT 模式 ====== */}
            {networkMode === 'nat' && (
              <div className="space-y-3">
                {/* 宿主 IP（只读） */}
                {hostIps.length > 0 && (
                  <div className="p-3 bg-amber-50 rounded-lg text-xs">
                    <p className="font-medium text-amber-700 mb-1">宿主硬件 IP（外部访问地址）</p>
                    <div className="flex flex-wrap gap-1">{hostIps.map(ip => <span key={ip.address} className="px-2 py-0.5 bg-white rounded font-mono text-amber-600">{ip.address}</span>)}</div>
                  </div>
                )}
                {/* 端口映射表 */}
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-2">端口映射</p>
                  {(natMappings || []).length > 0 ? (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50"><tr><th className="px-2 py-1.5 text-left">宿主端口</th><th className="px-2 py-1.5 text-left">VM端口</th><th className="px-2 py-1.5 text-left">协议</th><th className="px-2 py-1.5 text-left">描述</th><th></th></tr></thead>
                        <tbody className="divide-y">{(natMappings || []).map(m => (
                          <tr key={m.id}><td className="px-2 py-1.5 font-mono">{m.host_port}</td><td className="px-2 py-1.5 font-mono">{m.vm_port}</td><td className="px-2 py-1.5">{m.protocol}</td><td className="px-2 py-1.5 text-slate-500">{m.description || '-'}</td>
                            <td className="px-2 py-1.5"><button onClick={() => handleRemoveNatMapping(m.id)} className="text-red-500 hover:text-red-700"><Trash2 className="w-3 h-3" /></button></td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : <p className="text-xs text-slate-400">暂无映射规则</p>}
                </div>
                {/* 新增映射 */}
                <div className="border-t pt-3 space-y-2">
                  <p className="text-xs font-medium text-slate-600">添加映射</p>
                  <div className="grid grid-cols-4 gap-2">
                    <input type="number" value={natHostPort} onChange={e => setNatHostPort(e.target.value)} placeholder="宿主端口" className="px-2 py-1.5 border rounded text-xs" />
                    <input type="number" value={natVmPort} onChange={e => setNatVmPort(e.target.value)} placeholder="VM端口" className="px-2 py-1.5 border rounded text-xs" />
                    <select value={natProtocol} onChange={e => setNatProtocol(e.target.value as 'tcp' | 'udp' | 'both')} className="px-2 py-1.5 border rounded text-xs">
                      <option value="tcp">TCP</option><option value="udp">UDP</option><option value="both">Both</option>
                    </select>
                    <input value={natDesc} onChange={e => setNatDesc(e.target.value)} placeholder="描述" className="px-2 py-1.5 border rounded text-xs" />
                  </div>
                  <button onClick={handleAddNatMapping} className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-lg">添加</button>
                </div>
              </div>
            )}

            {/* ====== Host-Only 模式 ====== */}
            {networkMode === 'host-only' && (
              <div className="space-y-3">
                <div className="p-3 bg-green-50 rounded-lg text-xs text-green-700">
                  <p className="font-medium mb-1">Host-Only 隔离网络</p>
                  <p>VM 位于独立隔离子网，仅与宿主通信。可手动输入 IP 或从子网分配。</p>
                </div>
                {/* 当前 IP */}
                {formIpAddress && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded">
                    <span className="text-xs text-slate-500">手动 IP：</span>
                    <span className="font-mono text-sm text-slate-700">{formIpAddress}</span>
                  </div>
                )}
                {entityIPList.length > 0 && (
                  <div><p className="text-xs font-medium text-slate-600 mb-1">IPAM 已分配</p>
                    <div className="space-y-1">{entityIPList.map(ip => (
                      <div key={ip.address} className="flex items-center justify-between px-3 py-1.5 bg-slate-50 rounded">
                        <span className="font-mono text-xs">{ip.address}{ip.subnet_cidr ? ` (${ip.subnet_cidr})` : ''}</span>
                        <button onClick={() => handleReleaseIP(ip.address)} className="text-red-500 text-xs">释放</button>
                      </div>
                    ))}</div>
                  </div>
                )}
                {/* 手动输入 */}
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">手动输入 IP</p>
                  <div className="flex gap-2">
                    <input value={hoManualIp} onChange={e => setHoManualIp(e.target.value)} placeholder="如 192.168.56.10" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                    <button onClick={handleSetHostOnlyIp} className="px-3 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg">记录</button>
                  </div>
                </div>
                {/* 从子网分配 */}
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">从子网分配</p>
                  <select value={ipSubnet} onChange={e => setIPSubnet(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mb-2">
                    <option value="">选择隔离子网...</option>
                    {subnets.map(s => <option key={s.id} value={s.id}>{s.cidr} - {s.description || s.gateway}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <input value={ipAddress} onChange={e => setIPAddress(e.target.value)} placeholder="IP（留空自动）" className="flex-1 px-3 py-2 border rounded-lg text-sm" />
                    <button onClick={handleHostOnlyAssign} disabled={!ipSubnet} className="px-3 py-2 text-sm bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg">分配</button>
                  </div>
                </div>
              </div>
            )}

            {/* 未指定网络模式 */}
            {!networkMode && (
              <div className="p-4 text-center text-slate-400 text-sm">
                请先在「基本信息」中选择网络模式
              </div>
            )}
          </div>
            )}
          </form.Subscribe>
        )}
      </Drawer>
    </div>
  );
}
