/** 通用行内编辑组件 - 用于 TanStack Table v9 行内修改 */
import { useState, useEffect, useRef, useCallback } from 'react';
import type { CellContext } from '@tanstack/react-table';
import type { SimpleFeatures } from '../../lib/table';
import type { Entity } from '../types';
import { IconPicker, RenderIcon } from './IconPicker';

/** TableMeta 接口 - 各页面表格需传入 */
export interface TableMeta {
  updateData: (entity: Entity, field: string, value: string) => void;
}

/** 行内编辑单元格 - 文本输入 */
export function InlineEditCell({ getValue, row, column, table }: CellContext<SimpleFeatures, Entity, unknown>) {
  const initialValue = (getValue() as string) || '';
  const [value, setValue] = useState(initialValue);
  const [editing, setEditing] = useState(false);

  useEffect(() => { setValue(initialValue); }, [initialValue]);

  const onBlur = () => {
    setEditing(false);
    if (value !== initialValue) {
      (table.options.meta as TableMeta)?.updateData(row.original, column.id, value);
    }
  };

  if (!editing) {
    return (
      <span
        className="cursor-pointer px-1 py-0.5 rounded hover:bg-slate-100 inline-block min-w-[40px]"
        onClick={() => setEditing(true)}
        title="点击编辑"
      >
        {value || <span className="text-slate-300">-</span>}
      </span>
    );
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={onBlur}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="w-full px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    />
  );
}

/** 行内编辑 - 下拉选择 */
export function InlineSelectCell({ getValue, row, table, options, field }: CellContext<SimpleFeatures, Entity, unknown> & {
  options: { value: string; label: string }[];
  field?: string;
}) {
  const currentValue = (getValue() as string) || '';
  const [editing, setEditing] = useState(false);
  const colField = field || 'category';

  if (!editing) {
    const label = options.find(o => o.value === currentValue)?.label || currentValue || '-';
    return (
      <span
        className="cursor-pointer px-2 py-0.5 bg-slate-100 rounded text-xs hover:bg-slate-200 inline-block"
        onClick={() => setEditing(true)}
        title="点击编辑"
      >
        {label}
      </span>
    );
  }

  return (
    <select
      autoFocus
      value={currentValue}
      onChange={e => {
        setEditing(false);
        (table.options.meta as TableMeta)?.updateData(row.original, colField, e.target.value);
      }}
      onBlur={() => setEditing(false)}
      className="px-2 py-1 border rounded text-xs focus:ring-2 focus:ring-blue-500"
    >
      <option value="">-</option>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

/** 行内图标编辑 */
export function InlineIconCell({ row, table }: CellContext<SimpleFeatures, Entity, unknown>) {
  const meta = (row.original.metadata || {}) as Record<string, unknown>;
  const iconName = meta.icon as string | undefined;
  const [showPicker, setShowPicker] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部自动关闭
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setShowPicker(false);
    }
  }, []);

  useEffect(() => {
    if (showPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPicker, handleClickOutside]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setShowPicker(!showPicker)}
        className="p-1 rounded hover:bg-slate-100"
        title={iconName || '选择图标'}
      >
        <RenderIcon name={iconName} className="w-5 h-5 text-slate-600" />
      </button>
      {showPicker && (
        <div className="absolute z-50 top-8 left-0 w-80 bg-white border rounded-xl shadow-xl p-3">
          <IconPicker
            value={iconName}
            onChange={name => {
              setShowPicker(false);
              (table.options.meta as TableMeta)?.updateData(row.original, 'icon', name);
            }}
          />
          <button
            onClick={() => setShowPicker(false)}
            className="mt-2 w-full text-xs text-slate-500 hover:text-slate-700"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}
