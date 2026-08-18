/** 路由与 NAT 管理面板 */
import { useState, useEffect, useCallback } from 'react';
import { useStorageDriver } from '../hooks/useStorage';
import { useApp } from '../context/AppContext';
import type { StaticRoute, NatRule, NatType, Entity, FirewallZone, LogicalInterface } from '../types';
import { Plus, Trash2, Edit, ToggleLeft, ToggleRight, Monitor } from 'lucide-react';
import { simpleFeatures, createColumnHelper, flexRender, useTable } from '../../lib/table';
import type { SimpleFeatures } from '../../lib/table';
import type { ColumnDef } from '@tanstack/react-table';
type SubTab = 'routes' | 'nat';

const routeColumnHelper = createColumnHelper<SimpleFeatures, StaticRoute>();
const natColumnHelper = createColumnHelper<SimpleFeatures, NatRule>();

const NAT_TYPE_LABELS: Record<NatType, string> = { masquerade: 'MASQUERADE', snat: 'SNAT', dnat: 'DNAT' };
const NAT_TYPE_COLORS: Record<NatType, string> = {
  masquerade: 'bg-purple-100 text-purple-700',
  snat: 'bg-blue-100 text-blue-700',
  dnat: 'bg-amber-100 text-amber-700',
};

export function RoutingNatPanel() {
  const driver = useStorageDriver();
  const { showToast } = useApp();
  const [subTab, setSubTab] = useState<SubTab>('routes');

  // 设备选择
  const [devices, setDevices] = useState<Entity[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');

  // 静态路由
  const [routes, setRoutes] = useState<StaticRoute[]>([]);
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [editingRoute, setEditingRoute] = useState<StaticRoute | null>(null);
  const [routeForm, setRouteForm] = useState({ destination: '', next_hop: '', out_interface: '', metric: 0, description: '' });

  // NAT 规则
  const [natRules, setNatRules] = useState<NatRule[]>([]);
  const [showNatForm, setShowNatForm] = useState(false);
  const [editingNat, setEditingNat] = useState<NatRule | null>(null);
  const [natForm, setNatForm] = useState({ nat_type: 'masquerade' as NatType, protocol: 'all', src_zone: '', src_ip: '', dest_zone: '', dest_ip: '', dest_port: '', translate_ip: '', translate_port: '', out_interface: '', priority: 100, description: '' });

  // 辅助数据
  const [zones, setZones] = useState<FirewallZone[]>([]);
  const [logicalIfaces, setLogicalIfaces] = useState<LogicalInterface[]>([]);

  // 加载可管理路由的设备（router + switch）
  const loadDevices = useCallback(async () => {
    const r1 = await driver.getEntities({ type: 'hardware', category: 'router' });
    const r2 = await driver.getEntities({ type: 'hardware', category: 'switch' });
    setDevices([...r1.data, ...r2.data]);
  }, [driver]);

  const loadRoutes = useCallback(async () => {
    if (!selectedDevice) { setRoutes([]); return; }
    const data = await driver.getStaticRoutes(selectedDevice);
    setRoutes(data);
  }, [selectedDevice, driver]);

  const loadNatRules = useCallback(async () => {
    if (!selectedDevice) { setNatRules([]); return; }
    const data = await driver.getNatRules(selectedDevice);
    setNatRules(data);
  }, [selectedDevice, driver]);

  const loadZones = useCallback(async () => {
    const data = await driver.getFirewallZones();
    setZones(data);
  }, [driver]);

  const loadLogicalIfaces = useCallback(async () => {
    if (!selectedDevice) { setLogicalIfaces([]); return; }
    const data = await driver.getLogicalInterfaces(selectedDevice);
    setLogicalIfaces(data);
  }, [selectedDevice, driver]);

  useEffect(() => { loadDevices(); loadZones(); }, [loadDevices, loadZones]);
  useEffect(() => { loadRoutes(); loadNatRules(); loadLogicalIfaces(); }, [loadRoutes, loadNatRules, loadLogicalIfaces]);

  // 路由操作
  const openRouteForm = (route?: StaticRoute) => {
    if (route) {
      setEditingRoute(route);
      setRouteForm({ destination: route.destination, next_hop: route.next_hop, out_interface: route.out_interface, metric: route.metric, description: route.description });
    } else {
      setEditingRoute(null);
      setRouteForm({ destination: '', next_hop: '', out_interface: '', metric: 0, description: '' });
    }
    setShowRouteForm(true);
  };

  const saveRoute = async () => {
    if (!routeForm.destination) { showToast('目标网段不能为空', 'error'); return; }
    if (!selectedDevice) { showToast('请先选择设备', 'error'); return; }
    try {
      if (editingRoute) {
        const route: any = {
          ...editingRoute,
          destination: routeForm.destination,
          next_hop: routeForm.next_hop,
          out_interface: routeForm.out_interface,
          metric: routeForm.metric,
          description: routeForm.description,
        };
        await driver.saveStaticRoute(route);
      } else {
        const route: any = {
          id: crypto.randomUUID(),
          entity_id: selectedDevice,
          destination: routeForm.destination,
          next_hop: routeForm.next_hop,
          out_interface: routeForm.out_interface,
          metric: routeForm.metric,
          description: routeForm.description,
          enabled: 1,
        };
        await driver.saveStaticRoute(route);
      }
      showToast(editingRoute ? '路由已更新' : '路由已创建', 'success');
      setShowRouteForm(false);
      loadRoutes();
    } catch { showToast('操作失败', 'error'); }
  };

  const deleteRoute = async (id: string) => {
    if (!confirm('确认删除该路由条目？')) return;
    try {
      await driver.deleteStaticRoute(id);
      showToast('已删除', 'success');
      loadRoutes();
    } catch { showToast('删除失败', 'error'); }
  };

  const toggleRoute = async (route: StaticRoute) => {
    try {
      const updated: any = { ...route, enabled: route.enabled ? 0 : 1 };
      await driver.saveStaticRoute(updated);
      loadRoutes();
    } catch { showToast('更新失败', 'error'); }
  };

  // NAT 操作
  const openNatForm = (rule?: NatRule) => {
    if (rule) {
      setEditingNat(rule);
      setNatForm({ nat_type: rule.nat_type, protocol: rule.protocol, src_zone: rule.src_zone, src_ip: rule.src_ip, dest_zone: rule.dest_zone, dest_ip: rule.dest_ip, dest_port: rule.dest_port, translate_ip: rule.translate_ip, translate_port: rule.translate_port, out_interface: rule.out_interface, priority: rule.priority, description: rule.description });
    } else {
      setEditingNat(null);
      setNatForm({ nat_type: 'masquerade', protocol: 'all', src_zone: '', src_ip: '', dest_zone: '', dest_ip: '', dest_port: '', translate_ip: '', translate_port: '', out_interface: '', priority: 100, description: '' });
    }
    setShowNatForm(true);
  };

  const saveNat = async () => {
    if (!selectedDevice) { showToast('请先选择设备', 'error'); return; }
    try {
      if (editingNat) {
        const nat: any = {
          ...editingNat,
          nat_type: natForm.nat_type,
          protocol: natForm.protocol,
          src_zone: natForm.src_zone,
          src_ip: natForm.src_ip,
          dest_zone: natForm.dest_zone,
          dest_ip: natForm.dest_ip,
          dest_port: natForm.dest_port,
          translate_ip: natForm.translate_ip,
          translate_port: natForm.translate_port,
          out_interface: natForm.out_interface,
          priority: natForm.priority,
          description: natForm.description,
        };
        await driver.saveNatRule(nat);
      } else {
        const nat: any = {
          id: crypto.randomUUID(),
          entity_id: selectedDevice,
          nat_type: natForm.nat_type,
          protocol: natForm.protocol,
          src_zone: natForm.src_zone,
          src_ip: natForm.src_ip,
          dest_zone: natForm.dest_zone,
          dest_ip: natForm.dest_ip,
          dest_port: natForm.dest_port,
          translate_ip: natForm.translate_ip,
          translate_port: natForm.translate_port,
          out_interface: natForm.out_interface,
          priority: natForm.priority,
          description: natForm.description,
          enabled: 1,
        };
        await driver.saveNatRule(nat);
      }
      showToast(editingNat ? 'NAT 规则已更新' : 'NAT 规则已创建', 'success');
      setShowNatForm(false);
      loadNatRules();
    } catch { showToast('操作失败', 'error'); }
  };

  const deleteNat = async (id: string) => {
    if (!confirm('确认删除该 NAT 规则？')) return;
    try {
      await driver.deleteNatRule(id);
      showToast('已删除', 'success');
      loadNatRules();
    } catch { showToast('删除失败', 'error'); }
  };

  const toggleNat = async (rule: NatRule) => {
    try {
      const updated: any = { ...rule, enabled: rule.enabled ? 0 : 1 };
      await driver.saveNatRule(updated);
      loadNatRules();
    } catch { showToast('更新失败', 'error'); }
  };

  // 路由表列定义
  const routeColumns = [
    routeColumnHelper.accessor('destination', {
      header: '目标网段',
      cell: ({ getValue }) => {
        const v = getValue();
        return v === '0.0.0.0/0' ? <span className="text-blue-600 font-semibold">默认路由</span> : <span className="font-mono">{v}</span>;
      },
    }),
    routeColumnHelper.accessor('next_hop', {
      header: '下一跳',
      cell: ({ getValue }) => <span className="font-mono">{getValue() || '-'}</span>,
    }),
    routeColumnHelper.accessor('out_interface', {
      header: '出接口',
      cell: ({ getValue }) => getValue() || '-',
    }),
    routeColumnHelper.accessor('metric', { header: '度量值' }),
    routeColumnHelper.display({
      id: 'enabled',
      header: '状态',
      cell: ({ row }) => (
        <button onClick={() => toggleRoute(row.original)} className="text-slate-500 hover:text-blue-500">
          {row.original.enabled ? <ToggleRight size={18} className="text-emerald-500" /> : <ToggleLeft size={18} />}
        </button>
      ),
    }),
    routeColumnHelper.accessor('description', {
      header: '描述',
      cell: ({ getValue }) => <span className="text-slate-500">{getValue()}</span>,
    }),
    routeColumnHelper.display({
      id: 'actions',
      header: () => <span className="block text-right">操作</span>,
      cell: ({ row }) => (
        <div className="text-right">
          <button onClick={() => openRouteForm(row.original)} className="text-slate-400 hover:text-blue-500 mr-2"><Edit size={14} /></button>
          <button onClick={() => deleteRoute(row.original.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
        </div>
      ),
    }),
  ] as ColumnDef<SimpleFeatures, StaticRoute>[];

  const routeTable = useTable({ features: simpleFeatures, columns: routeColumns, data: routes });

  // NAT 规则列定义
  const natColumns = [
    natColumnHelper.accessor('nat_type', {
      header: '类型',
      cell: ({ getValue }) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${NAT_TYPE_COLORS[getValue()]}`}>
          {NAT_TYPE_LABELS[getValue()]}
        </span>
      ),
    }),
    natColumnHelper.accessor('protocol', { header: '协议' }),
    natColumnHelper.display({
      id: 'src',
      header: '源',
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.src_zone && <span className="text-slate-600">{row.original.src_zone}</span>}
          {row.original.src_ip && <span className="ml-1 font-mono">{row.original.src_ip}</span>}
        </span>
      ),
    }),
    natColumnHelper.display({
      id: 'dest',
      header: '目标',
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.dest_zone && <span className="text-slate-600">{row.original.dest_zone}</span>}
          {row.original.dest_ip && <span className="ml-1 font-mono">{row.original.dest_ip}</span>}
          {row.original.dest_port && <span className="ml-1 font-mono">:{row.original.dest_port}</span>}
        </span>
      ),
    }),
    natColumnHelper.display({
      id: 'translate',
      header: '转换',
      cell: ({ row }) => (
        <span className="text-xs font-mono">
          {row.original.translate_ip}{row.original.translate_port && `:${row.original.translate_port}`}
          {!row.original.translate_ip && !row.original.translate_port && '-'}
        </span>
      ),
    }),
    natColumnHelper.accessor('priority', { header: '优先级' }),
    natColumnHelper.display({
      id: 'nat_enabled',
      header: '状态',
      cell: ({ row }) => (
        <button onClick={() => toggleNat(row.original)} className="text-slate-500 hover:text-blue-500">
          {row.original.enabled ? <ToggleRight size={18} className="text-emerald-500" /> : <ToggleLeft size={18} />}
        </button>
      ),
    }),
    natColumnHelper.display({
      id: 'actions',
      header: () => <span className="block text-right">操作</span>,
      cell: ({ row }) => (
        <div className="text-right">
          <button onClick={() => openNatForm(row.original)} className="text-slate-400 hover:text-blue-500 mr-2"><Edit size={14} /></button>
          <button onClick={() => deleteNat(row.original.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
        </div>
      ),
    }),
  ] as ColumnDef<SimpleFeatures, NatRule>[];

  const natTable = useTable({ features: simpleFeatures, columns: natColumns, data: natRules });

  return (
    <div className="space-y-4">
      {/* 设备选择器 — 按钮列表风格 */}
      <div className="flex gap-2 flex-wrap">
        {devices.map(d => (
          <button key={d.id} onClick={() => setSelectedDevice(d.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${selectedDevice === d.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:border-slate-300'}`}>
            <Monitor className="w-4 h-4" />
            <span className="font-medium">{d.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded">{d.category}</span>
          </button>
        ))}
        {devices.length === 0 && <p className="text-sm text-slate-400">暂无路由/交换设备</p>}
      </div>

      {/* 子Tab切换 */}
      {selectedDevice && (
        <div className="flex items-center gap-4">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {(['routes', 'nat'] as SubTab[]).map(t => (
              <button key={t} onClick={() => setSubTab(t)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${subTab === t ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
                {t === 'routes' ? '静态路由' : 'NAT 规则'}
              </button>
            ))}
          </div>
        </div>
      )}

      {!selectedDevice && devices.length > 0 && (
        <div className="text-center py-12 text-slate-400">请选择一个路由器或交换机设备</div>
      )}

      {/* 静态路由 Tab */}
      {selectedDevice && subTab === 'routes' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium text-slate-700">路由表</h3>
            <button onClick={() => openRouteForm()} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600">
              <Plus size={14} /> 添加路由
            </button>
          </div>

          {/* 路由表格 */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                {routeTable.getHeaderGroups().map(hg => (
                  <tr key={hg.id}>
                    {hg.headers.map(header => (
                      <th key={header.id} className="px-3 py-2 text-left font-medium text-slate-600">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y">
                {routeTable.getRowModel().rows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">暂无路由条目</td></tr>
                )}
                {routeTable.getRowModel().rows.map(row => (
                  <tr key={row.id} className={`hover:bg-slate-50 ${!row.original.enabled ? 'opacity-50' : ''}`}>
                    {row.getAllCells().map(cell => (
                      <td key={cell.id} className="px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 路由编辑表单 */}
          {showRouteForm && (
            <div className="border rounded-lg p-4 bg-slate-50 space-y-3">
              <h4 className="text-sm font-medium">{editingRoute ? '编辑路由' : '添加路由'}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">目标网段 (CIDR)</label>
                  <input value={routeForm.destination} onChange={e => setRouteForm(f => ({ ...f, destination: e.target.value }))}
                    placeholder="如 10.0.2.0/24 或 0.0.0.0/0" className="w-full px-2 py-1.5 text-sm border rounded" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">下一跳 IP</label>
                  <input value={routeForm.next_hop} onChange={e => setRouteForm(f => ({ ...f, next_hop: e.target.value }))}
                    placeholder="如 192.168.1.1" className="w-full px-2 py-1.5 text-sm border rounded" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">出接口</label>
                  <select value={routeForm.out_interface} onChange={e => setRouteForm(f => ({ ...f, out_interface: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border rounded bg-white">
                    <option value="">不指定</option>
                    {logicalIfaces.map(li => <option key={li.id} value={li.name}>{li.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">度量值 (Metric)</label>
                  <input type="number" value={routeForm.metric} onChange={e => setRouteForm(f => ({ ...f, metric: parseInt(e.target.value) || 0 }))}
                    className="w-full px-2 py-1.5 text-sm border rounded" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-500 mb-1">描述</label>
                  <input value={routeForm.description} onChange={e => setRouteForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border rounded" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={saveRoute} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">保存</button>
                <button onClick={() => setShowRouteForm(false)} className="px-3 py-1.5 text-sm border rounded hover:bg-slate-100">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* NAT 规则 Tab */}
      {selectedDevice && subTab === 'nat' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-medium text-slate-700">NAT 规则</h3>
            <button onClick={() => openNatForm()} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600">
              <Plus size={14} /> 添加规则
            </button>
          </div>

          {/* NAT 表格 */}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                {natTable.getHeaderGroups().map(hg => (
                  <tr key={hg.id}>
                    {hg.headers.map(header => (
                      <th key={header.id} className="px-3 py-2 text-left font-medium text-slate-600">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y">
                {natTable.getRowModel().rows.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">暂无 NAT 规则</td></tr>
                )}
                {natTable.getRowModel().rows.map(row => (
                  <tr key={row.id} className={`hover:bg-slate-50 ${!row.original.enabled ? 'opacity-50' : ''}`}>
                    {row.getAllCells().map(cell => (
                      <td key={cell.id} className="px-3 py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* NAT 编辑表单 */}
          {showNatForm && (
            <div className="border rounded-lg p-4 bg-slate-50 space-y-3">
              <h4 className="text-sm font-medium">{editingNat ? '编辑 NAT 规则' : '添加 NAT 规则'}</h4>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">NAT 类型</label>
                  <select value={natForm.nat_type} onChange={e => setNatForm(f => ({ ...f, nat_type: e.target.value as NatType }))}
                    className="w-full px-2 py-1.5 text-sm border rounded bg-white">
                    <option value="masquerade">MASQUERADE（动态源地址转换）</option>
                    <option value="snat">SNAT（静态源地址转换）</option>
                    <option value="dnat">DNAT（目标地址转换/端口映射）</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">协议</label>
                  <select value={natForm.protocol} onChange={e => setNatForm(f => ({ ...f, protocol: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border rounded bg-white">
                    <option value="all">全部</option>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">优先级</label>
                  <input type="number" value={natForm.priority} onChange={e => setNatForm(f => ({ ...f, priority: parseInt(e.target.value) || 100 }))}
                    className="w-full px-2 py-1.5 text-sm border rounded" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">源区域</label>
                  <select value={natForm.src_zone} onChange={e => setNatForm(f => ({ ...f, src_zone: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border rounded bg-white">
                    <option value="">不指定</option>
                    {zones.map(z => <option key={z.id} value={z.name}>{z.display_name} ({z.name})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">目标区域</label>
                  <select value={natForm.dest_zone} onChange={e => setNatForm(f => ({ ...f, dest_zone: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border rounded bg-white">
                    <option value="">不指定</option>
                    {zones.map(z => <option key={z.id} value={z.name}>{z.display_name} ({z.name})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">源 IP</label>
                  <input value={natForm.src_ip} onChange={e => setNatForm(f => ({ ...f, src_ip: e.target.value }))}
                    placeholder="如 192.168.1.0/24" className="w-full px-2 py-1.5 text-sm border rounded" />
                </div>
                {natForm.nat_type === 'dnat' && (
                  <>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">外部端口（入站端口）</label>
                      <input value={natForm.dest_port} onChange={e => setNatForm(f => ({ ...f, dest_port: e.target.value }))}
                        placeholder="如 8080" className="w-full px-2 py-1.5 text-sm border rounded" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">转发目标 IP</label>
                      <input value={natForm.translate_ip} onChange={e => setNatForm(f => ({ ...f, translate_ip: e.target.value }))}
                        placeholder="如 192.168.1.100" className="w-full px-2 py-1.5 text-sm border rounded" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">转发目标端口</label>
                      <input value={natForm.translate_port} onChange={e => setNatForm(f => ({ ...f, translate_port: e.target.value }))}
                        placeholder="如 80" className="w-full px-2 py-1.5 text-sm border rounded" />
                    </div>
                  </>
                )}
                {natForm.nat_type === 'snat' && (
                  <>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">转换后源 IP</label>
                      <input value={natForm.translate_ip} onChange={e => setNatForm(f => ({ ...f, translate_ip: e.target.value }))}
                        placeholder="公网 IP" className="w-full px-2 py-1.5 text-sm border rounded" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">出接口</label>
                      <select value={natForm.out_interface} onChange={e => setNatForm(f => ({ ...f, out_interface: e.target.value }))}
                        className="w-full px-2 py-1.5 text-sm border rounded bg-white">
                        <option value="">不指定</option>
                        {logicalIfaces.map(li => <option key={li.id} value={li.name}>{li.name}</option>)}
                      </select>
                    </div>
                  </>
                )}
                <div className="col-span-3">
                  <label className="block text-xs text-slate-500 mb-1">描述</label>
                  <input value={natForm.description} onChange={e => setNatForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full px-2 py-1.5 text-sm border rounded" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={saveNat} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">保存</button>
                <button onClick={() => setShowNatForm(false)} className="px-3 py-1.5 text-sm border rounded hover:bg-slate-100">取消</button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
