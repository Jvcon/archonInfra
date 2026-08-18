/** 主应用组件 */
import { useState, useEffect, useCallback } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/Sidebar';
import { Toast } from './components/Toast';
import { Dashboard } from './pages/Dashboard';
import { Hardware } from './pages/Hardware';
import { Networks } from './pages/Networks';
import { VMs } from './pages/VMs';
import { Storage } from './pages/Storage';
import { Apps } from './pages/Apps';
import { Topology } from './pages/Topology';
import { Settings } from './pages/Settings';
import {
  StorageContext, defaultDriver, createDriver, saveStorageConfig,
  type StorageDriver, type StorageConfig,
} from './lib/storage';

function PageContent() {
  const { state } = useApp();

  const pages: Record<string, React.ReactElement> = {
    dashboard: <Dashboard />,
    hardware: <Hardware />,
    networks: <Networks />,
    vms: <VMs />,
    storage: <Storage />,
    apps: <Apps />,
    topology: <Topology />,
    settings: <Settings />,
  };

  return pages[state.currentPage] ?? <Dashboard />;
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
