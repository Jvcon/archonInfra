/**
 * TanStack Table v9 基础设施
 * 项目级 tableFeatures 配置 + 辅助工具
 */
import {
  tableFeatures,
  rowPaginationFeature,
  rowSortingFeature,
  rowExpandingFeature,
  columnFilteringFeature,
  createCoreRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  createFilteredRowModel,
  createExpandedRowModel,
  createColumnHelper,
  flexRender,
  useTable,
  type TableOptions,
  type RowData,
} from '@tanstack/react-table';

/**
 * 项目所需的 feature 插件集合（含 row model factories）
 * v9 中 row models 和 features 统一放在 tableFeatures 对象里
 */
export const appFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  rowExpandingFeature,
  columnFilteringFeature,
  coreRowModel: createCoreRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  expandedRowModel: createExpandedRowModel(),
});

/** 轻量版（仅分页排序，用于简单 CRUD 表格） */
export const simpleFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
});

/** 导出 features 类型，供 createColumnHelper 使用 */
export type AppFeatures = typeof appFeatures;
export type SimpleFeatures = typeof simpleFeatures;

export { createColumnHelper, flexRender, useTable };
export type { TableOptions, RowData };
