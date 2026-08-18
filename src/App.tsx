/** 主应用组件 */
import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/Sidebar';
import { Toast } from './components/Toast';
import {
  StorageContext, defaultDriver, createDriver, saveStorageConfig,
  type StorageDriver, type StorageConfig,
} from './lib/storage';

// 页面懒加载——各页面代码仅在首次访问时下载
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Hardware  = lazy(() => import('./pages/Hardware').then(m => ({ default: m.Hardware })));
const Networks  = lazy(() => import('./pages/Networks').then(m => ({ default: m.Networks })));
const VMs       = lazy(() => import('./pages/VMs').then(m => ({ default: m.VMs })));
const Storage   = lazy(() => import('./pages/Storage').then(m => ({ default: m.Storage })));
const Apps      = lazy(() => import('./pages/Apps').then(m => ({ default: m.Apps })));
const Topology  = lazy(() => import('./pages/Topology').then(m => ({ default: m.Topology })));
const Settings  = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));

/** 页面切换时的占位 */
function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin h-6 w-6 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );
}

function PageContent() {
  const { state } = useApp();

  const pages: Record<string, React.ReactElement> = {
    dashboard: <Dashboard />,
    hardware:  <Hardware />,
    networks:  <Networks />,
    vms:       <VMs />,
    storage:   <Storage />,
    apps:      <Apps />,
    topology:  <Topology />,
    settings:  <Settings />,
  };

  return (
    <Suspense fallback={<PageFallback />}>
      {pages[state.currentPage] ?? <Dashboard />}
    </Suspense>
  );
}

function AppLayout() {
  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--color-canvas)' }}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: 'var(--color-canvas)' }}>
        <PageContent />
      </main>
      <Toast />
    </div>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [driver, setDriver] = useState<StorageDriver>(defaultDriver);

  useEffect(() => {
    defaultDriver.init().then(() => setReady(true));
  }, []);

  /** 切换 driver（由 Settings 页面触发） */
  const switchDriver = useCallback(async (config: StorageConfig) => {
    const newDriver = createDriver(config);
    await newDriver.init();
    saveStorageConfig(config);
    setDriver(newDriver);
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'var(--color-canvas)' }}>
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-500">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <StorageContext.Provider value={driver}>
      <AppProvider switchDriver={switchDriver}>
        <AppLayout />
      </AppProvider>
    </StorageContext.Provider>
  );
}
