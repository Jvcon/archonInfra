/**
 * 设置页面 — 存储后端管理
 *
 * 功能：
 * - 切换存储后端（Local / GitHub / Worker）
 * - 配置 GitHub PAT + 仓库名
 * - 配置 Worker URL + API Key
 * - 手动触发全量同步（Local → 目标后端）
 * - 导出 / 导入 JSON 快照
 * - 显示离线队列状态
 */
import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useStorageDriver } from '../lib/storage';
import {
  loadStorageConfig, saveStorageConfig, createDriver,
  type StorageConfig, type BackendType,
} from '../lib/storage';
import { syncQueue } from '../lib/sync-queue';
import {
  Database, Github, Cloud, RefreshCw, Download, Upload,
  CheckCircle2, AlertCircle, Info, Eye, EyeOff, Loader2
} from 'lucide-react';

type SyncState = 'idle' | 'syncing' | 'success' | 'error';

export function Settings() {
  const { showToast, switchDriver } = useApp();
  const driver = useStorageDriver();

  // 当前持久化配置
  const [config, setConfig] = useState<StorageConfig>(loadStorageConfig);

  // 表单临时状态
  const [githubPat, setGithubPat] = useState(config.github?.pat ?? '');
  const [githubRepo, setGithubRepo] = useState(config.github?.repo ?? '');
  const [githubBranch, setGithubBranch] = useState(config.github?.branch ?? 'main');
  const [workerUrl, setWorkerUrl] = useState(config.worker?.workerUrl ?? '');
  const [workerApiKey, setWorkerApiKey] = useState(config.worker?.apiKey ?? '');
  const [showPat, setShowPat] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // 操作状态
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncMsg, setSyncMsg] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    syncQueue.size().then(setPendingCount);
  }, []);

  // 构建当前表单对应的配置
  const buildConfig = useCallback((backend: BackendType): StorageConfig => {
    if (backend === 'github') {
      return {
        backend: 'github',
        github: { pat: githubPat, repo: githubRepo, branch: githubBranch || 'main' },
      };
    }
    if (backend === 'worker') {
      return { backend: 'worker', worker: { workerUrl, apiKey: workerApiKey } };
    }
    return { backend: 'local' };
  }, [githubPat, githubRepo, githubBranch, workerUrl, workerApiKey]);

  /** 切换后端 */
  const handleSwitchBackend = async (backend: BackendType) => {
    const newConfig = buildConfig(backend);
    try {
      await switchDriver(newConfig);
      setConfig(newConfig);
      showToast(`已切换到 ${backendLabel(backend)} 模式`, 'success');
    } catch (e) {
      showToast(`切换失败: ${e instanceof Error ? e.message : '未知错误'}`, 'error');
    }
  };

  /** 保存配置但不切换（更新凭证） */
  const handleSaveConfig = () => {
    const newConfig = buildConfig(config.backend);
    saveStorageConfig(newConfig);
    setConfig(newConfig);
    showToast('配置已保存', 'success');
  };

  /** 全量同步（本地 → 当前后端） */
  const handleSync = async () => {
    setSyncState('syncing');
    setSyncMsg('正在同步...');
    try {
      const snapshot = await driver.exportAll();
      const newDriver = createDriver(config);
      await newDriver.importAll(snapshot);
      await syncQueue.clear();
      setPendingCount(0);
      setSyncState('success');
      setSyncMsg(`同步成功，共 ${snapshot.entities.length} 台设备`);
      showToast('全量同步完成', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '同步失败';
      setSyncState('error');
      setSyncMsg(msg);
      showToast(msg, 'error');
    }
  };

  /** 刷新离线队列 */
  const handleFlushQueue = async () => {
    const { flushed, error } = await syncQueue.flush();
    if (error) {
      showToast(`队列刷新失败（已完成 ${flushed} 条）：${error}`, 'error');
    } else {
      showToast(`已同步 ${flushed} 条离线操作`, 'success');
    }
    setPendingCount(await syncQueue.size());
  };

  /** 导出快照 */
  const handleExport = async () => {
    setExporting(true);
    try {
      const snapshot = await driver.exportAll();
      const json = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `netinfra-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('快照已导出', 'success');
    } catch (e) {
      showToast(`导出失败: ${e instanceof Error ? e.message : '未知错误'}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  /** 导入快照 */
  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text);
      await driver.importAll(snapshot);
      showToast(`导入成功，共 ${snapshot.entities?.length ?? 0} 台设备`, 'success');
    } catch (e) {
      showToast(`导入失败: ${e instanceof Error ? e.message : '格式错误'}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const backendLabel = (b: BackendType) => ({ local: '本地', github: 'GitHub', worker: 'Worker' }[b]);

  const backendOptions: { type: BackendType; label: string; desc: string; icon: React.ReactNode }[] = [
    {
      type: 'local',
      label: '本地存储',
      desc: '数据存储在浏览器 IndexedDB，无需网络，完全离线可用',
      icon: <Database className="w-5 h-5" />,
    },
    {
      type: 'github',
      label: 'GitHub 仓库',
      desc: '数据按设备分目录存储到 GitHub 私有仓库，支持版本历史',
      icon: <Github className="w-5 h-5" />,
    },
    {
      type: 'worker',
      label: 'Cloudflare Worker',
      desc: '数据同步到自托管 Cloudflare Worker + D1，支持多设备',
      icon: <Cloud className="w-5 h-5" />,
    },
  ];

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-2xl font-semibold" style={{ color: 'var(--color-ink)' }}>设置</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--color-ink-subtle)' }}>管理数据存储后端和同步配置</p>
      </div>

      {/* ─── 存储后端选择 ─── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-ink-subtle)' }}>存储后端</h3>
        <div className="space-y-2">
          {backendOptions.map(opt => (
            <div
              key={opt.type}
              onClick={() => handleSwitchBackend(opt.type)}
              className="flex items-start gap-4 p-4 rounded-xl border cursor-pointer transition-all"
              style={{
                borderColor: config.backend === opt.type ? 'var(--color-primary)' : 'var(--color-hairline)',
                backgroundColor: config.backend === opt.type ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'var(--color-surface-1)',
              }}
            >
              <div
                className="mt-0.5 shrink-0 p-2 rounded-lg"
                style={{
                  backgroundColor: config.backend === opt.type ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)' : 'var(--color-surface-3)',
                  color: config.backend === opt.type ? 'var(--color-primary)' : 'var(--color-ink-muted)',
                }}
              >
                {opt.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{opt.label}</span>
                  {config.backend === opt.type && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 15%, transparent)', color: 'var(--color-primary)' }}>
                      当前
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-ink-subtle)' }}>{opt.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── GitHub 配置 ─── */}
      {config.backend === 'github' && (
        <section className="space-y-4 p-4 rounded-xl border" style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-surface-1)' }}>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-ink)' }}>
            <Github className="w-4 h-4" />
            GitHub 配置
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-ink-subtle)' }}>
                Personal Access Token (PAT)
              </label>
              <div className="relative">
                <input
                  type={showPat ? 'text' : 'password'}
                  value={githubPat}
                  onChange={e => setGithubPat(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 text-sm rounded-lg border pr-10"
                  style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-canvas)', color: 'var(--color-ink)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPat(!showPat)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-ink-subtle)' }}
                >
                  {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-ink-subtle)' }}>
                需要 repo 权限。
                <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer" className="underline ml-1">创建 PAT</a>
              </p>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-ink-subtle)' }}>仓库（owner/repo）</label>
              <input
                type="text"
                value={githubRepo}
                onChange={e => setGithubRepo(e.target.value)}
                placeholder="your-username/my-homelab-infra"
                className="w-full px-3 py-2 text-sm rounded-lg border"
                style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-canvas)', color: 'var(--color-ink)' }}
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-ink-subtle)' }}>分支</label>
              <input
                type="text"
                value={githubBranch}
                onChange={e => setGithubBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 text-sm rounded-lg border"
                style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-canvas)', color: 'var(--color-ink)' }}
              />
            </div>
          </div>

          <button
            onClick={handleSaveConfig}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            保存 GitHub 配置
          </button>
        </section>
      )}

      {/* ─── Worker 配置 ─── */}
      {config.backend === 'worker' && (
        <section className="space-y-4 p-4 rounded-xl border" style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-surface-1)' }}>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-ink)' }}>
            <Cloud className="w-4 h-4" />
            Cloudflare Worker 配置
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-ink-subtle)' }}>Worker URL</label>
              <input
                type="text"
                value={workerUrl}
                onChange={e => setWorkerUrl(e.target.value)}
                placeholder="https://archoninfra-worker.xxx.workers.dev"
                className="w-full px-3 py-2 text-sm rounded-lg border"
                style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-canvas)', color: 'var(--color-ink)' }}
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--color-ink-subtle)' }}>API Key</label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={workerApiKey}
                  onChange={e => setWorkerApiKey(e.target.value)}
                  placeholder="your-api-key"
                  className="w-full px-3 py-2 text-sm rounded-lg border pr-10"
                  style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-canvas)', color: 'var(--color-ink)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--color-ink-subtle)' }}
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-ink-subtle)' }}>
                对应 Worker 环境变量 API_KEY 的值
              </p>
            </div>
          </div>

          <button
            onClick={handleSaveConfig}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            保存 Worker 配置
          </button>
        </section>
      )}

      {/* ─── 同步操作 ─── */}
      {config.backend !== 'local' && (
        <section className="space-y-4 p-4 rounded-xl border" style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-surface-1)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>数据同步</h3>

          {/* 离线队列状态 */}
          {pendingCount > 0 && (
            <div className="flex items-center gap-2 text-sm p-3 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, #f59e0b 10%, transparent)', color: '#92400e' }}>
              <Info className="w-4 h-4 shrink-0" />
              <span>有 {pendingCount} 条离线写操作待同步</span>
              <button onClick={handleFlushQueue} className="ml-auto text-xs underline font-medium">立即同步</button>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleSync}
              disabled={syncState === 'syncing'}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {syncState === 'syncing'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
              全量同步到{backendLabel(config.backend)}
            </button>
          </div>

          {syncMsg && (
            <div
              className="flex items-center gap-2 text-sm p-3 rounded-lg"
              style={{
                backgroundColor: syncState === 'error'
                  ? 'color-mix(in srgb, #ef4444 10%, transparent)'
                  : 'color-mix(in srgb, #22c55e 10%, transparent)',
                color: syncState === 'error' ? '#7f1d1d' : '#14532d',
              }}
            >
              {syncState === 'error'
                ? <AlertCircle className="w-4 h-4 shrink-0" />
                : <CheckCircle2 className="w-4 h-4 shrink-0" />}
              <span>{syncMsg}</span>
            </div>
          )}
        </section>
      )}

      {/* ─── 导出 / 导入 ─── */}
      <section className="space-y-4 p-4 rounded-xl border" style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-surface-1)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>数据备份</h3>
        <p className="text-xs" style={{ color: 'var(--color-ink-subtle)' }}>
          导出完整快照为 JSON 文件，可用于备份或迁移到其他设备。
        </p>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors hover:bg-slate-50 disabled:opacity-50"
            style={{ borderColor: 'var(--color-hairline)', color: 'var(--color-ink)' }}
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            导出快照
          </button>

          <label className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border cursor-pointer transition-colors hover:bg-slate-50"
            style={{ borderColor: 'var(--color-hairline)', color: 'var(--color-ink)' }}>
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            导入快照
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleImport(file);
                e.target.value = ''; // 允许重复选同一文件
              }}
            />
          </label>
        </div>
        <p className="text-xs" style={{ color: '#ef4444' }}>
          ⚠️ 导入将覆盖当前所有数据，请确保已备份
        </p>
      </section>

      {/* ─── 关于 ─── */}
      <section className="p-4 rounded-xl border" style={{ borderColor: 'var(--color-hairline)', backgroundColor: 'var(--color-surface-1)' }}>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-ink)' }}>关于</h3>
        <div className="text-xs space-y-1" style={{ color: 'var(--color-ink-subtle)' }}>
          <div>ArchonInfra v0.2.0 · Phase 3 Multi-Backend</div>
          <div>当前后端：{backendLabel(config.backend)}</div>
          {config.backend === 'github' && config.github?.repo && (
            <div>仓库：{config.github.repo}</div>
          )}
          {config.backend === 'worker' && config.worker?.workerUrl && (
            <div>Worker：{config.worker.workerUrl}</div>
          )}
        </div>
      </section>
    </div>
  );
}
