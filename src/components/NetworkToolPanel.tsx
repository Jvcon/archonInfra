/**
 * 网络工具面板 — 右侧常驻折叠面板
 * 包含：网络校验、路径追踪、导出配置、VLAN 拓扑
 */
import { useState, useEffect } from 'react';
import { useStorageDriver } from '../hooks/useStorage';
import { isValidIP } from '../../lib/ip-utils';
import { validateVLANPath } from '../lib/services/vlan-validation';
import { traceRoutePath } from '../lib/services/route-trace';
import { ShieldCheck, Route, FileCode, Network, ChevronDown, ChevronRight, CheckCircle, XCircle, AlertTriangle, Copy } from 'lucide-react';
import type { Entity, VLAN } from '../types';

interface ValidationResult {
  conflicts: Array<{ address: string; entities: string[] }>;
  mismatches: Array<{ address: string; subnet: string; reason: string }>;
  valid: boolean;
}

interface TraceHop {
  hop_index: number;
  entity_name: string;
  category: string;
  in_interface: string | null;
  out_interface: string | null;
  matched_route: { destination: string; next_hop: string } | null;
  nat_actions: Array<{ type: string; original: string; translated: string }>;
}

interface TraceResult {
  paths: Array<{ hops: TraceHop[] }>;
  summary: { reachable: boolean; hop_count: number; has_nat: boolean; has_loop: boolean };
  diagnostics: Array<{ level: string; message: string }>;
}

interface ConfigSection {
  title: string;
  filename: string;
  content: string;
}

interface Props {
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export function NetworkToolPanel({ showToast }: Props) {
  const driver = useStorageDriver();
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  // 网络校验
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // 路径追踪
  const [traceSrc, setTraceSrc] = useState('');
  const [traceDst, setTraceDst] = useState('');
  const [tracing, setTracing] = useState(false);
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);

  // 导出配置
  const [devices, setDevices] = useState<Entity[]>([]);
  const [configDevice, setConfigDevice] = useState('');
  const [configSections, _setConfigSections] = useState<ConfigSection[]>([]);
  const [configLoading, setConfigLoading] = useState(false);

  // VLAN 拓扑
  const [vlans, setVlans] = useState<VLAN[]>([]);
  const [topoVlan, setTopoVlan] = useState('');
  const [topoResult, setTopoResult] = useState<{ valid: boolean; path: Array<{ entity_name: string; port_mode: string; allowed_vlans: number[]; access_vlan_id: number | null }>; target_vlan_id: number; issues: Array<{ severity: string; message: string }> } | null>(null);
  const [topoSrc, setTopoSrc] = useState('');
  const [topoDst, setTopoDst] = useState('');

  useEffect(() => {
    if (expandedTool === 'config' || expandedTool === 'topo') {
      loadDevicesAndVlans();
    }
  }, [expandedTool]);

  const loadDevicesAndVlans = async () => {
    const [r1, r2] = await Promise.all([
      driver.getEntities({ type: 'hardware' }),
      driver.getVlans(),
    ]);
    setDevices(r1.data);
    setVlans(r2);
  };

  // 网络校验
  const runValidation = async () => {
    setValidating(true);
    try {
      const ipAddrs = await driver.getIPAddresses();
      // subnets 预留给子网错配检查
      await driver.getSubnets();

      const conflicts: Array<{ address: string; entities: string[] }> = [];
      const mismatches: Array<{ address: string; subnet: string; reason: string }> = [];

      // 检查 IP 冲突
      const addrMap = new Map<string, string[]>();
      for (const ip of ipAddrs) {
        if (!addrMap.has(ip.address)) {
          addrMap.set(ip.address, []);
        }
        addrMap.get(ip.address)!.push(ip.entity_id || 'unknown');
      }

      for (const [addr, entities] of addrMap) {
        if (entities.length > 1) {
          conflicts.push({ address: addr, entities });
        }
      }

      setValidationResult({ conflicts, mismatches, valid: conflicts.length === 0 && mismatches.length === 0 });
    } catch { showToast('校验执行失败', 'error'); }
    setValidating(false);
  };

  // 路径追踪
  const runTrace = async () => {
    if (!isValidIP(traceSrc) || !isValidIP(traceDst)) { showToast('请输入合法的 IP 地址', 'error'); return; }
    setTracing(true);
    try {
      const result = await traceRoutePath(traceSrc, traceDst);
      setTraceResult(result as unknown as TraceResult);
    } catch { showToast('追踪失败', 'error'); }
    setTracing(false);
  };

  // 导出配置 (placeholder - no driver support)
  const runConfigGen = async () => {
    if (!configDevice) { showToast('请选择设备', 'error'); return; }
    setConfigLoading(true);
    try {
      showToast('配置生成功能暂未实现', 'error');
    } catch { showToast('生成失败', 'error'); }
    setConfigLoading(false);
  };

  // VLAN 拓扑校验
  const runTopoCheck = async () => {
    if (!topoVlan || !topoSrc || !topoDst) { showToast('请选择 VLAN 和设备', 'error'); return; }
    try {
      const result = await validateVLANPath(topoSrc, topoDst, parseInt(topoVlan));
      setTopoResult(result as any);
    } catch { showToast('校验失败', 'error'); }
  };

  const toggle = (key: string) => setExpandedTool(expandedTool === key ? null : key);

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast('已复制', 'success');
  };

  return (
    <div className="w-full lg:w-[320px] space-y-2 shrink-0">
      <h3 className="text-sm font-medium text-slate-600 flex items-center gap-1.5 px-1">🔧 工具</h3>

      {/* 网络校验 */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <button onClick={() => toggle('validate')} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
          {expandedTool === 'validate' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span className="font-medium">网络校验</span>
          {validationResult && (
            validationResult.valid
              ? <CheckCircle className="w-3.5 h-3.5 text-green-500 ml-auto" />
              : <XCircle className="w-3.5 h-3.5 text-red-500 ml-auto" />
          )}
        </button>
        {expandedTool === 'validate' && (
          <div className="px-4 pb-3 space-y-2 border-t">
            <button onClick={runValidation} disabled={validating} className="mt-2 w-full px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs hover:bg-emerald-700 disabled:opacity-50">
              {validating ? '校验中...' : '执行校验'}
            </button>
            {validationResult && (
              <div className="text-xs space-y-1.5 mt-2">
                <div className="flex items-center gap-2">
                  {validationResult.conflicts.length === 0 ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                  <span>IP 冲突: {validationResult.conflicts.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  {validationResult.mismatches.length === 0 ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                  <span>子网错配: {validationResult.mismatches.length}</span>
                </div>
                {validationResult.conflicts.map((c, i) => (
                  <div key={i} className="pl-5 text-red-600">{c.address}: {c.entities.join(', ')}</div>
                ))}
                {validationResult.mismatches.map((m, i) => (
                  <div key={i} className="pl-5 text-amber-600">{m.address} — {m.reason}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 路径追踪 */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <button onClick={() => toggle('trace')} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
          {expandedTool === 'trace' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Route className="w-4 h-4 text-blue-600" />
          <span className="font-medium">路径追踪</span>
        </button>
        {expandedTool === 'trace' && (
          <div className="px-4 pb-3 space-y-2 border-t">
            <div className="mt-2 space-y-2">
              <input value={traceSrc} onChange={e => setTraceSrc(e.target.value)} className="w-full px-2.5 py-1.5 border rounded text-xs" placeholder="源 IP (如 192.168.1.100)" />
              {traceSrc && !isValidIP(traceSrc) && <span className="text-red-500 text-[10px]">IP 格式不合法</span>}
              <input value={traceDst} onChange={e => setTraceDst(e.target.value)} className="w-full px-2.5 py-1.5 border rounded text-xs" placeholder="目标 IP (如 10.0.0.1)" />
              {traceDst && !isValidIP(traceDst) && <span className="text-red-500 text-[10px]">IP 格式不合法</span>}
            </div>
            <button onClick={runTrace} disabled={tracing || !isValidIP(traceSrc) || !isValidIP(traceDst)} className="w-full px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50">
              {tracing ? '追踪中...' : '追踪路径'}
            </button>
            {traceResult && (
              <div className="text-xs space-y-2 mt-2">
                <div className={`flex items-center gap-1.5 font-medium ${traceResult.summary.reachable ? 'text-green-700' : 'text-red-600'}`}>
                  {traceResult.summary.reachable ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  {traceResult.summary.reachable ? `可达，${traceResult.summary.hop_count} 跳` : '不可达'}
                  {traceResult.summary.has_nat && <span className="text-amber-600 ml-1">(NAT)</span>}
                </div>
                {traceResult.paths[0]?.hops.map((hop, i) => (
                  <div key={i} className="pl-2 border-l-2 border-blue-200 py-1">
                    <span className="text-blue-700">Hop {hop.hop_index}:</span> {hop.entity_name}
                    <span className="text-slate-400 ml-1">({hop.category})</span>
                    {hop.out_interface && <span className="text-slate-500"> → {hop.out_interface}</span>}
                    {hop.matched_route && <span className="text-green-600 ml-1">route: {hop.matched_route.destination}</span>}
                  </div>
                ))}
                {traceResult.diagnostics.map((d, i) => (
                  <div key={i} className={`text-[10px] ${d.level === 'error' ? 'text-red-500' : 'text-amber-500'}`}>⚠ {d.message}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 导出配置 */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <button onClick={() => toggle('config')} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
          {expandedTool === 'config' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <FileCode className="w-4 h-4 text-purple-600" />
          <span className="font-medium">导出配置</span>
        </button>
        {expandedTool === 'config' && (
          <div className="px-4 pb-3 space-y-2 border-t">
            <select value={configDevice} onChange={e => setConfigDevice(e.target.value)} className="mt-2 w-full px-2.5 py-1.5 border rounded text-xs">
              <option value="">选择设备</option>
              {devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.category})</option>)}
            </select>
            <button onClick={runConfigGen} disabled={configLoading || !configDevice} className="w-full px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 disabled:opacity-50">
              {configLoading ? '生成中...' : '生成配置'}
            </button>
            {configSections.length > 0 && (
              <div className="space-y-2 mt-2">
                {configSections.map((sec, i) => (
                  <div key={i} className="border rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 text-xs">
                      <span className="font-medium">{sec.title}</span>
                      <button onClick={() => copyText(sec.content)} className="p-1 hover:bg-slate-200 rounded" title="复制"><Copy className="w-3 h-3" /></button>
                    </div>
                    <pre className="px-2.5 py-2 text-[10px] leading-relaxed bg-slate-900 text-green-300 max-h-32 overflow-auto font-mono">{sec.content}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* VLAN 拓扑 */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <button onClick={() => toggle('topo')} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-slate-50">
          {expandedTool === 'topo' ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Network className="w-4 h-4 text-teal-600" />
          <span className="font-medium">VLAN 拓扑</span>
        </button>
        {expandedTool === 'topo' && (
          <div className="px-4 pb-3 space-y-2 border-t">
            <select value={topoVlan} onChange={e => setTopoVlan(e.target.value)} className="mt-2 w-full px-2.5 py-1.5 border rounded text-xs">
              <option value="">选择 VLAN</option>
              {vlans.map(v => <option key={v.id} value={v.id}>VLAN {v.id} - {v.name}</option>)}
            </select>
            <select value={topoSrc} onChange={e => setTopoSrc(e.target.value)} className="w-full px-2.5 py-1.5 border rounded text-xs">
              <option value="">源设备</option>
              {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={topoDst} onChange={e => setTopoDst(e.target.value)} className="w-full px-2.5 py-1.5 border rounded text-xs">
              <option value="">目标设备</option>
              {devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <button onClick={runTopoCheck} disabled={!topoVlan || !topoSrc || !topoDst} className="w-full px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs hover:bg-teal-700 disabled:opacity-50">
              查看拓扑
            </button>
            {topoResult && (
              <div className="text-xs space-y-1.5 mt-2">
                <div className={`flex items-center gap-1.5 font-medium ${topoResult.valid ? 'text-green-700' : 'text-red-600'}`}>
                  {topoResult.valid ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  {topoResult.valid ? 'VLAN 路径通畅' : 'VLAN 路径存在问题'}
                </div>
                {topoResult.path.map((p, i) => {
                  const vlanId = parseInt(topoVlan);
                  const allowed = p.port_mode === 'trunk' ? p.allowed_vlans.includes(vlanId) : p.port_mode === 'access' ? p.access_vlan_id === vlanId : true;
                  return (
                    <div key={i} className="pl-2 border-l-2 border-teal-200 py-0.5">
                      <span>{p.entity_name}</span>
                      <span className="text-slate-400 ml-1">({p.port_mode})</span>
                      <span className={`ml-1 ${allowed ? 'text-green-600' : 'text-red-500'}`}>{allowed ? '✓' : '✗'}</span>
                    </div>
                  );
                })}
                {topoResult.issues.map((issue, i) => (
                  <div key={i} className={`text-[10px] ${issue.severity === 'error' ? 'text-red-500' : 'text-amber-500'}`}>⚠ {issue.message}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
