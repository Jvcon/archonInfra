/**
 * 接入配置 Tab — 合并端口管理 + WiFi 管理
 * 设备选择器 → 左侧有线端口配置 / 右侧无线 SSID 配置
 */
import { useState, useEffect, useCallback } from 'react';
import { useStorageDriver } from '../hooks/useStorage';
import { Modal } from './Modal';
import { Wifi, Cable, Monitor, Plus, Edit, Trash2, Check, X, Link, Unlink } from 'lucide-react';
import type { VLAN } from '../types';

interface PortStatusSummary {
  entity_id: string;
  entity_name: string;
  category: string;
  total_ports: number;
  connected: number;
  free: number;
  disabled: number;
}

interface PortStatus {
  interface_id: string;
  nic_name: string;
  port_index?: number;
  media_type?: string;
  link_status: 'connected' | 'free' | 'disabled';
  speed?: string;
  description?: string;
  connected_to?: { entity_name: string; remote_port: string };
  switch_port?: {
    id: string;
    mode: 'access' | 'trunk';
    vlan_id?: number;
    native_vlan_id?: number;
    allowed_vlans: number[];
  };
}

interface LogicalInterface {
  id: string;
  interface_id: string;
  nic_name: string;
  sub_interface: string;
  vlan_id?: number;
  ip_address?: string;
  description?: string;
}

interface WiFiSSID {
  id: string;
  entity_id: string;
  entity_name?: string;
  ssid_name: string;
  vlan_id?: number;
  vlan_name?: string;
  band: '2.4GHz' | '5GHz' | 'dual';
  security: 'open' | 'WPA2' | 'WPA3';
  hidden: boolean;
  enabled: boolean;
  description: string;
}

interface Props {
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export function AccessConfigTab({ showToast }: Props) {
  const driver = useStorageDriver();
  const [devices, setDevices] = useState<PortStatusSummary[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [ports, setPorts] = useState<PortStatus[]>([]);
  const [logicalIfaces, setLogicalIfaces] = useState<LogicalInterface[]>([]);
  const [ssids, setSsids] = useState<WiFiSSID[]>([]);
  const [vlans, setVlans] = useState<VLAN[]>([]);

  // 端口编辑
  const [editingPort, setEditingPort] = useState<string | null>(null);
  const [portMode, setPortMode] = useState<'access' | 'trunk'>('access');
  const [portVlanId, setPortVlanId] = useState<string>('');
  const [_portNativeVlan, setPortNativeVlan] = useState<string>('');
  const [portAllowedVlans, setPortAllowedVlans] = useState<string>('');

  // WiFi 表单
  const [showWifiForm, setShowWifiForm] = useState(false);
  const [editWifi, setEditWifi] = useState<WiFiSSID | null>(null);
  const [wfName, setWfName] = useState('');
  const [wfVlan, setWfVlan] = useState('');
  const [wfBand, setWfBand] = useState<'2.4GHz' | '5GHz' | 'dual'>('dual');
  const [wfSecurity, setWfSecurity] = useState<'open' | 'WPA2' | 'WPA3'>('WPA2');
  const [wfHidden, setWfHidden] = useState(false);
  const [wfEnabled, setWfEnabled] = useState(true);
  const [wfDesc, setWfDesc] = useState('');

  // AC 管理状态
  const [managedByAc, setManagedByAc] = useState<{ ac_id: string; ac_name: string } | null>(null);

  // 端口连接（edges）
  const [connectingPort, setConnectingPort] = useState<string | null>(null);
  const [targetDevices, setTargetDevices] = useState<PortStatusSummary[]>([]);
  const [targetDevice, setTargetDevice] = useState('');
  const [targetPorts, setTargetPorts] = useState<PortStatus[]>([]);
  const [targetPort, setTargetPort] = useState('');

  const loadDevices = useCallback(async () => {
    const entities = await driver.getEntities();
    const summary: PortStatusSummary[] = entities.data.map(e => ({
      entity_id: e.id,
      entity_name: e.name,
      category: e.category,
      total_ports: 0,
      connected: 0,
      free: 0,
      disabled: 0,
    }));
    setDevices(summary);
  }, [driver]);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  useEffect(() => {
    if (!selectedDevice) return;
    loadPorts();
    loadLogicalIfaces();
    loadSSIDs();
    loadVlans();
  }, [selectedDevice, driver]);

  const loadPorts = async () => {
    const networkIfaces = await driver.getNetworkInterfaces(selectedDevice);
    const switchPorts = await driver.getSwitchPorts(selectedDevice);
    const edges = await driver.getEdges();

    const ports: PortStatus[] = networkIfaces.map(iface => {
      const switchPort = switchPorts.find(sp => sp.interface_id === iface.id);
      const edge = edges.find(e => e.source_interface_id === iface.id || e.target_interface_id === iface.id);
      const isConnected = edge && edge.edge_type === 'physical';

      return {
        interface_id: iface.id,
        nic_name: iface.nic_name,
        media_type: iface.media_type,
        link_status: isConnected ? 'connected' : iface.admin_status === 'up' ? 'free' : 'disabled',
        description: iface.description,
        switch_port: switchPort ? {
          id: switchPort.id,
          mode: switchPort.mode,
          vlan_id: switchPort.vlan_id || undefined,
          native_vlan_id: switchPort.native_vlan_id || undefined,
          allowed_vlans: switchPort.allowed_vlans ? switchPort.allowed_vlans.split(',').map(Number) : [],
        } : undefined,
      };
    });
    setPorts(ports);
  };

  const loadLogicalIfaces = async () => {
    const logicalIfaces = await driver.getLogicalInterfaces(selectedDevice);
    setLogicalIfaces(logicalIfaces as any);
  };

  const loadSSIDs = async () => {
    const wifiSSIDs = await driver.getWifiSSIDs(selectedDevice);
    setSsids(wifiSSIDs as any);
    setManagedByAc(null);
  };

  const loadVlans = async () => {
    const allVlans = await driver.getVlans();
    setVlans(allVlans);
  };

  // 端口 VLAN 编辑
  const startEditPort = (port: PortStatus) => {
    if (!port.switch_port) return;
    setEditingPort(port.interface_id);
    setPortMode(port.switch_port.mode);
    setPortVlanId(port.switch_port.vlan_id?.toString() || '');
    setPortNativeVlan(port.switch_port.native_vlan_id?.toString() || '');
    setPortAllowedVlans(port.switch_port.allowed_vlans?.join(',') || '');
  };

  const savePort = async (port: PortStatus) => {
    if (!port.switch_port) return;
    try {
      await driver.updateSwitchPort(port.switch_port.id, {
        mode: portMode,
      });
      showToast('端口配置已更新', 'success');
      setEditingPort(null);
      loadPorts();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '更新失败', 'error');
    }
  };

  // WiFi CRUD
  const openWifiForm = (wifi?: WiFiSSID) => {
    if (wifi) {
      setEditWifi(wifi);
      setWfName(wifi.ssid_name);
      setWfVlan(wifi.vlan_id?.toString() || '');
      setWfBand(wifi.band);
      setWfSecurity(wifi.security);
      setWfHidden(wifi.hidden);
      setWfEnabled(wifi.enabled);
      setWfDesc(wifi.description);
    } else {
      setEditWifi(null);
      setWfName(''); setWfVlan(''); setWfBand('dual'); setWfSecurity('WPA2'); setWfHidden(false); setWfEnabled(true); setWfDesc('');
    }
    setShowWifiForm(true);
  };

  const handleWifiSave = async () => {
    if (!wfName) { showToast('请填写 SSID 名称', 'error'); return; }
    try {
      const ssid: any = {
        id: editWifi?.id || crypto.randomUUID(),
        entity_id: selectedDevice,
        ssid_name: wfName,
        vlan_id: wfVlan ? parseInt(wfVlan) : undefined,
        band: wfBand as any,
        security: wfSecurity as any,
        hidden: wfHidden,
        enabled: wfEnabled,
        description: wfDesc,
      };
      await driver.saveWifiSSID(ssid);
      showToast(editWifi ? 'SSID 已更新' : 'SSID 已创建', 'success');
      setShowWifiForm(false);
      loadSSIDs();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    }
  };

  const handleWifiDelete = async (id: string) => {
    if (!confirm('确定删除该 SSID？')) return;
    try {
      await driver.deleteWifiSSID(id);
      showToast('已删除', 'success');
      loadSSIDs();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败', 'error');
    }
  };

  // 端口连接操作
  const startConnect = async (portId: string) => {
    setConnectingPort(portId);
    setTargetDevice('');
    setTargetPort('');
    setTargetPorts([]);
    // 加载所有设备作为连接目标（排除当前设备）
    const entities = await driver.getEntities();
    const summary: PortStatusSummary[] = entities.data.filter(e => e.id !== selectedDevice).map(e => ({
      entity_id: e.id,
      entity_name: e.name,
      category: e.category,
      total_ports: 0,
      connected: 0,
      free: 0,
      disabled: 0,
    }));
    setTargetDevices(summary);
  };

  const loadTargetPorts = async (deviceId: string) => {
    setTargetDevice(deviceId);
    setTargetPort('');
    const networkIfaces = await driver.getNetworkInterfaces(deviceId);
    const edges = await driver.getEdges();

    const ports: PortStatus[] = networkIfaces
      .filter(iface => iface.admin_status === 'up')
      .map(iface => ({
        interface_id: iface.id,
        nic_name: iface.nic_name,
        media_type: iface.media_type,
        link_status: (edges.some(e => (e.source_interface_id === iface.id || e.target_interface_id === iface.id)) ? 'connected' : 'free') as PortStatus['link_status'],
        description: iface.description,
      }))
      .filter(p => p.link_status === 'free');
    setTargetPorts(ports);
  };

  const createEdge = async () => {
    if (!connectingPort || !targetPort) return;
    try {
      const edge: any = {
        id: crypto.randomUUID(),
        source_id: selectedDevice,
        target_id: targetDevice,
        source_interface_id: connectingPort,
        target_interface_id: targetPort,
        edge_type: 'physical',
        metadata: {},
        created_at: new Date().toISOString(),
      };
      await driver.saveEdge(edge);
      showToast('连接已创建', 'success');
      setConnectingPort(null);
      loadPorts();
      loadDevices();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '创建连接失败', 'error');
    }
  };

  const disconnectPort = async (port: PortStatus) => {
    if (!confirm(`确定断开连接？`)) return;
    try {
      // 查找该端口关联的 edge
      const edges = await driver.getEdges();
      const edge = edges.find(e =>
        e.edge_type === 'physical' &&
        (e.source_interface_id === port.interface_id || e.target_interface_id === port.interface_id)
      );
      if (edge) {
        await driver.deleteEdge(edge.id);
        showToast('连接已断开', 'success');
        loadPorts();
        loadDevices();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : '断开失败', 'error');
    }
  };

  // 是否显示 WiFi 面板（基于设备是否拥有无线网卡，或设备是 AC 类型）
  const selectedDeviceCategory = devices.find(d => d.entity_id === selectedDevice)?.category;
  const showWifi = ports.some(p => p.media_type === 'wifi') || selectedDeviceCategory === 'ac';

  return (
    <div className="space-y-4">
      {/* 设备选择器 */}
      <div className="flex gap-2 flex-wrap">
        {devices.map(d => (
          <button key={d.entity_id} onClick={() => setSelectedDevice(d.entity_id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${selectedDevice === d.entity_id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:border-slate-300'}`}>
            <Monitor className="w-4 h-4" />
            <span className="font-medium">{d.entity_name}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded">{d.category}</span>
            <span className="text-xs text-slate-400">{d.connected}/{d.total_ports}</span>
          </button>
        ))}
        {devices.length === 0 && <p className="text-sm text-slate-400">暂无设备，请先在硬件管理中添加设备和网口</p>}
      </div>

      {selectedDevice && (
        <div className={`grid gap-4 ${showWifi ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
          {/* 左栏：有线端口配置 */}
          <div className="bg-white border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Cable className="w-4 h-4 text-slate-500" />
              <h3 className="font-medium text-sm">有线端口</h3>
              <span className="text-xs text-slate-400">{ports.length} 个端口</span>
            </div>
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {ports.map(port => (
                <div key={port.interface_id} className="rounded-lg bg-slate-50 text-sm">
                  <div className="flex items-center gap-2 px-3 py-2">
                    {/* 状态指示 */}
                    <span className={`w-2 h-2 rounded-full ${port.link_status === 'connected' ? 'bg-green-500' : port.link_status === 'disabled' ? 'bg-red-400' : 'bg-slate-300'}`}></span>
                    <span className="font-mono text-xs w-16">{port.nic_name}</span>

                    {editingPort === port.interface_id && port.switch_port ? (
                      /* 编辑模式 */
                      <div className="flex items-center gap-2 flex-1">
                        <select value={portMode} onChange={e => setPortMode(e.target.value as 'access' | 'trunk')} className="px-2 py-1 border rounded text-xs">
                          <option value="access">Access</option>
                          <option value="trunk">Trunk</option>
                        </select>
                        {portMode === 'access' ? (
                          <select value={portVlanId} onChange={e => setPortVlanId(e.target.value)} className="px-2 py-1 border rounded text-xs flex-1">
                            <option value="">无 VLAN</option>
                            {vlans.map(v => <option key={v.id} value={v.id}>{v.id} - {v.name}</option>)}
                          </select>
                        ) : (
                          <input value={portAllowedVlans} onChange={e => setPortAllowedVlans(e.target.value)} className="px-2 py-1 border rounded text-xs flex-1" placeholder="允许VLAN(逗号分隔)" />
                        )}
                        <button onClick={() => savePort(port)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditingPort(null)} className="p-1 text-red-500 hover:bg-red-50 rounded"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      /* 展示模式 */
                      <>
                        {port.switch_port ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                            {port.switch_port.mode === 'access' ? `Access VLAN ${port.switch_port.vlan_id || '-'}` : `Trunk (${port.switch_port.allowed_vlans.length} VLANs)`}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">未配置</span>
                        )}
                        {port.connected_to ? (
                          <>
                            <span className="text-xs text-slate-500 ml-auto">→ {port.connected_to.entity_name}:{port.connected_to.remote_port}</span>
                            <button onClick={() => disconnectPort(port)} className="p-1 hover:bg-red-50 rounded" title="断开连接"><Unlink className="w-3 h-3 text-red-400" /></button>
                          </>
                        ) : (
                          <button onClick={() => startConnect(port.interface_id)} className="ml-auto p-1 hover:bg-green-50 rounded" title="创建连接"><Link className="w-3 h-3 text-green-500" /></button>
                        )}
                        {port.switch_port && (
                          <button onClick={() => startEditPort(port)} className="p-1 hover:bg-slate-200 rounded"><Edit className="w-3 h-3 text-slate-400" /></button>
                        )}
                      </>
                    )}
                  </div>

                  {/* 连接创建面板 */}
                  {connectingPort === port.interface_id && (
                    <div className="px-3 pb-2 pt-1 border-t border-slate-200 bg-green-50/50 rounded-b-lg">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500">连接到:</span>
                        <select value={targetDevice} onChange={e => loadTargetPorts(e.target.value)}
                          className="px-2 py-1 border rounded text-xs bg-white flex-1">
                          <option value="">选择目标设备...</option>
                          {targetDevices.map(d => <option key={d.entity_id} value={d.entity_id}>{d.entity_name} ({d.category})</option>)}
                        </select>
                        {targetDevice && (
                          <select value={targetPort} onChange={e => setTargetPort(e.target.value)}
                            className="px-2 py-1 border rounded text-xs bg-white flex-1">
                            <option value="">选择端口...</option>
                            {targetPorts.map(p => <option key={p.interface_id} value={p.interface_id}>{p.nic_name}</option>)}
                          </select>
                        )}
                        <button onClick={createEdge} disabled={!targetPort}
                          className="p-1 text-green-600 hover:bg-green-100 rounded disabled:opacity-30"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setConnectingPort(null)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {ports.length === 0 && <p className="text-xs text-slate-400 text-center py-4">暂无端口数据</p>}
            </div>

            {/* 逻辑接口 */}
            {logicalIfaces.length > 0 && (
              <div className="mt-4 pt-3 border-t">
                <h4 className="text-xs font-medium text-slate-500 mb-2">逻辑子接口</h4>
                <div className="space-y-1">
                  {logicalIfaces.map(li => (
                    <div key={li.id} className="flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-50 rounded">
                      <span className="font-mono">{li.sub_interface}</span>
                      {li.vlan_id && <span className="text-blue-600">VLAN {li.vlan_id}</span>}
                      {li.ip_address && <span className="font-mono text-green-700">{li.ip_address}</span>}
                      <span className="text-slate-400 ml-auto">{li.description || ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 右栏：WiFi 配置（仅 router/ap/ac） */}
          {showWifi && (
            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="w-4 h-4 text-slate-500" />
                <h3 className="font-medium text-sm">无线 SSID</h3>
                {managedByAc ? (
                  <span className="ml-auto text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                    由 AC「{managedByAc.ac_name}」集中管理（只读）
                  </span>
                ) : (
                  <button onClick={() => openWifiForm()} className="ml-auto flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                    <Plus className="w-3 h-3" /> 添加
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {ssids.map(wifi => (
                  <div key={wifi.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 text-sm">
                    <Wifi className={`w-3.5 h-3.5 ${wifi.enabled ? 'text-green-500' : 'text-slate-300'}`} />
                    <span className="font-medium">{wifi.ssid_name}</span>
                    {wifi.vlan_name && <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">VLAN {wifi.vlan_id}</span>}
                    <span className="text-xs text-slate-400">{wifi.band}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-slate-100 rounded">{wifi.security}</span>
                    {wifi.hidden && <span className="text-[10px] text-amber-600">隐藏</span>}
                    {!managedByAc && (
                      <div className="ml-auto flex gap-1">
                        <button onClick={() => openWifiForm(wifi)} className="p-1 hover:bg-blue-50 rounded"><Edit className="w-3 h-3 text-blue-500" /></button>
                        <button onClick={() => handleWifiDelete(wifi.id)} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-3 h-3 text-red-400" /></button>
                      </div>
                    )}
                  </div>
                ))}
                {ssids.length === 0 && <p className="text-xs text-slate-400 text-center py-4">{managedByAc ? 'AC 尚未配置 SSID' : '暂无 SSID，点击"添加"创建'}</p>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* WiFi 编辑表单 */}
      <Modal open={showWifiForm} onClose={() => setShowWifiForm(false)} title={editWifi ? '编辑 SSID' : '添加 SSID'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">SSID 名称 *</label>
            <input value={wfName} onChange={e => setWfName(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="如：Office-5G" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">绑定 VLAN</label>
              <select value={wfVlan} onChange={e => setWfVlan(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">不绑定</option>
                {vlans.map(v => <option key={v.id} value={v.id}>{v.id} - {v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">频段</label>
              <select value={wfBand} onChange={e => setWfBand(e.target.value as typeof wfBand)} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="dual">双频</option>
                <option value="2.4GHz">2.4GHz</option>
                <option value="5GHz">5GHz</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">安全模式</label>
              <select value={wfSecurity} onChange={e => setWfSecurity(e.target.value as typeof wfSecurity)} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="WPA3">WPA3</option>
                <option value="WPA2">WPA2</option>
                <option value="open">开放</option>
              </select>
            </div>
            <div className="flex items-end gap-4 pb-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wfHidden} onChange={e => setWfHidden(e.target.checked)} className="rounded" />
                隐藏 SSID
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wfEnabled} onChange={e => setWfEnabled(e.target.checked)} className="rounded" />
                启用
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">描述</label>
            <input value={wfDesc} onChange={e => setWfDesc(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowWifiForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
            <button onClick={handleWifiSave} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">{editWifi ? '保存' : '创建'}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
