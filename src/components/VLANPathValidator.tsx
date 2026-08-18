/** VLAN 路径验证组件 */
import { useState, useEffect } from 'react';
import { useStorageDriver } from '../hooks/useStorage';
import { validateVLANPath } from '../lib/services/vlan-validation';
import type { Entity, VLAN, VLANPathValidationResult, VLANPathHop } from '../types';
import { CheckCircle, XCircle, AlertTriangle, ArrowRight, Route } from 'lucide-react';

interface Props {
  entities: Entity[];
  onClose?: () => void;
}

export function VLANPathValidator({ entities, onClose }: Props) {
  const driver = useStorageDriver();
  const [vlans, setVlans] = useState<VLAN[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [vlanId, setVlanId] = useState('');
  const [result, setResult] = useState<VLANPathValidationResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    driver.getVlans().then(r => setVlans(r));
  }, [driver]);

  const runValidation = async () => {
    if (!sourceId || !targetId || !vlanId) return;
    setLoading(true);
    try {
      const res = await validateVLANPath(sourceId, targetId, parseInt(vlanId));
      setResult(res as unknown as VLANPathValidationResult);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const getHopColor = (_hop: VLANPathHop, index: number) => {
    if (!result) return 'bg-slate-100 border-slate-300';
    const hasError = result.issues.some(i => i.hop_index === index && i.severity === 'error');
    const hasWarning = result.issues.some(i => i.hop_index === index && i.severity === 'warning');
    if (hasError) return 'bg-red-50 border-red-300';
    if (hasWarning) return 'bg-amber-50 border-amber-300';
    return 'bg-green-50 border-green-300';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <Route className="w-4 h-4 text-indigo-500" />
        VLAN 路径验证
        {onClose && (
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600 text-xs">关闭</button>
        )}
      </div>

      {/* 输入区域 */}
      <div className="grid grid-cols-3 gap-2">
        <select value={sourceId} onChange={e => setSourceId(e.target.value)} className="px-2 py-1.5 border rounded-lg text-xs">
          <option value="">源设备</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={targetId} onChange={e => setTargetId(e.target.value)} className="px-2 py-1.5 border rounded-lg text-xs">
          <option value="">目标设备</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={vlanId} onChange={e => setVlanId(e.target.value)} className="px-2 py-1.5 border rounded-lg text-xs">
          <option value="">VLAN</option>
          {vlans.map(v => <option key={v.id} value={v.id}>{v.id} - {v.name}</option>)}
        </select>
      </div>

      <button
        onClick={runValidation}
        disabled={!sourceId || !targetId || !vlanId || loading}
        className="w-full px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? '验证中...' : '验证路径'}
      </button>

      {/* 结果展示 */}
      {result && (
        <div className="space-y-3">
          {/* 总体状态 */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${result.valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {result.valid ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {result.valid ? `VLAN ${result.target_vlan_id} 路径连通` : `VLAN ${result.target_vlan_id} 路径存在问题`}
          </div>

          {/* 路径可视化 */}
          {result.path.length > 0 && (
            <div className="flex items-center gap-1 overflow-x-auto py-2">
              {result.path.map((hop, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <div className={`flex-shrink-0 px-2 py-1.5 border rounded-lg text-xs ${getHopColor(hop, idx)}`}>
                    <div className="font-medium truncate max-w-[80px]" title={hop.entity_name}>{hop.entity_name}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {hop.port_mode === 'endpoint' ? '终端' : hop.port_mode === 'trunk' ? 'Trunk' : 'Access'}
                    </div>
                  </div>
                  {idx < result.path.length - 1 && <ArrowRight className="w-3 h-3 text-slate-400 flex-shrink-0" />}
                </div>
              ))}
            </div>
          )}

          {/* 问题列表 */}
          {result.issues.length > 0 && (
            <div className="space-y-1.5">
              {result.issues.map((issue, idx) => (
                <div key={idx} className={`flex items-start gap-2 px-3 py-2 rounded text-xs ${issue.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {issue.severity === 'error' ? <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
