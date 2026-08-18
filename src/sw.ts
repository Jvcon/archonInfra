import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkFirst, Serwist } from 'serwist';
import { ExpirationPlugin } from 'serwist';

// 告知 TypeScript self 的类型（Service Worker 环境）
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  // 预缓存清单由 @serwist/vite 在构建时自动注入
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // 导航回退到 index.html（SPA 支持）
  fallbacks: {
    entries: [{ url: '/index.html', matcher({ request }) { return request.destination === 'document'; } }],
  },
  runtimeCaching: [
    {
      // API 请求：网络优先，超时后使用缓存
      matcher: ({ url }) => url.pathname.startsWith('/api/'),
      handler: new NetworkFirst({
        cacheName: 'api-cache',
        networkTimeoutSeconds: 5,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 60 * 60 * 24, // 24 小时
          }),
        ],
      }),
    },
  ],
});

serwist.addEventListeners();
