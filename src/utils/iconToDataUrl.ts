/** 将图标名转为 SVG data URL，供 Cytoscape background-image 使用 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ICON_MAP } from '../components/IconPicker';
import { findSimpleIcon } from '../data/simple-icons-data';

// 缓存已生成的 data URL
const iconCache = new Map<string, string>();

/**
 * 将图标名转为 SVG data URL
 * 支持两种格式：
 * - "Server" → lucide-react 图标
 * - "si:docker" → simple-icons 品牌图标
 */
export function iconToDataUrl(iconName: string, color = '#475569'): string {
  const cacheKey = `${iconName}__${color}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey)!;

  let dataUrl: string;

  if (iconName.startsWith('si:')) {
    // simple-icons：直接拼接 SVG 字符串
    const icon = findSimpleIcon(iconName.slice(3));
    if (!icon) {
      return iconToDataUrl('Server', color);
    }
    const fillColor = color === '#475569' ? `#${icon.hex}` : color;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="${fillColor}"><path d="${icon.path}"/></svg>`;
    dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  } else {
    // lucide-react 图标
    const IconComponent = ICON_MAP[iconName];
    if (!IconComponent) {
      return iconToDataUrl('Server', color);
    }
    const svgString = renderToStaticMarkup(
      createElement(IconComponent, { size: 24, color, strokeWidth: 2 })
    );
    dataUrl = `data:image/svg+xml,${encodeURIComponent(svgString)}`;
  }

  iconCache.set(cacheKey, dataUrl);
  return dataUrl;
}

/**
 * 根据设备类别返回默认图标名
 */
export function getDefaultIcon(category: string): string {
  const defaults: Record<string, string> = {
    server: 'Server',
    switch: 'Network',
    router: 'Router',
    ont: 'Globe',
    pc: 'Monitor',
    phone: 'Smartphone',
    laptop: 'Laptop',
    camera: 'Camera',
    ap: 'Wifi',
    ac: 'Wifi',
    nas: 'HardDrive',
    san: 'Database',
    vm: 'Monitor',
    container: 'Box',
    service: 'Zap',
    application: 'Activity',
    iot: 'Cpu',
    hypervisor: 'Server',
  };
  return defaults[category] || 'Server';
}
