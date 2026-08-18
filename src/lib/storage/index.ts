/**
 * StorageService — 多后端切换逻辑
 *
 * 后端类型：
 *   'local'   — LocalDriver（IndexedDB，默认，无需配置）
 *   'github'  — GitHubDriver（GitHub 仓库按设备分目录）
 *   'worker'  — WorkerDriver（Cloudflare Worker + D1）
 *
 * 配置持久化到 localStorage（key: archoninfra-storage-config）
 */
import { createContext, useContext } from 'react';
import type { StorageDriver } from './types';
import { LocalDriver } from './local-driver';
import { GitHubDriver, type GitHubConfig } from './github-driver';
import { WorkerDriver, type WorkerConfig } from './worker-driver';

export type { StorageDriver, InfraSnapshot, PaginatedResult, PaginationParams } from './types';
export { LocalDriver } from './local-driver';
export { GitHubDriver } from './github-driver';
export { WorkerDriver } from './worker-driver';
export type { GitHubConfig } from './github-driver';
export type { WorkerConfig } from './worker-driver';

export type BackendType = 'local' | 'github' | 'worker';

export interface StorageConfig {
  backend: BackendType;
  github?: GitHubConfig;
  worker?: WorkerConfig;
}

const CONFIG_KEY = 'archoninfra-storage-config';

/** 读取持久化配置，不存在时返回默认（local）配置 */
export function loadStorageConfig(): StorageConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return JSON.parse(raw) as StorageConfig;
  } catch {
    // ignore
  }
  return { backend: 'local' };
}

/** 持久化存储配置 */
export function saveStorageConfig(config: StorageConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/** 根据配置创建对应 driver 实例 */
export function createDriver(config: StorageConfig): StorageDriver {
  switch (config.backend) {
    case 'github':
      if (!config.github?.pat || !config.github?.repo) {
        console.warn('GitHubDriver 配置不完整，回退到 LocalDriver');
        return new LocalDriver();
      }
      return new GitHubDriver(config.github);
    case 'worker':
      if (!config.worker?.workerUrl || !config.worker?.apiKey) {
        console.warn('WorkerDriver 配置不完整，回退到 LocalDriver');
        return new LocalDriver();
      }
      return new WorkerDriver(config.worker);
    default:
      return new LocalDriver();
  }
}

// 应用启动时根据持久化配置初始化 driver
const initialConfig = loadStorageConfig();
export const defaultDriver = createDriver(initialConfig);

export const StorageContext = createContext<StorageDriver>(defaultDriver);

export function useStorageDriver(): StorageDriver {
  return useContext(StorageContext);
}
