/** 仪表盘 - 统计概览 */
import { useState, useEffect } from 'react';
import { useStorageDriver } from '../hooks/useStorage';
import { Server, Network, Monitor, HardDrive, AppWindow, GitBranch } from 'lucide-react';
import type { EntityType } from '../types';

interface Stats {
  totalEntities: number;
  entityCounts: Array<{ type: string; count: number }>;
  totalVlans: number;
  ipStats: Array<{ status: string; count: number }>;
  totalEdges: number;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  hardware: <Server className="w-6 h-6" />,
  network: <Network className="w-6 h-6" />,
  vm: <Monitor className="w-6 h-6" />,
  storage: <HardDrive className="w-6 h-6" />,
  app: <AppWindow className="w-6 h-6" />,
};

const TYPE_LABELS: Record<string, string> = {
  hardware: '硬件设备',
  network: '网络',
  vm: '虚拟机',
  storage: '存储',
  app: '应用服务',
};

export function Dashboard() {
  const driver = useStorageDriver();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    async function loadStats() {
      const types: EntityType[] = ['hardware', 'network', 'vm', 'storage', 'app'];
      const entityCounts: Array<{ type: string; count: number }> = [];
      let totalEntities = 0;
      for (const type of types) {
        const result = await driver.getEntities({ type }, { page: 1, pageSize: 1 });
        entityCounts.push({ type, count: result.total });
        totalEntities += result.total;
      }
      const vlans = await driver.getVlans();
      const ips = await driver.getIPAddresses();
      const edges = await driver.getEdges();

      const ipStatusMap = new Map<string, number>();
      for (const ip of ips) {
        ipStatusMap.set(ip.status, (ipStatusMap.get(ip.status) || 0) + 1);
      }
      const ipStats = Array.from(ipStatusMap.entries()).map(([status, count]) => ({ status, count }));

      setStats({ totalEntities, entityCounts, totalVlans: vlans.length, ipStats, totalEdges: edges.length });
    }
    loadStats().catch(console.error);
  }, [driver]);

  if (!stats) {
    return <div className="flex items-center justify-center h-64 text-slate-400">加载中...</div>;
  }

  const assignedIPs = stats.ipStats.find(s => s.status === 'assigned')?.count || 0;
  const totalIPs = stats.ipStats.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-slate-800">概览</h2>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.entityCounts.map(({ type, count }) => (
          <div key={type} className="rounded-lg border border-slate-200 p-5 bg-slate-50">
            <div className="flex items-center justify-between">
              <span className="text-blue-600">{TYPE_ICONS[type] || <Server className="w-6 h-6" />}</span>
              <span className="text-2xl font-semibold text-slate-800">{count}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-slate-600">{TYPE_LABELS[type] || type}</p>
          </div>
        ))}

        <div className="rounded-lg border border-slate-200 p-5 bg-slate-50">
          <div className="flex items-center justify-between">
            <span className="text-blue-600"><Network className="w-6 h-6" /></span>
            <span className="text-2xl font-semibold text-slate-800">{stats.totalVlans}</span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-600">VLAN 数量</p>
        </div>

        <div className="rounded-lg border border-slate-200 p-5 bg-slate-50">
          <div className="flex items-center justify-between">
            <span className="text-blue-600"><GitBranch className="w-6 h-6" /></span>
            <span className="text-2xl font-semibold text-slate-800">{stats.totalEdges}</span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-600">连接数量</p>
        </div>
      </div>

      {/* IP 使用率 */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">IP 地址使用情况</h3>
        {totalIPs > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex-1 bg-slate-100 rounded h-4 overflow-hidden">
                <div
                  className="bg-blue-500 h-4 rounded transition-all"
                  style={{ width: `${(assignedIPs / totalIPs) * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium text-slate-600">
                {assignedIPs}/{totalIPs} 已分配
              </span>
            </div>
            <div className="flex gap-4 text-xs text-slate-500">
              {stats.ipStats.map(s => (
                <span key={s.status}>
                  {s.status === 'assigned' ? '已分配' : s.status === 'available' ? '可用' : '保留'}: {s.count}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-slate-400 text-sm">暂无 IP 地址数据</p>
        )}
      </div>
    </div>
  );
}
