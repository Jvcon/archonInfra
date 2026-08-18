import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Serwist } from '@serwist/window';
import App from './App';
import './index.css';

// 注册 Service Worker（生产环境）
if ('serviceWorker' in navigator) {
  const sw = new Serwist('./sw.js', { scope: './', type: 'classic' });
  sw.register();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
