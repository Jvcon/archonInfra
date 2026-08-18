/** 侧边栏导航 */
import { useApp } from '../context/AppContext';
import { PAGE_LABELS, type PageName } from '../types';
import {
  LayoutDashboard, Server, Network, Monitor,
  HardDrive, AppWindow, GitBranch, Settings
} from 'lucide-react';

const PAGE_ICONS: Record<PageName, React.ReactNode> = {
  dashboard: <LayoutDashboard className="w-5 h-5" />,
  hardware: <Server className="w-5 h-5" />,
  networks: <Network className="w-5 h-5" />,
  vms: <Monitor className="w-5 h-5" />,
  storage: <HardDrive className="w-5 h-5" />,
  apps: <AppWindow className="w-5 h-5" />,
  topology: <GitBranch className="w-5 h-5" />,
  settings: <Settings className="w-5 h-5" />,
};

export function Sidebar() {
  const { state, setPage } = useApp();
  const mainPages: PageName[] = ['dashboard', 'hardware', 'networks', 'vms', 'storage', 'apps', 'topology'];

  const NavButton = ({ page }: { page: PageName }) => (
    <button
      key={page}
      onClick={() => setPage(page)}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors"
      style={{
        borderRadius: '6px',
        backgroundColor: state.currentPage === page ? 'var(--color-primary)' : 'transparent',
        color: state.currentPage === page ? '#ffffff' : 'var(--color-ink-muted)',
      }}
      onMouseEnter={e => {
        if (state.currentPage !== page) {
          e.currentTarget.style.backgroundColor = 'var(--color-surface-3)';
          e.currentTarget.style.color = 'var(--color-ink)';
        }
      }}
      onMouseLeave={e => {
        if (state.currentPage !== page) {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = 'var(--color-ink-muted)';
        }
      }}
    >
      {PAGE_ICONS[page]}
      <span>{PAGE_LABELS[page]}</span>
    </button>
  );

  return (
    <aside className="w-56 flex flex-col h-full border-r" style={{ backgroundColor: 'var(--color-surface-1)', borderColor: 'var(--color-hairline)' }}>
      <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--color-hairline)' }}>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-ink)', letterSpacing: '-0.5px' }}>ArchonInfra</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-ink-subtle)' }}>统一基础设施管理</p>
      </div>
      <nav className="flex-1 py-3 space-y-0.5 px-2">
        {mainPages.map(page => <NavButton key={page} page={page} />)}
      </nav>
      {/* 底部设置入口 */}
      <div className="px-2 pb-3 border-t pt-3" style={{ borderColor: 'var(--color-hairline)' }}>
        <NavButton page="settings" />
      </div>
    </aside>
  );
}
