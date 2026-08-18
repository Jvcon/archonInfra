import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const port = parseInt(process.env.PORT || '3100', 10);

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        // 开发模式下也启用 SW 以便测试
        devOptions: { enabled: false },
        workbox: {
          // 缓存前端静态资源（JS/CSS/HTML/图片/字体）
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          // bundle 较大（~6MB），调大预缓存文件大小限制
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          // 导航回退到 index.html（SPA 支持）
          navigateFallback: 'index.html',
          // 运行时缓存：Worker API（网络优先，5 秒超时后用缓存）
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
          ],
        },
        manifest: {
          name: 'ArchonInfra — 统一基础设施管理',
          short_name: 'ArchonInfra',
          description: '本地优先的家庭实验室基础设施管理工具',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
    server: {
      port,
      strictPort: true,
      cors: true,
      // 开发时将 /api 代理到本地 wrangler dev
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: mode === 'development',
    },
  };
});
