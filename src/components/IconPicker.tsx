/** 图标选择器组件 - 支持 lucide-react 通用图标 + simple-icons 品牌图标 */
import { useState, useMemo, useEffect } from 'react';
import {
  Server, Monitor, Cpu, HardDrive, Smartphone, Wifi, Router, Network,
  Camera, Globe, Database, Cloud, Shield, Lock, Zap, Activity,
  Laptop, Tablet, Watch, Tv, Radio, Bluetooth, Signal, Cable,
  Usb, Disc, CircuitBoard, MemoryStick, Microchip, Box,
  MonitorSpeaker, Printer, ScanLine, Headphones, Speaker,
  type LucideIcon,
} from 'lucide-react';
import { Search } from 'lucide-react';
import type { SimpleIconData } from '../data/simple-icons-data';

/** 预定义的硬件相关 lucide 图标集 */
const LUCIDE_ICON_MAP: Record<string, LucideIcon> = {
  Server, Monitor, Cpu, HardDrive, Smartphone, Wifi, Router, Network,
  Camera, Globe, Database, Cloud, Shield, Lock, Zap, Activity,
  Laptop, Tablet, Watch, Tv, Radio, Bluetooth, Signal, Cable,
  Usb, Disc, CircuitBoard, MemoryStick, Microchip, Box,
  MonitorSpeaker, Printer, ScanLine, Headphones, Speaker,
};

type TabType = 'lucide' | 'brand';

/** simple-icons 数据模块缓存（懒加载，只加载一次） */
let simpleIconsCache: {
  SIMPLE_ICONS: SimpleIconData[];
  findSimpleIcon: (slug: string) => SimpleIconData | undefined;
  getRecommendedIcons: () => SimpleIconData[];
} | null = null;

async function loadSimpleIcons() {
  if (!simpleIconsCache) {
    simpleIconsCache = await import('../data/simple-icons-data');
  }
  return simpleIconsCache;
}

interface IconPickerProps {
  value?: string;
  onChange: (iconName: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabType>(() => {
    if (value && !value.startsWith('si:')) return 'lucide';
    return 'brand';
  });
  const [simpleIcons, setSimpleIcons] = useState<typeof simpleIconsCache>(simpleIconsCache);

  // 切到品牌 tab 时才加载图标数据
  useEffect(() => {
    if (tab === 'brand' && !simpleIcons) {
      loadSimpleIcons().then(setSimpleIcons);
    }
  }, [tab, simpleIcons]);

  // Lucide 图标过滤
  const filteredLucide = useMemo(() => {
    const entries = Object.entries(LUCIDE_ICON_MAP);
    if (!search.trim()) return entries;
    const lower = search.toLowerCase();
    return entries.filter(([name]) => name.toLowerCase().includes(lower));
  }, [search]);

  // Simple Icons 过滤（搜索时全量过滤，否则只显示推荐）
  const filteredSimple = useMemo(() => {
    if (!simpleIcons) return [];
    if (!search.trim()) return simpleIcons.getRecommendedIcons();
    const lower = search.toLowerCase();
    return simpleIcons.SIMPLE_ICONS
      .filter(icon => icon.title.toLowerCase().includes(lower) || icon.slug.toLowerCase().includes(lower))
      .slice(0, 100);
  }, [search, simpleIcons]);

  return (
    <div className="space-y-2">
      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="搜索品牌或图标名称..."
        />
      </div>
      {/* Tab 切换 */}
      <div className="flex border-b">
        <button
          type="button"
          onClick={() => setTab('brand')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            tab === 'brand' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          品牌图标
        </button>
        <button
          type="button"
          onClick={() => setTab('lucide')}
          className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
            tab === 'lucide' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          通用图标
        </button>
      </div>
      {/* 图标网格 */}
      {tab === 'brand' ? (
        <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto p-1">
          {!simpleIcons ? (
            <div className="col-span-8 py-6 text-center text-sm text-slate-400">
              <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
              加载图标库...
            </div>
          ) : (
            <>
              {filteredSimple.map(icon => (
                <button
                  key={icon.slug}
                  type="button"
                  onClick={() => onChange(`si:${icon.slug}`)}
                  title={icon.title}
                  className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                    value === `si:${icon.slug}`
                      ? 'bg-blue-100 ring-2 ring-blue-500'
                      : 'hover:bg-slate-100'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill={`#${icon.hex}`}>
                    <path d={icon.path} />
                  </svg>
                </button>
              ))}
              {filteredSimple.length === 0 && (
                <div className="col-span-8 py-4 text-center text-sm text-slate-400">无匹配图标</div>
              )}
              {!search.trim() && (
                <div className="col-span-8 py-1 text-center text-xs text-slate-400">
                  输入关键词搜索更多品牌图标...
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto p-1">
          {filteredLucide.map(([name, Icon]) => (
            <button
              key={name}
              type="button"
              onClick={() => onChange(name)}
              title={name}
              className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                value === name
                  ? 'bg-blue-100 ring-2 ring-blue-500 text-blue-700'
                  : 'hover:bg-slate-100 text-slate-600'
              }`}
            >
              <Icon className="w-5 h-5" />
            </button>
          ))}
          {filteredLucide.length === 0 && (
            <div className="col-span-8 py-4 text-center text-sm text-slate-400">无匹配图标</div>
          )}
        </div>
      )}
    </div>
  );
}

/** 根据图标名称渲染图标的辅助组件 */
export function RenderIcon({ name, className }: { name?: string; className?: string }) {
  const [icon, setIcon] = useState<SimpleIconData | null>(null);

  useEffect(() => {
    if (name?.startsWith('si:')) {
      const slug = name.slice(3);
      loadSimpleIcons().then(m => {
        setIcon(m.findSimpleIcon(slug) ?? null);
      });
    }
  }, [name]);

  if (name?.startsWith('si:')) {
    if (icon) {
      return (
        <svg viewBox="0 0 24 24" className={className || 'w-4 h-4'} fill={`#${icon.hex}`}>
          <path d={icon.path} />
        </svg>
      );
    }
    // 加载中占位
    return <span className={`inline-block rounded bg-slate-200 animate-pulse ${className || 'w-4 h-4'}`} />;
  }

  // lucide-react 图标
  const Icon = name ? LUCIDE_ICON_MAP[name] : undefined;
  if (!Icon) return <Server className={className || 'w-4 h-4 text-slate-400'} />;
  return <Icon className={className || 'w-4 h-4 text-slate-600'} />;
}

/** 向后兼容导出 - 保留原 ICON_MAP 名称 */
export const ICON_MAP = LUCIDE_ICON_MAP;
