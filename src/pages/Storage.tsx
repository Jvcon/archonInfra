/** 存储管理页面 - 侧滑抽屉编辑 + 设备关联 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStorageDriver } from '../hooks/useStorage';
import { useApp } from '../context/AppContext';
import { Drawer } from '../components/Drawer';
import { Pagination } from '../components/Pagination';
import { IconPicker } from '../components/IconPicker';
import { InlineEditCell, InlineSelectCell, InlineIconCell, type TableMeta } from '../components/InlineEdit';
import { FormInput } from '../components/forms/FormInput';
import { FormField } from '../components/forms/FormField';
import { useStorageForm } from '../hooks/forms/useStorageForm';
import type { StorageFormValues, StorageMetadataValues, ShareEntryValues } from '../../lib/schemas/storage';
import { STORAGE_DEFAULT_VALUES } from '../../lib/schemas/storage';
import type { Entity } from '../types';
import { Plus, Trash2, Edit, X } from 'lucide-react';
import { simpleFeatures, createColumnHelper, flexRender, useTable } from '../../lib/table';
import type { SimpleFeatures } from '../../lib/table';
import type { ColumnDef } from '@tanstack/react-table';

const columnHelper = createColumnHelper<SimpleFeatures, Entity>();

/** 部署类型 */
type DeployType = 'standalone' | 'vm' | 'hardware';
const DEPLOY_LABELS: Record<DeployType, string> = {
  standalone: 'Standalone',
  vm: 'VM（虚拟机）',
  hardware: 'Hardware（硬件）',
};

/** 存储分类 */
type StorageCat = 'nas' | 'san' | 'disk';
const STORAGE_CAT_LABELS: Record<StorageCat, string> = { nas: 'NAS', san: 'SAN', disk: '磁盘' };

/** 分享协议类型 */
type ShareType = 'NFS' | 'SMB' | 'iSCSI' | 'FTP' | 'SFTP' | 'WebDav' | 'Other';
const SHARE_TYPES: ShareType[] = ['NFS', 'SMB', 'iSCSI', 'FTP', 'SFTP', 'WebDav', 'Other'];

/** Storage metadata 类型（兼容表格行内编辑使用） */
interface StorageMetadata {
  deploy_type?: DeployType;
  host_entity_id?: string;
  storage_type?: string;
  raid_type?: string;
  drive_count?: number;
  raw_space?: string;
  usable_space?: string;
  file_system?: string;
  icon?: string;
  note?: string;
  shares?: { id: string; type: ShareType; name: string; notes?: string }[];
}

/** 解析容量字符串为 GB 数值 */
const parseSpace = (s: string): number | null => {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^([\d.]+)\s*(TB|GB|MB|PB)$/i);
  if (m && m[1] && m[2]) {
    const val = parseFloat(m[1]);
    if (isNaN(val)) return null;
    const unit = m[2].toUpperCase();
    if (unit === 'PB') return val * 1024 * 1024;
    if (unit === 'TB') return val * 1024;
    if (unit === 'GB') return val;
    if (unit === 'MB') return val / 1024;
    return null;
  }
  const num = parseFloat(trimmed);
  if (!isNaN(num)) return num * 1024;
  return null;
};

/** 将 GB 数值格式化为可读字符串 */
const formatSpace = (gb: number): string => {
  if (gb >= 1024 * 1024) return `${+(gb / (1024 * 1024)).toFixed(2)}PB`;
  if (gb >= 1024) return `${+(gb / 1024).toFixed(2)}TB`;
  if (gb >= 1) return `${+gb.toFixed(2)}GB`;
  return `${+(gb * 1024).toFixed(2)}MB`;
};

/** 根据 RAID 类型和磁盘数计算可用空间比例 */
const calcUsableSpace = (rawStr: string, raidType?: string, driveCount?: number): string | null => {
  const rawGb = parseSpace(rawStr);
  if (rawGb === null) return null;
  if (!raidType || raidType === '') return formatSpace(rawGb);
  const n = driveCount || 2;
  let usableGb = rawGb;
  switch (raidType) {
    case 'RAID0': usableGb = rawGb; break;
    case 'RAID1': usableGb = rawGb / n; break;
    case 'RAID5':
    case 'RAID-Z1': usableGb = n > 1 ? rawGb * (n - 1) / n : rawGb; break;
    case 'RAID6':
    case 'RAID-Z2': usableGb = n > 2 ? rawGb * (n - 2) / n : rawGb; break;
    case 'RAID-Z3': usableGb = n > 3 ? rawGb * (n - 3) / n : rawGb; break;
    default: return null;
  }
  return formatSpace(usableGb);
};

export function Storage() {
  const { showToast } = useApp();
  const driver = useStorageDriver();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // 抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editItem, setEditItem] = useState<Entity | null>(null);
  const [drawerTab, setDrawerTab] = useState<'basic' | 'shares'>('basic');
  // 表单默认值（驱动 useStorageForm 的 defaultValues，编辑时设为 item 数据）
  const [formDefaultValues, setFormDefaultValues] = useState<StorageFormValues>(STORAGE_DEFAULT_VALUES);

  // 分享表单（独立于主表单，仅用于创建新分享条目）
  const [newShareType, setNewShareType] = useState<ShareType>('NFS');
  const [newShareName, setNewShareName] = useState('');
  const [newShareNotes, setNewShareNotes] = useState('');

  // 关联设备列表
  const [hardwareList, setHardwareList] = useState<{ id: string; name: string }[]>([]);
  const [vmList, setVmList] = useState<{ id: string; name: string }[]>([]);

  /** 表单提交处理 */
  const handleFormSubmit = useCallback(async (values: StorageFormValues) => {
    const meta = { ...values.metadata };
    // 提交时计算 usable_space
    if (meta.raw_space) {
      const usable = calcUsableSpace(meta.raw_space, meta.raid_type, meta.drive_count);
      if (usable !== null) meta.usable_space = usable;
    }
    const now = new Date().toISOString();
    try {
      if (editItem) {
        await driver.updateEntity(editItem.id, {
          name: values.name.trim(),
          category: values.category,
          metadata: meta as Record<string, unknown>,
          updated_at: now,
        });
      } else {
        const newEntity: Entity = {
          id: crypto.randomUUID(),
          type: 'storage',
          name: values.name.trim(),
          category: values.category,
          metadata: meta as Record<string, unknown>,
          created_at: now,
          updated_at: now,
        };
        await driver.saveEntity(newEntity);
      }
      showToast(editItem ? '更新成功' : '创建成功', 'success');
      setDrawerOpen(false);
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    }
  }, [editItem, driver, showToast]);

  const form = useStorageForm({ defaultValues: formDefaultValues, onSubmit: handleFormSubmit });

  const loadData = useCallback(async () => {
    const res = await driver.getEntities({ type: 'storage' }, { page, pageSize: 15 });
    setEntities(res.data);
    setTotal(res.total);
  }, [page, driver]);

  const loadDeviceLists = useCallback(async () => {
    const [hwRes, vmRes] = await Promise.all([
      driver.getEntities({ type: 'hardware' }, { page: 1, pageSize: 999 }),
      driver.getEntities({ type: 'vm' }, { page: 1, pageSize: 999 }),
    ]);
    setHardwareList(hwRes.data.map(e => ({ id: e.id, name: e.name })));
    setVmList(vmRes.data.map(e => ({ id: e.id, name: e.name })));
  }, [driver]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadDeviceLists(); }, [loadDeviceLists]);

  /** 行内编辑回调 */
  const handleInlineUpdate = useCallback(async (entity: Entity, field: string, value: string) => {
    try {
      if (field === 'name') {
        await driver.updateEntity(entity.id, { name: value });
      } else if (field === 'category') {
        await driver.updateEntity(entity.id, { category: value as any });
      } else {
        const currentMeta = (entity.metadata || {}) as StorageMetadata;
        const newMeta = { ...currentMeta, [field]: value || undefined };
        if ((field === 'raw_space' || field === 'raid_type' || field === 'drive_count') && newMeta.raw_space) {
          const usable = calcUsableSpace(newMeta.raw_space, newMeta.raid_type, newMeta.drive_count);
          if (usable !== null) newMeta.usable_space = usable;
        }
        await driver.updateEntity(entity.id, { metadata: newMeta });
      }
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '更新失败', 'error');
    }
  }, [loadData, showToast, driver]);

  /** 选项列表 */
  const categoryOptions = useMemo(() => Object.entries(STORAGE_CAT_LABELS).map(([v, l]) => ({ value: v, label: l })), []);
  const deployOptions = useMemo(() => Object.entries(DEPLOY_LABELS).map(([v, l]) => ({ value: v, label: l })), []);
  const raidOptions = useMemo(() => ['', 'RAID0', 'RAID1', 'RAID5', 'RAID6', 'RAID-Z1', 'RAID-Z2', 'RAID-Z3'].map(v => ({ value: v, label: v || '无' })), []);

  /** 打开创建抽屉 */
  const openCreate = () => {
    setEditItem(null);
    setFormDefaultValues(STORAGE_DEFAULT_VALUES);
    setDrawerTab('basic');
    setDrawerOpen(true);
  };

  /** 打开编辑抽屉 */
  const openEdit = (item: Entity) => {
    setEditItem(item);
    const meta = (item.metadata || {}) as StorageMetadataValues;
    setFormDefaultValues({
      name: item.name,
      category: (item.category as StorageCat) || 'nas',
      metadata: {
        ...meta,
        shares: meta.shares || [],
      },
    });
    setDrawerTab('basic');
    setDrawerOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除？')) return;
    await driver.deleteEntity(id);
    showToast('已删除', 'success');
    loadData();
  };

  /** 部署类型变更时清空关联设备 */
  const handleDeployTypeChange = (dt: DeployType) => {
    form.setFieldValue('metadata.deploy_type', dt);
    form.setFieldValue('metadata.host_entity_id', undefined as any);
  };

  /** 添加分享 */
  const handleAddShare = () => {
    if (!newShareName.trim()) { showToast('请输入分享名称', 'error'); return; }
    const currentShares = (form.getFieldValue('metadata.shares') || []) as ShareEntryValues[];
    form.setFieldValue('metadata.shares', [
      ...currentShares,
      {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: newShareType,
        name: newShareName.trim(),
        notes: newShareNotes.trim() || undefined,
      },
    ]);
    setNewShareName('');
    setNewShareNotes('');
  };

  /** 删除分享 */
  const handleRemoveShare = (index: number) => {
    const shares = (form.getFieldValue('metadata.shares') || []) as ShareEntryValues[];
    form.setFieldValue('metadata.shares', shares.filter((_: ShareEntryValues, i: number) => i !== index));
  };

  /** 获取关联设备名称 */
  const getHostName = (meta: StorageMetadata) => {
    if (!meta.host_entity_id) return null;
    if (meta.deploy_type === 'vm') return vmList.find(v => v.id === meta.host_entity_id)?.name || '未知';
    if (meta.deploy_type === 'hardware') return hardwareList.find(h => h.id === meta.host_entity_id)?.name || '未知';
    return null;
  };

  /* TanStack Table v9 列定义 - 行内编辑 */
  const columns = [
    columnHelper.display({ id: 'icon', header: '图标', cell: (ctx) => InlineIconCell({ ...ctx }) }),
    columnHelper.display({ id: 'name', header: '名称', cell: (ctx) => {
      const mockCtx = { ...ctx, getValue: () => ctx.row.original.name, column: { ...ctx.column, id: 'name' } };
      return InlineEditCell(mockCtx as any);
    }}),
    columnHelper.display({ id: 'category', header: '分类', cell: (ctx) => {
      const mockCtx = { ...ctx, getValue: () => ctx.row.original.category || '', column: { ...ctx.column, id: 'category' } };
      return InlineSelectCell({ ...mockCtx, options: categoryOptions, field: 'category' } as any);
    }}),
    columnHelper.display({ id: 'deploy_type', header: '部署类型', cell: (ctx) => {
      const meta = (ctx.row.original.metadata || {}) as StorageMetadata;
      const mockCtx = { ...ctx, getValue: () => meta.deploy_type || 'standalone', column: { ...ctx.column, id: 'deploy_type' } };
      return InlineSelectCell({ ...mockCtx, options: deployOptions, field: 'deploy_type' } as any);
    }}),
    columnHelper.display({
      id: 'host',
      header: '运行于',
      cell: ({ row }) => {
        const meta = (row.original.metadata || {}) as StorageMetadata;
        const name = getHostName(meta);
        return name ? (
          <span className="text-sm text-slate-700">{name}</span>
        ) : <span className="text-slate-400 text-xs">-</span>;
      },
    }),
    columnHelper.display({ id: 'raid_type', header: 'RAID', cell: (ctx) => {
      const meta = (ctx.row.original.metadata || {}) as StorageMetadata;
      const mockCtx = { ...ctx, getValue: () => meta.raid_type || '', column: { ...ctx.column, id: 'raid_type' } };
      return InlineSelectCell({ ...mockCtx, options: raidOptions, field: 'raid_type' } as any);
    }}),
    columnHelper.display({ id: 'raw_space', header: '空间', cell: (ctx) => {
      const meta = (ctx.row.original.metadata || {}) as StorageMetadata;
      const mockCtx = { ...ctx, getValue: () => meta.raw_space || '', column: { ...ctx.column, id: 'raw_space' } };
      return InlineEditCell(mockCtx as any);
    }}),
    columnHelper.display({
      id: 'actions',
      header: () => <span className="block text-right">操作</span>,
      cell: ({ row }) => (
        <div className="text-right whitespace-nowrap">
          <button onClick={() => openEdit(row.original)} className="p-1 hover:bg-slate-100 rounded"><Edit className="w-4 h-4 text-slate-500" /></button>
          <button onClick={() => handleDelete(row.original.id)} className="p-1 hover:bg-red-50 rounded ml-1"><Trash2 className="w-4 h-4 text-red-500" /></button>
        </div>
      ),
    }),
  ] as ColumnDef<SimpleFeatures, Entity>[];

  const table = useTable({
    features: simpleFeatures,
    columns,
    data: entities,
    meta: { updateData: handleInlineUpdate } as TableMeta,
  });

  const isDirty = form.state.isDirty;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">存储</h2>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          <Plus className="w-4 h-4" /> 添加
        </button>
      </div>

      <div className="bg-white rounded-xl border overflow-visible">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => (
                  <th key={header.id} className="px-4 py-3 text-left">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y">
            {table.getRowModel().rows.map(row => (
              <tr key={row.id} className="hover:bg-slate-50">
                {row.getAllCells().map(cell => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {entities.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">暂无存储数据</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={15} total={total} onChange={setPage} />

      {/* 侧滑抽屉 - 创建/编辑存储 */}
      <Drawer
        open={drawerOpen}
        onClose={() => { setFormDefaultValues(STORAGE_DEFAULT_VALUES); setDrawerOpen(false); }}
        title={editItem ? `存储详情 - ${editItem.name}` : '添加存储'}
        onBeforeClose={() => !isDirty}
        footer={
          <>
            <button onClick={() => { setFormDefaultValues(STORAGE_DEFAULT_VALUES); setDrawerOpen(false); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
            <button
              onClick={() => form.handleSubmit()}
              disabled={form.state.isSubmitting}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              保存
            </button>
          </>
        }
      >
        {/* Tab 导航 */}
        <div className="flex gap-1 border-b mb-4">
          {([['basic', '基础信息'], ['shares', '分享']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setDrawerTab(key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                drawerTab === key ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
              {key === 'shares' && ((form.getFieldValue('metadata.shares') || []).length > 0 ? ` (${(form.getFieldValue('metadata.shares') || []).length})` : '')}
            </button>
          ))}
        </div>

        {/* 基础信息 Tab */}
        {drawerTab === 'basic' && (
        <div className="space-y-4">
          {/* 存储名称 */}
          <form.Field name="name">
            {(field) => (
              <FormInput field={field} label="存储名称" required placeholder="如：main-nas-01" />
            )}
          </form.Field>

          {/* 存储分类 */}
          <form.Field name="category">
            {(field) => (
              <FormField label="分类">
                <select
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  {Object.entries(STORAGE_CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FormField>
            )}
          </form.Field>

          <hr className="my-2" />

          {/* 部署类型 */}
          <form.Field name="metadata.deploy_type">
            {(field) => (
              <FormField
                label="部署类型"
                hint={
                  field.state.value === 'vm' ? '运行在虚拟机中，依赖虚拟机系统提供存储服务' :
                  field.state.value === 'hardware' ? '直接运行在硬件上，跟随硬件系统提供存储服务' :
                  '独立设备（DAS、U盘、移动硬盘等）'
                }
              >
                <select
                  value={field.state.value || 'standalone'}
                  onChange={(e) => handleDeployTypeChange(e.target.value as DeployType)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  {Object.entries(DEPLOY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </FormField>
            )}
          </form.Field>

          {/* 关联设备（VM 或 Hardware 时显示） */}
          <form.Subscribe
            selector={(state) => state.values.metadata?.deploy_type}
          >
            {(deployType) => (
              <>
                {deployType === 'vm' && (
                  <form.Field name="metadata.host_entity_id">
                    {(field) => (
                      <FormField label="所属虚拟机">
                        <select
                          value={field.state.value || ''}
                          onChange={(e) => field.handleChange(e.target.value || undefined as any)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        >
                          <option value="">未指定</option>
                          {vmList.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      </FormField>
                    )}
                  </form.Field>
                )}
                {deployType === 'hardware' && (
                  <form.Field name="metadata.host_entity_id">
                    {(field) => (
                      <FormField label="所属硬件">
                        <select
                          value={field.state.value || ''}
                          onChange={(e) => field.handleChange(e.target.value || undefined as any)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        >
                          <option value="">未指定</option>
                          {hardwareList.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                        </select>
                      </FormField>
                    )}
                  </form.Field>
                )}
              </>
            )}
          </form.Subscribe>

          <hr className="my-2" />

          {/* Storage Type */}
          <form.Field name="metadata.storage_type">
            {(field) => (
              <FormInput field={field} label="Storage Type" placeholder="如：SSD, HDD, NVMe" />
            )}
          </form.Field>

          {/* RAID Type */}
          <form.Field name="metadata.raid_type">
            {(field) => (
              <FormField label="RAID Type">
                <select
                  value={field.state.value || ''}
                  onChange={(e) => field.handleChange(e.target.value || undefined as any)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">无</option>
                  <option value="RAID0">RAID0</option>
                  <option value="RAID1">RAID1</option>
                  <option value="RAID5">RAID5</option>
                  <option value="RAID6">RAID6</option>
                  <option value="RAID-Z1">RAID-Z1</option>
                  <option value="RAID-Z2">RAID-Z2</option>
                  <option value="RAID-Z3">RAID-Z3</option>
                </select>
              </FormField>
            )}
          </form.Field>

          {/* Drive Count / Raw Space / Usable Space */}
          <div className="grid grid-cols-3 gap-3">
            <form.Field name="metadata.drive_count">
              {(field) => (
                <FormField label="Drive Count">
                  <input
                    type="number"
                    value={field.state.value ?? ''}
                    onChange={(e) => field.handleChange(e.target.value ? Number(e.target.value) : undefined as any)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="4"
                  />
                </FormField>
              )}
            </form.Field>

            <form.Field name="metadata.raw_space">
              {(field) => (
                <FormField label="Raw Space">
                  <input
                    value={field.state.value || ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                    placeholder="4TB"
                  />
                </FormField>
              )}
            </form.Field>

            {/* Usable Space - 只读，自动计算 */}
            <form.Subscribe
              selector={(state) => ({
                raw_space: state.values.metadata?.raw_space,
                raid_type: state.values.metadata?.raid_type,
                drive_count: state.values.metadata?.drive_count,
              })}
            >
              {({ raw_space, raid_type, drive_count }) => {
                const computed = raw_space ? calcUsableSpace(raw_space, raid_type, drive_count) : null;
                return (
                  <FormField label="Usable Space">
                    <input
                      value={computed || ''}
                      readOnly
                      className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-50 text-slate-600 cursor-default"
                      placeholder="自动计算"
                      title="根据 Raw Space 和 RAID Type 自动计算"
                    />
                  </FormField>
                );
              }}
            </form.Subscribe>
          </div>

          {/* File System */}
          <form.Field name="metadata.file_system">
            {(field) => (
              <FormInput field={field} label="File System" placeholder="如：ext4, ZFS, Btrfs, NTFS" />
            )}
          </form.Field>

          <hr className="my-2" />

          {/* 图标选择 */}
          <form.Subscribe
            selector={(state) => state.values.metadata?.icon}
          >
            {(iconValue) => (
              <FormField label="图标">
                <IconPicker
                  value={iconValue}
                  onChange={(icon) => form.setFieldValue('metadata.icon', icon)}
                />
              </FormField>
            )}
          </form.Subscribe>

          {/* 备注 */}
          <form.Field name="metadata.note">
            {(field) => (
              <FormField label="备注">
                <textarea
                  value={field.state.value || ''}
                  onChange={(e) => field.handleChange(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
                  placeholder="备注信息..."
                />
              </FormField>
            )}
          </form.Field>
        </div>
        )}

        {/* 分享 Tab */}
        {drawerTab === 'shares' && (
        <div className="space-y-4">
          {/* 已有分享列表 */}
          <form.Subscribe
            selector={(state) => (state.values.metadata?.shares || []) as ShareEntryValues[]}
          >
            {(shares) => (
              <>
                {shares.length > 0 ? (
                  <div className="space-y-2">
                    {shares.map((share: ShareEntryValues, index: number) => (
                      <div key={share.id} className="flex items-start justify-between bg-slate-50 px-3 py-2.5 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">{share.type}</span>
                            <span className="text-sm font-medium text-slate-700 truncate">{share.name}</span>
                          </div>
                          {share.notes && <p className="text-xs text-slate-400 mt-1 truncate">{share.notes}</p>}
                        </div>
                        <button onClick={() => handleRemoveShare(index)} className="p-1 hover:bg-red-50 rounded ml-2 shrink-0">
                          <X className="w-3.5 h-3.5 text-red-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-4">暂无分享，请在下方添加</p>
                )}
              </>
            )}
          </form.Subscribe>

          {/* 添加新分享 */}
          <div className="border-t pt-4 space-y-3">
            <h4 className="text-sm font-medium text-slate-700">添加分享</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">协议类型</label>
                <select value={newShareType} onChange={e => setNewShareType(e.target.value as ShareType)} className="w-full px-3 py-2 border rounded-lg text-sm">
                  {SHARE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">名称 <span className="text-red-500">*</span></label>
                <input value={newShareName} onChange={e => setNewShareName(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="如：media-share" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">备注</label>
              <input value={newShareNotes} onChange={e => setNewShareNotes(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="可选备注" />
            </div>
            <button onClick={handleAddShare} className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              添加分享
            </button>
          </div>
        </div>
        )}
      </Drawer>
    </div>
  );
}
