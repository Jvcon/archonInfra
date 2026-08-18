/** 通用 API 请求 hook */
import { useState, useCallback } from 'react';

const BASE = './api';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    const errResp = err as { error?: string };
    throw new Error(errResp.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function useApi<T>() {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (path: string, options?: RequestInit) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<T>(path, options);
      setData(result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, execute };
}
