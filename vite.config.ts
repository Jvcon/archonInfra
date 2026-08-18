import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { serwist } from '@serwist/vite';

export default defineConfig(({ mode }) => {
  const port = parseInt(process.env.PORT || '3100', 10);

  return {
    plugins: [
      react(),
      tailwindcss(),
      serwist({
        // SW 源文件（构建时编译）
        swSrc: 'src/sw.ts',
        // 输出到 dist/sw.js
        swDest: 'sw.js',
        // 预缓存扫描目录（构建输出目录）
        globDirectory: 'dist',
        // 缓存前端静态资源（JS/CSS/HTML/图片/字体）
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // bundle 较大（~6MB），调大预缓存文件大小限制
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // 开发模式下关闭（与原配置保持一致）
        disable: mode === 'development',
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
      rollupOptions: {
        output: {
          manualChunks: {
            // React 核心 — 几乎不变，长期缓存
            'vendor-react': ['react', 'react-dom'],
            // 拓扑可视化 — 最重，单独分包（~1.5MB）
            'vendor-cytoscape': ['cytoscape', 'cytoscape-dagre'],
            // 图算法库
            'vendor-graphology': ['graphology', 'graphology-shortest-path', 'graphology-traversal'],
            // TanStack 组件库
            'vendor-tanstack': ['@tanstack/react-form', '@tanstack/react-table'],
            // 本地存储 + 网络工具
            'vendor-utils': ['dexie', 'ipaddr.js', 'zod'],
          },
        },
      },
    },
  };
});
