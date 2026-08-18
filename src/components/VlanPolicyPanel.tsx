/**
 * VLAN 间策略面板 — 防火墙区域管理 + 策略 CRUD
 */
import { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Trash2, Edit, Check, X, ArrowRight, Globe } from 'lucide-react';
import { useStorageDriver } from '../hooks/useStorage';
import type { FirewallZone, VlanPolicy, VLAN, LogicalInterface } from '../types';
import { simpleFeatures, createColumnHelper, flexRender, useTable } from '../../lib/table';
import type { SimpleFeatures } from '../../lib/table';
import type { ColumnDef } from '@tanstack/react-table';

const TRUST_COLORS: Record<string, string> = {
  trusted: 'bg-emerald-100 text-emerald-700 border-emerald-300',
  untrusted: 'bg-red-100 text-red-700 border-red-300',
  dmz: 'bg-amber-100 text-amber-700 border-amber-300',
};

const ACTION_COLORS: Record<string, string> = {
  allow: 'bg-emerald-100 text-emerald-700',
  deny: 'bg-red-100 text-red-700',
  nat: 'bg-purple-100 text-purple-700',
};

const policyColumnHelper = createColumnHelper<SimpleFeatures, VlanPolicy>();

export function VlanPolicyPanel() {
  const driver = useStorageDriver();
  const [zones, setZones] = useState<FirewallZone[]>([]);
  const [policies, setPolicies] = useState<VlanPolicy[]>([]);
  const [vlans, setVlans] = useState<VLAN[]>([]);
  const [tunnels, setTunnels] = useState<LogicalInterface[]>([]);
  const [subTab, setSubTab] = useState<'zones' | 'policies'>('zones');

  // 区域表单
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [editingZone, setEditingZone] = useState<FirewallZone | null>(null);
  const [zoneForm, setZoneForm] = useState({ name: '', display_name: '', trust_level: 'untrusted', input_policy: 'DROP', output_policy: 'ACCEPT', forward_policy: 'DROP', description: '' });

  // 策略表单
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<VlanPolicy | null>(null);
  const [policyForm, setPolicyForm] = useState({ source_zone_id: '', dest_zone_id: '', action: 'deny', protocol: 'all', src_port: '', dst_port: '', priority: 100, description: '' });

  const loadZones = useCallback(async () => {
    const data = await driver.getFirewallZones();
    setZones(data);
  }, [driver]);

  const loadPolicies = useCallback(async () => {
    const data = await driver.getVlanPolicies();
    setPolicies(data);
  }, [driver]);

  const loadVlans = useCallback(async () => {
    const data = await driver.getVlans();
    setVlans(data);
  }, [driver]);

  const loadTunnels = useCallback(async () => {
    const entities = await driver.getEntities();
    const allLogical = await Promise.all(
      entities.data.map(e => driver.getLogicalInterfaces(e.id))
    );
    setTunnels(allLogical.flat());
  }, [driver]);

  useEffect(() => { loadZones(); loadPolicies(); loadVlans(); loadTunnels(); }, [loadZones, loadPolicies, loadVlans, loadTunnels]);

  // 区域 CRUD
  const openZoneForm = (zone?: FirewallZone) => {
    if (zone) {
      setEditingZone(zone);
      setZoneForm({ name: zone.name, display_name: zone.display_name, trust_level: zone.trust_level, input_policy: zone.input_policy, output_policy: zone.output_policy, forward_policy: zone.forward_policy, description: zone.description });
    } else {
      setEditingZone(null);
      setZoneForm({ name: '', display_name: '', trust_level: 'untrusted', input_policy: 'DROP', output_policy: 'ACCEPT', forward_policy: 'DROP', description: '' });
    }
    setShowZoneForm(true);
  };

  const saveZone = async () => {
    if (!zoneForm.name || !zoneForm.display_name) return;
    try {
      if (editingZone) {
        const zone: any = {
          ...editingZone,
          ...zoneForm,
        };
        await driver.saveFirewallZone(zone);
      } else {
        const zone: any = {
          id: crypto.randomUUID(),
          ...zoneForm,
        };
        await driver.saveFirewallZone(zone);
      }
      setShowZoneForm(false);
      loadZones();
    } catch (e) { alert(e instanceof Error ? e.message : '保存失败'); }
  };

  const deleteZone = async (id: string) => {
    if (!confirm('删除区域将解除所有 VLAN 关联，确认？')) return;
    try {
      await driver.deleteFirewallZone(id);
      loadZones(); loadVlans();
    } catch (e) { alert(e instanceof Error ? e.message : '删除失败'); }
  };

  // VLAN 区域绑定
  const setVlanZone = async (vlanId: number, zoneId: string | null) => {
    try {
      const vlan = vlans.find(v => v.id === vlanId);
      if (vlan) {
        await driver.updateVlan(vlanId, { zone_id: zoneId });
        loadVlans();
      }
    } catch (e) { alert(e instanceof Error ? e.message : '更新失败'); }
  };

  // 隧道接口区域绑定
  const setTunnelZone = async (tunnelId: string, zoneId: string | null) => {
    try {
      const tunnel = tunnels.find(t => t.id === tunnelId);
      if (tunnel) {
        await driver.saveLogicalInterface({ ...tunnel, zone_id: zoneId });
        loadTunnels();
      }
    } catch (e) { alert(e instanceof Error ? e.message : '更新失败'); }
  };

  // 策略 CRUD
  const openPolicyForm = (policy?: VlanPolicy) => {
    if (policy) {
      setEditingPolicy(policy);
      setPolicyForm({ source_zone_id: policy.source_zone_id, dest_zone_id: policy.dest_zone_id, action: policy.action, protocol: policy.protocol, src_port: policy.src_port, dst_port: policy.dst_port, priority: policy.priority, description: policy.description });
    } else {
      setEditingPolicy(null);
      setPolicyForm({ source_zone_id: '', dest_zone_id: '', action: 'deny', protocol: 'all', src_port: '', dst_port: '', priority: 100, description: '' });
    }
    setShowPolicyForm(true);
  };

  const savePolicy = async () => {
    if (!policyForm.source_zone_id || !policyForm.dest_zone_id) return;
    try {
      if (editingPolicy) {
        const policy: any = {
          ...editingPolicy,
          source_zone_id: policyForm.source_zone_id,
          dest_zone_id: policyForm.dest_zone_id,
          action: policyForm.action as any,
          protocol: policyForm.protocol,
          src_port: policyForm.src_port,
          dst_port: policyForm.dst_port,
          priority: policyForm.priority,
          description: policyForm.description,
          enabled: editingPolicy.enabled,
        };
        await driver.saveVlanPolicy(policy);
      } else {
        const policy: any = {
          id: crypto.randomUUID(),
          source_zone_id: policyForm.source_zone_id,
          dest_zone_id: policyForm.dest_zone_id,
          action: policyForm.action as any,
          protocol: policyForm.protocol,
          src_port: policyForm.src_port,
          dst_port: policyForm.dst_port,
          priority: policyForm.priority,
          description: policyForm.description,
          enabled: 1,
        };
        await driver.saveVlanPolicy(policy);
      }
      setShowPolicyForm(false);
      loadPolicies();
    } catch (e) { alert(e instanceof Error ? e.message : '保存失败'); }
  };

  const deletePolicy = async (id: string) => {
    if (!confirm('确定删除此策略？')) return;
    try {
      await driver.deleteVlanPolicy(id);
      loadPolicies();
    } catch (e) { alert(e instanceof Error ? e.message : '删除失败'); }
  };

  // 策略表列定义
  const policyColumns = [
    policyColumnHelper.accessor('priority', {
      header: '优先级',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span>,
    }),
    policyColumnHelper.display({
      id: 'source_zone',
      header: '源区域',
      cell: ({ row }) => <span className="font-medium">{row.original.source_zone_display || row.original.source_zone_name}</span>,
    }),
    policyColumnHelper.display({
      id: 'arrow',
      header: '',
      cell: () => <span className="text-gray-300"><ArrowRight className="w-4 h-4 inline" /></span>,
    }),
    policyColumnHelper.display({
      id: 'dest_zone',
      header: '目标区域',
      cell: ({ row }) => <span className="font-medium">{row.original.dest_zone_display || row.original.dest_zone_name}</span>,
    }),
    policyColumnHelper.accessor('action', {
      header: '动作',
      cell: ({ getValue }) => (
        <span className={`px-2 py-0.5 rounded text-xs ${ACTION_COLORS[getValue()] || 'bg-gray-100'}`}>
          {getValue().toUpperCase()}
        </span>
      ),
    }),
    policyColumnHelper.display({
      id: 'protocol_port',
      header: '协议/端口',
      cell: ({ row }) => (
        <span className="text-xs text-gray-600">
          {row.original.protocol}{row.original.dst_port ? `:${row.original.dst_port}` : ''}{row.original.src_port ? ` (src:${row.original.src_port})` : ''}
        </span>
      ),
    }),
    policyColumnHelper.accessor('description', {
      header: '描述',
      cell: ({ getValue }) => <span className="text-xs text-gray-500">{getValue() || '-'}</span>,
    }),
    policyColumnHelper.display({
      id: 'actions',
      header: () => <span className="block text-right">操作</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <button onClick={() => openPolicyForm(row.original)} className="p-1 hover:bg-blue-50 rounded"><Edit className="w-3.5 h-3.5 text-blue-500" /></button>
          <button onClick={() => deletePolicy(row.original.id)} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
        </div>
      ),
    }),
  ] as ColumnDef<SimpleFeatures, VlanPolicy>[];

  const policyTable = useTable({ features: simpleFeatures, columns: policyColumns, data: policies });
  return (
    <div className="space-y-6">
      {/* 子 Tab 切换 */}
      <div className="flex gap-1 border-b border-gray-200">
        <button onClick={() => setSubTab('zones')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${subTab === 'zones' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>防火墙区域</button>
        <button onClick={() => setSubTab('policies')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${subTab === 'policies' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>转发策略</button>
      </div>

      {/* 区域管理 */}
      {subTab === 'zones' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => openZoneForm()} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm"><Plus className="w-4 h-4" /> 添加区域</button>
          </div>

          {/* 区域卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {zones.map(zone => (
              <div key={zone.id} className={`rounded-xl border p-4 ${TRUST_COLORS[zone.trust_level] || 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    <span className="font-medium">{zone.display_name}</span>
                    <span className="text-xs opacity-70">({zone.name})</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openZoneForm(zone)} className="p-1 rounded hover:bg-white/50"><Edit className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteZone(zone.id)} className="p-1 rounded hover:bg-white/50"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="text-xs space-y-1 opacity-80">
                  <div>入站: {zone.input_policy} | 出站: {zone.output_policy} | 转发: {zone.forward_policy}</div>
                  {zone.description && <div>{zone.description}</div>}
                </div>
                {/* 该区域下的 VLAN */}
                <div className="mt-3 flex flex-wrap gap-1">
                  {vlans.filter(v => v.zone_id === zone.id).map(v => (
                    <span key={v.id} className="px-2 py-0.5 rounded text-xs bg-white/60 font-mono">VLAN {v.id}</span>
                  ))}
                  {tunnels.filter(t => t.zone_id === zone.id).map(t => (
                    <span key={t.id} className="px-2 py-0.5 rounded text-xs bg-purple-200/60 font-mono flex items-center gap-0.5"><Globe className="w-3 h-3" />{t.name}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* VLAN 区域绑定表格 */}
          <div className="bg-white rounded-xl border p-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">VLAN → 区域绑定</h4>
            <div className="space-y-2">
              {vlans.map(v => (
                <div key={v.id} className="flex items-center gap-3 text-sm">
                  <span className="font-mono w-20">VLAN {v.id}</span>
                  <span className="text-gray-500 w-32 truncate">{v.name}</span>
                  <select value={v.zone_id || ''} onChange={e => setVlanZone(v.id, e.target.value || null)} className="px-2 py-1 border rounded text-xs flex-1 max-w-[200px]">
                    <option value="">未分配区域</option>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.display_name} ({z.name})</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* 隧道接口 → 区域绑定表格 */}
          {tunnels.length > 0 && (
            <div className="bg-white rounded-xl border p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">隧道接口 → 区域绑定</h4>
              <div className="space-y-2">
                {tunnels.map(t => (
                  <div key={t.id} className="flex items-center gap-3 text-sm">
                    <Globe className="w-4 h-4 text-purple-500" />
                    <span className="font-mono w-32">{t.name}</span>
                    <span className="text-gray-500 w-32 truncate">{t.ip_address || '—'}</span>
                    <select value={t.zone_id || ''} onChange={e => setTunnelZone(t.id, e.target.value || null)} className="px-2 py-1 border rounded text-xs flex-1 max-w-[200px]">
                      <option value="">未分配区域</option>
                      {zones.map(z => <option key={z.id} value={z.id}>{z.display_name} ({z.name})</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 区域表单 */}
          {showZoneForm && (
            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">{editingZone ? '编辑区域' : '添加区域'}</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <input value={zoneForm.name} onChange={e => setZoneForm(f => ({ ...f, name: e.target.value }))} placeholder="标识名 (如 lan)" className="px-2 py-1.5 border rounded text-sm" />
                <input value={zoneForm.display_name} onChange={e => setZoneForm(f => ({ ...f, display_name: e.target.value }))} placeholder="显示名 (如 内网)" className="px-2 py-1.5 border rounded text-sm" />
                <select value={zoneForm.trust_level} onChange={e => setZoneForm(f => ({ ...f, trust_level: e.target.value }))} className="px-2 py-1.5 border rounded text-sm">
                  <option value="trusted">受信任</option>
                  <option value="untrusted">不受信任</option>
                  <option value="dmz">DMZ</option>
                </select>
                <input value={zoneForm.description} onChange={e => setZoneForm(f => ({ ...f, description: e.target.value }))} placeholder="描述" className="px-2 py-1.5 border rounded text-sm" />
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">入站策略</label>
                  <select value={zoneForm.input_policy} onChange={e => setZoneForm(f => ({ ...f, input_policy: e.target.value }))} className="w-full px-2 py-1.5 border rounded text-sm">
                    <option value="ACCEPT">ACCEPT</option><option value="DROP">DROP</option><option value="REJECT">REJECT</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">出站策略</label>
                  <select value={zoneForm.output_policy} onChange={e => setZoneForm(f => ({ ...f, output_policy: e.target.value }))} className="w-full px-2 py-1.5 border rounded text-sm">
                    <option value="ACCEPT">ACCEPT</option><option value="DROP">DROP</option><option value="REJECT">REJECT</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">转发策略</label>
                  <select value={zoneForm.forward_policy} onChange={e => setZoneForm(f => ({ ...f, forward_policy: e.target.value }))} className="w-full px-2 py-1.5 border rounded text-sm">
                    <option value="ACCEPT">ACCEPT</option><option value="DROP">DROP</option><option value="REJECT">REJECT</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={saveZone} className="px-3 py-1.5 bg-emerald-500 text-white rounded text-sm flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 保存</button>
                <button onClick={() => setShowZoneForm(false)} className="px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm flex items-center gap-1"><X className="w-3.5 h-3.5" /> 取消</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 策略管理 */}
      {subTab === 'policies' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => openPolicyForm()} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm"><Plus className="w-4 h-4" /> 添加策略</button>
          </div>

          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                {policyTable.getHeaderGroups().map(hg => (
                  <tr key={hg.id}>
                    {hg.headers.map(header => (
                      <th key={header.id} className="px-4 py-3 text-left">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y">
                {policyTable.getRowModel().rows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    {row.getAllCells().map(cell => (
                      <td key={cell.id} className="px-4 py-3">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
                {policies.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">暂无策略规则</td></tr>}
              </tbody>
            </table>
          </div>
          {/* 策略表单 */}
          {showPolicyForm && (
            <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">{editingPolicy ? '编辑策略' : '添加策略'}</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500">源区域</label>
                  <select value={policyForm.source_zone_id} onChange={e => setPolicyForm(f => ({ ...f, source_zone_id: e.target.value }))} className="w-full px-2 py-1.5 border rounded text-sm">
                    <option value="">选择源区域</option>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.display_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">目标区域</label>
                  <select value={policyForm.dest_zone_id} onChange={e => setPolicyForm(f => ({ ...f, dest_zone_id: e.target.value }))} className="w-full px-2 py-1.5 border rounded text-sm">
                    <option value="">选择目标区域</option>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.display_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">动作</label>
                  <select value={policyForm.action} onChange={e => setPolicyForm(f => ({ ...f, action: e.target.value }))} className="w-full px-2 py-1.5 border rounded text-sm">
                    <option value="allow">ALLOW（允许）</option>
                    <option value="deny">DENY（拒绝）</option>
                    <option value="nat">NAT（地址转换）</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">优先级（越小越高）</label>
                  <input type="number" value={policyForm.priority} onChange={e => setPolicyForm(f => ({ ...f, priority: parseInt(e.target.value) || 100 }))} className="w-full px-2 py-1.5 border rounded text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="text-xs text-gray-500">协议</label>
                  <select value={policyForm.protocol} onChange={e => setPolicyForm(f => ({ ...f, protocol: e.target.value }))} className="w-full px-2 py-1.5 border rounded text-sm">
                    <option value="all">全部</option><option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">源端口</label>
                  <input value={policyForm.src_port} onChange={e => setPolicyForm(f => ({ ...f, src_port: e.target.value }))} placeholder="如 1024:65535" className="w-full px-2 py-1.5 border rounded text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">目标端口</label>
                  <input value={policyForm.dst_port} onChange={e => setPolicyForm(f => ({ ...f, dst_port: e.target.value }))} placeholder="如 80,443" className="w-full px-2 py-1.5 border rounded text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">描述</label>
                  <input value={policyForm.description} onChange={e => setPolicyForm(f => ({ ...f, description: e.target.value }))} className="w-full px-2 py-1.5 border rounded text-sm" />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={savePolicy} className="px-3 py-1.5 bg-emerald-500 text-white rounded text-sm flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 保存</button>
                <button onClick={() => setShowPolicyForm(false)} className="px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm flex items-center gap-1"><X className="w-3.5 h-3.5" /> 取消</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
