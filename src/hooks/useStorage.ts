/**
 * 替代 useApi 的存储 hook
 * 数据来源从 fetch API 切换为 StorageDriver
 */
import { useState, useCallback } from 'react';

export function useStorage<T>() {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (fn: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      setData(result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '操作失败';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, execute, setData };
}

export { useStorageDriver } from '../lib/storage';
