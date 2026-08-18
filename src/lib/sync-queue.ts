/**
 * 离线同步队列
 *
 * 当写操作发生时，将操作记录到 IndexedDB pending_ops 表。
 * 网络恢复时（online 事件）自动 flush 队列。
 *
 * 使用场景：GitHubDriver / WorkerDriver 在离线状态下的写操作缓冲。
 */
import { db, type PendingOp } from './db';

export type { PendingOp };

export interface FlushHandler {
  /** 执行单条挂起操作，成功后从队列删除 */
  (op: PendingOp): Promise<void>;
}

class SyncQueue {
  private flushHandler: FlushHandler | null = null;
  private flushing = false;

  /** 注册 flush 处理器（切换 driver 时调用） */
  register(handler: FlushHandler): void {
    this.flushHandler = handler;
  }

  /** 取消注册（切换到纯本地模式时调用） */
  unregister(): void {
    this.flushHandler = null;
  }

  /** 将写操作加入队列 */
  async enqueue(op: Omit<PendingOp, 'id' | 'created_at'>): Promise<void> {
    await db.pending_ops.add({
      ...op,
      created_at: Date.now(),
    });
  }

  /** 获取当前队列长度 */
  async size(): Promise<number> {
    return db.pending_ops.count();
  }

  /** 清空队列（切换 driver 后全量同步时调用） */
  async clear(): Promise<void> {
    await db.pending_ops.clear();
  }

  /**
   * 刷新队列 — 按时间顺序逐条执行，成功后删除。
   * 任意一条失败则停止（保持顺序一致性）。
   */
  async flush(): Promise<{ flushed: number; error?: string }> {
    if (this.flushing || !this.flushHandler) return { flushed: 0 };
    this.flushing = true;
    let flushed = 0;

    try {
      const ops = await db.pending_ops.orderBy('created_at').toArray();
      for (const op of ops) {
        try {
          await this.flushHandler(op);
          await db.pending_ops.delete(op.id!);
          flushed++;
        } catch (e) {
          const error = e instanceof Error ? e.message : '同步失败';
          return { flushed, error };
        }
      }
      return { flushed };
    } finally {
      this.flushing = false;
    }
  }
}

/** 全局单例 */
export const syncQueue = new SyncQueue();

// 监听网络恢复事件，自动刷新队列
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncQueue.flush().catch(console.error);
  });
}
