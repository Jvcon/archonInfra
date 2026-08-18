/** 网络管理页面 - 4 Tab（网络定义 + 接入配置 + 安全策略 + 路由/NAT）+ 右侧可收起工具面板 */
import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { NetworkDefinitionTab } from '../components/NetworkDefinitionTab';
import { AccessConfigTab } from '../components/AccessConfigTab';
import { VlanPolicyPanel } from '../components/VlanPolicyPanel';
import { RoutingNatPanel } from '../components/RoutingNatPanel';
import { NetworkToolPanel } from '../components/NetworkToolPanel';
import { Globe, Cable, Shield, Route, Wrench, PanelRightClose, PanelRightOpen } from 'lucide-react';

type Tab = 'definition' | 'access' | 'policy' | 'routing';

export function Networks() {
  const { showToast } = useApp();
  const [tab, setTab] = useState<Tab>('definition');
  const [toolPanelOpen, setToolPanelOpen] = useState(true);

  const tabs: { key: Tab; label: string; icon: typeof Globe }[] = [
    { key: 'definition', label: '网络定义', icon: Globe },
    { key: 'access', label: '接入配置', icon: Cable },
    { key: 'policy', label: '安全策略', icon: Shield },
    { key: 'routing', label: '路由/NAT', icon: Route },
  ];

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-slate-800">网络管理</h2>
        <button
          onClick={() => setToolPanelOpen(!toolPanelOpen)}
          className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:bg-slate-50"
          style={{ borderColor: 'var(--color-hairline)', color: toolPanelOpen ? 'var(--color-primary)' : 'var(--color-ink-subtle)' }}
          title={toolPanelOpen ? '收起工具面板' : '展开工具面板'}
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>工具</span>
          {toolPanelOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="flex gap-4">
        {/* 主内容区 */}
        <div className="flex-1 min-w-0">
          {/* Tab 导航 */}
          <div className="flex gap-1 border-b mb-4" style={{ borderColor: 'var(--color-hairline)' }}>
            {tabs.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
                  style={{
                    borderColor: tab === t.key ? 'var(--color-primary)' : 'transparent',
                    color: tab === t.key ? 'var(--color-ink)' : 'var(--color-ink-subtle)',
                  }}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Tab 内容 */}
          {tab === 'definition' && <NetworkDefinitionTab showToast={showToast} />}
          {tab === 'access' && <AccessConfigTab showToast={showToast} />}
          {tab === 'policy' && <VlanPolicyPanel />}
          {tab === 'routing' && <RoutingNatPanel />}
        </div>

        {/* 右侧工具面板 - 支持收起/展开动画 */}
        <div
          className={`hidden lg:block shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${toolPanelOpen ? 'w-[320px] opacity-100' : 'w-0 opacity-0'}`}
        >
          <NetworkToolPanel showToast={showToast} />
        </div>
      </div>

      {/* 移动端工具面板（底部） */}
      <div className="lg:hidden">
        <NetworkToolPanel showToast={showToast} />
      </div>
    </div>
  );
}
