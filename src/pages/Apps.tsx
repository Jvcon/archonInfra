/** 应用服务管理页面 - 侧滑抽屉编辑 + 网络地址管理 */
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { useStorageDriver } from '../hooks/useStorage';
import { useApp } from '../context/AppContext';
import { Drawer } from '../components/Drawer';
import { Pagination } from '../components/Pagination';
import { IconPicker } from '../components/IconPicker';
import { InlineEditCell, InlineSelectCell, InlineIconCell, type TableMeta } from '../components/InlineEdit';
import { FormInput } from '../components/forms/FormInput';
import { FormField } from '../components/forms/FormField';
import { useAppForm } from '../hooks/forms/useAppForm';
import type { AppFormValues, AppMetadataValues } from '../../lib/schemas/app';
import { APP_DEFAULT_VALUES } from '../../lib/schemas/app';
import type { Entity, Subnet, IPAddress, AppMetadata, AppAddress, AppNetworkMode, DockerPortMapping } from '../types';
import { DEPLOY_TYPE_LABELS, VM_NETWORK_MODES, CONTAINER_NETWORK_MODES, CONTAINER_NETWORK_MODE_DESCRIPTIONS, DOCKER_DEFAULT_BRIDGE_SUBNET } from '../types';
import type { DeployType } from '../types';
import { Plus, Trash2, Edit, Globe, Lock, Info, Network, Server, Monitor, Box } from 'lucide-react';
import { simpleFeatures, createColumnHelper, flexRender, useTable } from '../../lib/table';
import type { SimpleFeatures } from '../../lib/table';
import type { ColumnDef } from '@tanstack/react-table';

type AppCat = 'container' | 'service' | 'application';

const columnHelper = createColumnHelper<SimpleFeatures, Entity>();

/** 判断是否为 Docker Bridge 模式（使用内部IP + 端口映射） */
function isDockerBridgeMode(category?: AppCat, networkMode?: AppNetworkMode): boolean {
  return category === 'container' && networkMode === 'bridge';
}

/** 判断该网络模式是否支持从 IPAM 分配 IP */
function isIpamMode(deployType?: DeployType, networkMode?: AppNetworkMode, category?: AppCat): boolean {
  if (!deployType || deployType === 'standalone') return true;
  // hardware 上的非容器应用继承宿主 IP，不走 IPAM；容器仍走 IPAM
  if (deployType === 'hardware') return category === 'container';
  if (deployType === 'vm') return networkMode === 'bridge';
  // container: macvlan 从 IPAM 分配
  if (category === 'container') return networkMode === 'macvlan';
  return false;
}

/** 判断该网络模式是否需要手动输入 IP */
function isManualIpMode(deployType?: DeployType, networkMode?: AppNetworkMode, _category?: AppCat): boolean {
  if (!deployType || deployType === 'standalone' || deployType === 'hardware') return false;
  if (deployType === 'vm') return networkMode === 'nat' || networkMode === 'host-only';
  // container bridge 不再是手动输入，改为 Docker Bridge 专属UI
  return false;
}

/** 判断该网络模式是否无需独立 IP（host 共享宿主网络 / none 无网络） */
function isNoIpMode(deployType?: DeployType, networkMode?: AppNetworkMode): boolean {
  if (!deployType || deployType === 'standalone' || deployType === 'hardware') return false;
  // 容器的 host/none 模式无需独立 IP（无论部署在 VM 还是直接硬件上）
  return networkMode === 'host' || networkMode === 'none';
}

export function Apps() {
  const { showToast } = useApp();
  const driver = useStorageDriver();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  // 抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editItem, setEditItem] = useState<Entity | null>(null);
  const [drawerTab, setDrawerTab] = useState<'basic' | 'addresses'>('basic');
  // 表单默认值（驱动 useAppForm 的 defaultValues，编辑时设为 item 数据）
  const [formDefaultValues, setFormDefaultValues] = useState<AppFormValues>(APP_DEFAULT_VALUES);

  // 新增地址表单（独立于主表单，仅用于创建新地址条目）
  const [newAddrLabel, setNewAddrLabel] = useState('');
  const [newAddrIp, setNewAddrIp] = useState('');
  const [newAddrSubnetId, setNewAddrSubnetId] = useState('');
  const [newAddrPort, setNewAddrPort] = useState('');
  const [newAddrHttps, setNewAddrHttps] = useState(false);
  const [newAddrExtPorts, setNewAddrExtPorts] = useState('');

  // 关联设备和子网列表
  const [hardwareList, setHardwareList] = useState<{ id: string; name: string }[]>([]);
  const [vmList, setVmList] = useState<{ id: string; name: string; metadata?: Record<string, unknown> }[]>([]);
  const [subnets, setSubnets] = useState<Subnet[]>([]);
  const [availableIps, setAvailableIps] = useState<IPAddress[]>([]);
  // 宿主 VM 的已分配 IP（service/application 部署在 VM 上时使用）
  const [hostVmIps, setHostVmIps] = useState<Array<{ address: string; subnet_cidr?: string }>>([]);
  // 宿主实体的子网列表（macvlan / host 模式使用）
  const [hostSubnets, setHostSubnets] = useState<Subnet[]>([]);
  // Docker Bridge 端口映射表单
  const [newPmHostPort, setNewPmHostPort] = useState('');
  const [newPmContainerPort, setNewPmContainerPort] = useState('');
  const [newPmProtocol, setNewPmProtocol] = useState<'tcp' | 'udp' | 'both'>('tcp');
  const [newPmDesc, setNewPmDesc] = useState('');

  const loadData = useCallback(async () => {
    const res = await driver.getEntities({ type: 'app' }, { page, pageSize: 15 });
    setEntities(res.data);
    setTotal(res.total);
  }, [page, driver]);

  const loadDeviceLists = useCallback(async () => {
    const [hwRes, vmRes, subRes] = await Promise.all([
      driver.getEntities({ type: 'hardware' }, { pageSize: 999 }),
      driver.getEntities({ type: 'vm' }, { pageSize: 999 }),
      driver.getSubnets(),
    ]);
    setHardwareList(hwRes.data.map(e => ({ id: e.id, name: e.name })));
    setVmList(vmRes.data.map(e => ({ id: e.id, name: e.name, metadata: e.metadata })));
    setSubnets(subRes);
  }, [driver]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadDeviceLists(); }, [loadDeviceLists]);

  // 表单提交处理
  const handleFormSubmit = useCallback(async (values: AppFormValues) => {
    const meta = { ...values.metadata };
    try {
      if (editItem) {
        await driver.updateEntity(editItem.id, {
          name: values.name.trim(),
          category: values.category,
          metadata: meta as Record<string, unknown>,
        });
      } else {
        const newEntity: Entity = {
          id: crypto.randomUUID(),
          type: 'app',
          name: values.name.trim(),
          category: values.category,
          metadata: meta as Record<string, unknown>,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await driver.saveEntity(newEntity);
      }
      showToast(editItem ? '更新成功' : '创建成功', 'success');
      setDrawerOpen(false);
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    }
  }, [editItem, driver, showToast, loadData]);

  const form = useAppForm({ defaultValues: formDefaultValues, onSubmit: handleFormSubmit });

  /** 行内编辑回调 */
  const handleInlineUpdate = useCallback(async (entity: Entity, field: string, value: string) => {
    try {
      if (field === 'name') {
        await driver.updateEntity(entity.id, { name: value });
      } else if (field === 'category') {
        await driver.updateEntity(entity.id, { category: value as AppCat });
      } else if (field === 'deploy_type') {
        // 部署类型变更 → 清空关联设备和网络模式
        const currentMeta = (entity.metadata || {}) as AppMetadata;
        const newMeta: AppMetadata = {
          ...currentMeta,
          deploy_type: (value || undefined) as DeployType | undefined,
          host_entity_id: undefined,
          network_mode: entity.category === 'container' ? 'bridge' : undefined,
          port_mappings: undefined,
          docker_internal_ip: undefined,
          docker_subnet: undefined,
        };
        await driver.updateEntity(entity.id, { metadata: newMeta as Record<string, unknown> });
      } else if (field === 'host_entity_id') {
        const currentMeta = (entity.metadata || {}) as AppMetadata;
        await driver.updateEntity(entity.id, { metadata: { ...currentMeta, host_entity_id: value || undefined } as Record<string, unknown> });
      } else if (field === 'network_mode') {
        // 网络模式变更 → 清理相关字段
        const currentMeta = (entity.metadata || {}) as AppMetadata;
        const newMode = (value || undefined) as AppNetworkMode | undefined;
        const newMeta: AppMetadata = {
          ...currentMeta,
          network_mode: newMode,
          // 离开 bridge 模式时清理端口映射
          ...(currentMeta.network_mode === 'bridge' && newMode !== 'bridge' ? { port_mappings: undefined, docker_internal_ip: undefined, docker_subnet: undefined } : {}),
          // 离开 macvlan 模式时清理地址
          ...(currentMeta.network_mode === 'macvlan' && newMode !== 'macvlan' ? { addresses: [] } : {}),
        };
        await driver.updateEntity(entity.id, { metadata: newMeta as Record<string, unknown> });
      } else {
        const currentMeta = (entity.metadata || {}) as AppMetadata;
        await driver.updateEntity(entity.id, { metadata: { ...currentMeta, [field]: value || undefined } as Record<string, unknown> });
      }
      loadData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '更新失败', 'error');
    }
  }, [loadData, showToast, driver]);

  /** 类型选项 */
  const appCatOptions = useMemo(() => [
    { value: 'container', label: '容器' },
    { value: 'service', label: '服务' },
    { value: 'application', label: '应用' },
  ], []);

  /** 部署类型选项 */
  const deployTypeOptions = useMemo(() => [
    { value: 'standalone', label: 'Standalone' },
    { value: 'vm', label: 'VM（虚拟机）' },
    { value: 'hardware', label: 'Hardware（硬件）' },
  ], []);

  /** 网络模式选项（根据类型动态获取） */
  const getNetworkModeOptions = useCallback((category?: string) => {
    if (category === 'container') {
      return [
        { value: 'bridge', label: 'Bridge（桥接）' },
        { value: 'host', label: 'Host（主机）' },
        { value: 'macvlan', label: 'Macvlan' },
        { value: 'none', label: 'None（无网络）' },
      ];
    }
    return [
      { value: 'bridge', label: 'Bridge（桥接）' },
      { value: 'nat', label: 'NAT（地址转换）' },
      { value: 'host-only', label: 'Host-Only（仅主机）' },
    ];
  }, []);

  /** 关联设备选项（根据部署类型动态获取） */
  const getHostOptions = useCallback((deployType?: string) => {
    if (deployType === 'vm') return vmList.map(v => ({ value: v.id, label: v.name }));
    if (deployType === 'hardware') return hardwareList.map(h => ({ value: h.id, label: h.name }));
    return [];
  }, [vmList, hardwareList]);

  /** 加载子网下可用 IP */
  const loadAvailableIps = async (subnetId: string) => {
    if (!subnetId) { setAvailableIps([]); return; }
    const ips = await driver.getIPAddresses({ subnet_id: subnetId });
    setAvailableIps(ips.filter(ip => ip.status === 'available'));
  };

  /** 加载宿主 VM 的已分配 IP */
  const loadHostVmIps = async (vmEntityId: string) => {
    if (!vmEntityId) { setHostVmIps([]); return; }
    const ips = await driver.getIPAddresses({ entity_id: vmEntityId });
    // Map subnet_id to cidr for display purposes
    const allSubnets = await driver.getSubnets();
    const subnetMap = new Map(allSubnets.map(s => [s.id, s.cidr]));
    setHostVmIps(ips.map(ip => ({ address: ip.address, subnet_cidr: subnetMap.get(ip.subnet_id) })));
  };

  /** 加载宿主实体的子网列表（用于 macvlan 自动关联） */
  const loadHostSubnets = async (entityId: string) => {
    if (!entityId) { setHostSubnets([]); return; }
    const subnets = await driver.getSubnets();
    // Filter subnets that are associated with the entity (via IP addresses)
    const entityIps = await driver.getIPAddresses({ entity_id: entityId });
    const entitySubnetIds = new Set(entityIps.map(ip => ip.subnet_id));
    setHostSubnets(subnets.filter(s => entitySubnetIds.has(s.id)));
  };

  /** 判断当前 App 是否为"服务/应用跟随 VM 网络"模式 */
  const isServiceOnVm = form.state.values.metadata.deploy_type === 'vm' && form.state.values.category !== 'container';

  /** 判断当前 App 是否为"服务/应用部署在 Hardware 上"模式（继承宿主 IP） */
  const isServiceOnHardware = form.state.values.metadata.deploy_type === 'hardware' && form.state.values.category !== 'container';

  /** 获取宿主 VM 的网络模式 */
  const getHostVmNetworkMode = () => {
    if (!form.state.values.metadata.host_entity_id) return undefined;
    const vm = vmList.find(v => v.id === form.state.values.metadata.host_entity_id);
    return (vm?.metadata as Record<string, unknown>)?.network_mode as string | undefined;
  };

  /** 打开创建抽屉 */
  const openCreate = () => {
    setEditItem(null);
    setFormDefaultValues(APP_DEFAULT_VALUES);
    setDrawerTab('basic');
    setDrawerOpen(true);
  };

  /** 打开编辑抽屉 */
  const openEdit = (item: Entity) => {
    setEditItem(item);
    const meta = (item.metadata || {}) as AppMetadataValues;
    setFormDefaultValues({
      name: item.name,
      category: (item.category as AppCat) || 'service',
      metadata: meta,
    });
    setDrawerTab('basic');
    setDrawerOpen(true);
    loadNetworkData(item, meta as AppMetadata);
  };

  /** 快捷打开 IP/网络 Tab */
  const openIPTab = (item: Entity) => {
    setEditItem(item);
    const meta = (item.metadata || {}) as AppMetadataValues;
    setFormDefaultValues({
      name: item.name,
      category: (item.category as AppCat) || 'service',
      metadata: meta,
    });
    setDrawerTab('addresses');
    setDrawerOpen(true);
    loadNetworkData(item, meta as AppMetadata);
  };

  /** 加载网络相关的所有依赖数据 */
  const loadNetworkData = (item: Entity, meta: AppMetadata) => {
    // 宿主 VM 的 IP（服务/应用跟随 VM / Docker 模式）
    if (meta.deploy_type === 'vm' && meta.host_entity_id) {
      loadHostVmIps(meta.host_entity_id);
    }
    // 宿主 Hardware 的 IP（服务/应用部署在硬件上，继承宿主 IP）
    if (meta.deploy_type === 'hardware' && meta.host_entity_id && item.category !== 'container') {
      loadHostVmIps(meta.host_entity_id);
    }
    // 宿主子网（macvlan / 容器模式）
    if (meta.host_entity_id && (item.category === 'container' || meta.network_mode === 'macvlan')) {
      loadHostSubnets(meta.host_entity_id);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除？')) return;
    await driver.deleteEntity(id);
    showToast('已删除', 'success');
    loadData();
  };

  /** 部署类型变更 - 容器自动推荐 bridge */
  const handleDeployTypeChange = (dt: DeployType) => {
    let defaultMode: AppNetworkMode | undefined = undefined;
    if (form.state.values.category === 'container') {
      defaultMode = 'bridge';
    }
    form.setFieldValue('metadata.deploy_type', dt);
    form.setFieldValue('metadata.host_entity_id', undefined);
    form.setFieldValue('metadata.network_mode', defaultMode);
    form.setFieldValue('metadata.port_mappings', undefined);
    form.setFieldValue('metadata.docker_internal_ip', undefined);
    form.setFieldValue('metadata.docker_subnet', undefined);
    setHostSubnets([]);
    setHostVmIps([]);
  };

  /** 网络模式变更 - 智能提示 */
  const handleNetworkModeChange = (mode: AppNetworkMode) => {
    const oldMode = form.state.values.metadata.network_mode;
    const oldMappings = form.state.values.metadata.port_mappings;
    const oldAddresses = form.state.values.metadata.addresses;
    const hostId = form.state.values.metadata.host_entity_id;
    // 从 bridge 切换且有端口映射 → 确认
    if (oldMode === 'bridge' && mode !== 'bridge' && (oldMappings?.length ?? 0) > 0) {
      if (!confirm('切换网络模式将清除现有端口映射配置，是否继续？')) return;
    }
    // 从 macvlan 切换且有地址 → 确认
    if (oldMode === 'macvlan' && mode !== 'macvlan' && (oldAddresses?.length ?? 0) > 0) {
      if (!confirm('切换网络模式将清除已分配的 IP 地址，是否继续？')) return;
    }
    form.setFieldValue('metadata.network_mode', mode);
    // 清理 bridge 专属字段
    if (mode !== 'bridge') {
      form.setFieldValue('metadata.port_mappings', undefined);
      form.setFieldValue('metadata.docker_internal_ip', undefined);
      form.setFieldValue('metadata.docker_subnet', undefined);
    }
    // 清理 macvlan 地址
    if (oldMode === 'macvlan' && mode !== 'macvlan') {
      form.setFieldValue('metadata.addresses', []);
    }
    // macvlan 模式：自动加载宿主子网
    if (mode === 'macvlan' && hostId) {
      loadHostSubnets(hostId);
    }
  };

  /** 添加 Docker 端口映射 */
  const handleAddPortMapping = () => {
    const hp = parseInt(newPmHostPort);
    const cp = parseInt(newPmContainerPort);
    if (isNaN(hp) || isNaN(cp) || hp <= 0 || cp <= 0) { showToast('请输入有效的端口号', 'error'); return; }
    const mapping: DockerPortMapping = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      host_port: hp,
      container_port: cp,
      protocol: newPmProtocol,
      description: newPmDesc.trim() || undefined,
    };
    const currentMappings = form.getFieldValue('metadata.port_mappings') || [];
    form.setFieldValue('metadata.port_mappings', [...currentMappings, mapping]);
    setNewPmHostPort(''); setNewPmContainerPort(''); setNewPmProtocol('tcp'); setNewPmDesc('');
  };

  /** 删除端口映射 */
  const handleRemovePortMapping = (id: string) => {
    const currentMappings = (form.getFieldValue('metadata.port_mappings') || []);
    form.setFieldValue('metadata.port_mappings', currentMappings.filter(m => m.id !== id));
  };

  /** 添加地址条目 */
  const handleAddAddress = () => {
    const addr: AppAddress = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      label: newAddrLabel.trim() || undefined,
      ip: newAddrIp.trim() || undefined,
      subnet_id: newAddrSubnetId || undefined,
      port: newAddrPort ? parseInt(newAddrPort) : undefined,
      use_https: newAddrHttps || undefined,
      external_ports: newAddrExtPorts.trim()
        ? newAddrExtPorts.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
        : undefined,
    };
    const currentAddresses = form.getFieldValue('metadata.addresses') || [];
    form.setFieldValue('metadata.addresses', [...currentAddresses, addr]);
    setNewAddrLabel(''); setNewAddrIp(''); setNewAddrSubnetId('');
    setNewAddrPort(''); setNewAddrHttps(false); setNewAddrExtPorts('');
  };

  /** 删除地址条目 */
  const handleRemoveAddress = (id: string) => {
    const currentAddresses = (form.getFieldValue('metadata.addresses') || []);
    form.setFieldValue('metadata.addresses', currentAddresses.filter(a => a.id !== id));
  };

  /** 获取宿主名称 */
  const getHostName = (meta: AppMetadata) => {
    if (!meta.host_entity_id) return null;
    if (meta.deploy_type === 'vm') return vmList.find(v => v.id === meta.host_entity_id)?.name || '未知';
    if (meta.deploy_type === 'hardware') return hardwareList.find(h => h.id === meta.host_entity_id)?.name || '未知';
    return null;
  };

  /* === 表格列定义 - 行内编辑 === */
  const columns = [
    columnHelper.display({ id: 'icon', header: '图标', cell: (ctx) => InlineIconCell({ ...ctx }) }),
    columnHelper.display({ id: 'name', header: '名称', cell: (ctx) => {
      const mockCtx = { ...ctx, getValue: () => ctx.row.original.name, column: { ...ctx.column, id: 'name' } };
      return InlineEditCell(mockCtx as any);
    }}),
    columnHelper.display({ id: 'category', header: '类型', cell: (ctx) => {
      const mockCtx = { ...ctx, getValue: () => ctx.row.original.category || '', column: { ...ctx.column, id: 'category' } };
      return InlineSelectCell({ ...mockCtx, options: appCatOptions, field: 'category' } as any);
    }}),
    columnHelper.display({
      id: 'deploy',
      header: '部署位置',
      cell: (ctx) => {
        const meta = (ctx.row.original.metadata || {}) as AppMetadata;
        const dt = meta.deploy_type || '';
        const hostName = getHostName(meta);
        const mockCtx = { ...ctx, getValue: () => dt, column: { ...ctx.column, id: 'deploy_type' } };
        return (
          <div className="flex items-center gap-1">
            {InlineSelectCell({ ...mockCtx, options: deployTypeOptions, field: 'deploy_type' } as any)}
            {meta.deploy_type && meta.deploy_type !== 'standalone' && (
              <span className="text-xs text-blue-600">
                {hostName ? `@ ${hostName}` : ''}
              </span>
            )}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: 'host_entity',
      header: '关联设备',
      cell: (ctx) => {
        const meta = (ctx.row.original.metadata || {}) as AppMetadata;
        if (!meta.deploy_type || meta.deploy_type === 'standalone') return <span className="text-slate-400 text-xs">-</span>;
        const hostOptions = getHostOptions(meta.deploy_type);
        const mockCtx = { ...ctx, getValue: () => meta.host_entity_id || '', column: { ...ctx.column, id: 'host_entity_id' } };
        return InlineSelectCell({ ...mockCtx, options: hostOptions, field: 'host_entity_id' } as any);
      },
    }),
    columnHelper.display({
      id: 'network',
      header: '网络模式',
      cell: (ctx) => {
        const meta = (ctx.row.original.metadata || {}) as AppMetadata;
        if (!meta.deploy_type || meta.deploy_type === 'standalone') return <span className="text-slate-400 text-xs">-</span>;
        const options = getNetworkModeOptions(ctx.row.original.category);
        const mockCtx = { ...ctx, getValue: () => meta.network_mode || '', column: { ...ctx.column, id: 'network_mode' } };
        return InlineSelectCell({ ...mockCtx, options, field: 'network_mode' } as any);
      },
    }),
    columnHelper.display({
      id: 'ip',
      header: 'IP / 端口',
      cell: ({ row }) => {
        const meta = (row.original.metadata || {}) as AppMetadata;
        // Docker Bridge: 显示端口映射数量
        if (row.original.category === 'container' && meta.network_mode === 'bridge') {
          const mappings = meta.port_mappings || [];
          return (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-slate-700 flex-1">
                {meta.docker_internal_ip && <span>{meta.docker_internal_ip} </span>}
                {mappings.length > 0 ? <span className="text-blue-500">({mappings.length}映射)</span> : (!meta.docker_internal_ip && <span className="text-slate-400">-</span>)}
              </span>
              <button onClick={(e) => { e.stopPropagation(); openIPTab(row.original); }} className="p-1 hover:bg-blue-50 rounded shrink-0" title="管理IP/网络">
                <Network className="w-3.5 h-3.5 text-blue-500" />
              </button>
            </div>
          );
        }
        const addrs = meta.addresses || [];
        const first = addrs[0];
        const display = first ? (first.ip ? `${first.ip}${first.port ? ':' + first.port : ''}` : (first.port ? ':' + first.port : '-')) : null;
        return (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-slate-700 flex-1">
              {first ? (
                <>
                  {first.use_https && <Lock className="w-3 h-3 inline mr-0.5 text-green-500" />}
                  {display}
                  {addrs.length > 1 && <span className="ml-1 text-blue-500">+{addrs.length - 1}</span>}
                </>
              ) : <span className="text-slate-400">-</span>}
            </span>
            <button onClick={(e) => { e.stopPropagation(); openIPTab(row.original); }} className="p-1 hover:bg-blue-50 rounded shrink-0" title="管理IP/网络">
              <Network className="w-3.5 h-3.5 text-blue-500" />
            </button>
          </div>
        );
      },
    }),
    columnHelper.display({ id: 'hostname', header: 'Hostname', cell: (ctx) => {
      const meta = (ctx.row.original.metadata || {}) as AppMetadata;
      const mockCtx = { ...ctx, getValue: () => meta.hostname || '', column: { ...ctx.column, id: 'hostname' } };
      return InlineEditCell(mockCtx as any);
    }}),
    columnHelper.display({
      id: 'actions',
      header: () => <span className="block text-right">操作</span>,
      cell: ({ row }) => (
        <div className="text-right">
          <button onClick={() => openEdit(row.original)} className="p-1 hover:bg-slate-100 rounded"><Edit className="w-4 h-4 text-slate-500" /></button>
          <button onClick={() => handleDelete(row.original.id)} className="p-1 hover:bg-red-50 rounded ml-1"><Trash2 className="w-4 h-4 text-red-500" /></button>
        </div>
      ),
    }),
  ] as ColumnDef<SimpleFeatures, Entity>[];

  /** 按部署位置分组（Standalone / 各个 VM / 各个 Hardware） */
  const groupedEntities = useMemo(() => {
    type Group = { key: string; label: string; icon: 'standalone' | 'vm' | 'hardware'; entities: Entity[] };
    const groups: Map<string, Group> = new Map();
    // 确保 standalone 始终在最前
    groups.set('standalone', { key: 'standalone', label: 'Standalone（独立部署）', icon: 'standalone', entities: [] });

    for (const entity of entities) {
      const meta = (entity.metadata || {}) as AppMetadata;
      const dt = meta.deploy_type || 'standalone';
      const hostId = meta.host_entity_id;

      if (dt === 'standalone' || !hostId) {
        groups.get('standalone')!.entities.push(entity);
      } else if (dt === 'vm') {
        const groupKey = `vm_${hostId}`;
        if (!groups.has(groupKey)) {
          const vmName = vmList.find(v => v.id === hostId)?.name || '未知虚拟机';
          groups.set(groupKey, { key: groupKey, label: `VM: ${vmName}`, icon: 'vm', entities: [] });
        }
        groups.get(groupKey)!.entities.push(entity);
      } else if (dt === 'hardware') {
        const groupKey = `hw_${hostId}`;
        if (!groups.has(groupKey)) {
          const hwName = hardwareList.find(h => h.id === hostId)?.name || '未知设备';
          groups.set(groupKey, { key: groupKey, label: `Hardware: ${hwName}`, icon: 'hardware', entities: [] });
        }
        groups.get(groupKey)!.entities.push(entity);
      }
    }

    // 过滤掉空组
    return Array.from(groups.values()).filter(g => g.entities.length > 0);
  }, [entities, vmList, hardwareList]);

  const table = useTable({ features: simpleFeatures, columns, data: entities, meta: { updateData: handleInlineUpdate } as TableMeta });

  /** 获取分组图标 */
  const getGroupIcon = (icon: 'standalone' | 'vm' | 'hardware') => {
    switch (icon) {
      case 'vm': return <Monitor className="w-4 h-4 text-purple-500" />;
      case 'hardware': return <Server className="w-4 h-4 text-orange-500" />;
      default: return <Box className="w-4 h-4 text-blue-500" />;
    }
  };

  const isDirty = form.state.isDirty;

  /* === 渲染 === */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">应用服务</h2>
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
            {groupedEntities.length > 0 ? (
              groupedEntities.map(group => {
                // 找到该分组对应的行
                const groupRows = table.getRowModel().rows.filter(row =>
                  group.entities.some(e => e.id === row.original.id)
                );
                return (
                  <Fragment key={group.key}>
                    {/* 分组标题行 */}
                    <tr className="bg-slate-100/70">
                      <td colSpan={table.getAllColumns().length} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {getGroupIcon(group.icon)}
                          <span className="text-sm font-semibold text-slate-700">{group.label}</span>
                          <span className="text-xs text-slate-400 ml-1">({group.entities.length})</span>
                        </div>
                      </td>
                    </tr>
                    {/* 分组内的数据行 */}
                    {groupRows.map(row => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        {row.getAllCells().map(cell => (
                          <td key={cell.id} className="px-4 py-3">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })
            ) : (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">暂无应用数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={15} total={total} onChange={setPage} />

      {/* 侧滑抽屉 */}
      <Drawer
        open={drawerOpen}
        onClose={() => { setFormDefaultValues(APP_DEFAULT_VALUES); setDrawerOpen(false); }}
        title={editItem ? '编辑应用' : '添加应用'}
        onBeforeClose={isDirty ? () => confirm('有未保存的更改，确定关闭？') : undefined}
        footer={
          <div className="flex justify-end gap-2">
            <button onClick={() => { setFormDefaultValues(APP_DEFAULT_VALUES); setDrawerOpen(false); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
            <button onClick={() => form.handleSubmit()} disabled={form.state.isSubmitting} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">保存</button>
          </div>
        }
      >
        {/* Tab 切换 */}
        <div className="flex border-b mb-4">
          <button onClick={() => setDrawerTab('basic')} className={`px-4 py-2 text-sm font-medium border-b-2 ${drawerTab === 'basic' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            基本信息
          </button>
          <button onClick={() => setDrawerTab('addresses')} className={`px-4 py-2 text-sm font-medium border-b-2 ${drawerTab === 'addresses' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            IP/网络
          </button>
        </div>

        {drawerTab === 'basic' && (
          <div className="space-y-4">
            {/* 名称 */}
            <form.Field name="name">
              {(field) => (
                <FormInput field={field} label="名称" required placeholder="应用名称" />
              )}
            </form.Field>
            {/* 类型 */}
            <form.Field name="category">
              {(field) => (
                <FormField label="类型">
                  <select value={field.state.value} onChange={e => field.handleChange(e.target.value as AppCat)} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="container">容器</option>
                    <option value="service">服务</option>
                    <option value="application">应用</option>
                  </select>
                </FormField>
              )}
            </form.Field>
            {/* 部署类型 */}
            <form.Field name="metadata.deploy_type">
              {(field) => (
                <FormField label="部署类型">
                  <select value={(field.state.value as string) || 'standalone'} onChange={e => handleDeployTypeChange(e.target.value as DeployType)} className="w-full px-3 py-2 border rounded-lg text-sm">
                    {Object.entries(DEPLOY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </FormField>
              )}
            </form.Field>
            {/* 关联设备（VM/Hardware 时显示） */}
            <form.Subscribe selector={(s) => s.values.metadata.deploy_type}>
              {(deployType) => (<>
                {deployType === 'vm' && (
                  <form.Field name="metadata.host_entity_id">
                    {(field) => (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">关联虚拟机</label>
                        <select value={(field.state.value as string) || ''} onChange={e => {
                          const id = e.target.value || undefined;
                          field.handleChange(id);
                          // 服务/应用自动继承 VM 网络模式
                          if (form.state.values.category !== 'container' && id) {
                            const vm = vmList.find(v => v.id === id);
                            const vmMode = (vm?.metadata as Record<string, unknown>)?.network_mode as AppNetworkMode | undefined;
                            if (vmMode) form.setFieldValue('metadata.network_mode', vmMode);
                          }
                          if (id) {
                            loadHostVmIps(id);
                            if (form.state.values.category === 'container') loadHostSubnets(id);
                          } else {
                            setHostVmIps([]);
                            setHostSubnets([]);
                          }
                        }} className="w-full px-3 py-2 border rounded-lg text-sm">
                          <option value="">-- 选择 --</option>
                          {vmList.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      </div>
                    )}
                  </form.Field>
                )}
                {deployType === 'hardware' && (
                  <form.Field name="metadata.host_entity_id">
                    {(field) => (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">关联硬件设备</label>
                        <select value={(field.state.value as string) || ''} onChange={e => {
                          const id = e.target.value || undefined;
                          field.handleChange(id);
                          if (id) {
                            if (form.state.values.category !== 'container') loadHostVmIps(id);
                            else { loadHostSubnets(id); setHostVmIps([]); }
                          } else {
                            setHostSubnets([]);
                            setHostVmIps([]);
                          }
                        }} className="w-full px-3 py-2 border rounded-lg text-sm">
                          <option value="">-- 选择 --</option>
                          {hardwareList.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                        </select>
                      </div>
                    )}
                  </form.Field>
                )}
              </>)}
            </form.Subscribe>
            {/* 网络模式 */}
            {/* 容器：始终可独立选择容器网络模式 */}
            <form.Subscribe selector={(s) => ({ category: s.values.category, hostEntityId: s.values.metadata.host_entity_id })}>
              {({ category, hostEntityId }) => (<>
                {category === 'container' && (
                  <form.Field name="metadata.network_mode">
                    {(field) => (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">容器网络模式</label>
                        <select value={(field.state.value as string) || ''} onChange={e => handleNetworkModeChange(e.target.value as AppNetworkMode)} className="w-full px-3 py-2 border rounded-lg text-sm">
                          <option value="">-- 选择 --</option>
                          {Object.entries(CONTAINER_NETWORK_MODES).map(([k, v]) => (
                            <option key={k} value={k}>{v}{k === 'bridge' ? '（推荐）' : ''}</option>
                          ))}
                        </select>
                        {(field.state.value as string) && (
                          <p className="text-xs text-slate-500 mt-1 flex items-start gap-1">
                            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-blue-400" />
                            {CONTAINER_NETWORK_MODE_DESCRIPTIONS[field.state.value as keyof typeof CONTAINER_NETWORK_MODE_DESCRIPTIONS]}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>
                )}
                {/* 服务/应用部署在 VM 上：跟随 VM 网络模式，只读展示 */}
                {isServiceOnVm && hostEntityId && (() => {
                  const vmMode = getHostVmNetworkMode();
                  return (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">网络模式（跟随宿主 VM）</label>
                      <div className="px-3 py-2 bg-slate-50 border rounded-lg text-sm text-slate-600">
                        {vmMode ? VM_NETWORK_MODES[vmMode as keyof typeof VM_NETWORK_MODES] || vmMode : '未设置'}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">服务/应用跟随宿主 VM 的网络模式，共享 VM 的 IP 地址</p>
                    </div>
                  );
                })()}
                {/* 服务/应用部署在 Hardware 上：共享宿主硬件 IP */}
                {isServiceOnHardware && hostEntityId && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">网络模式（继承宿主硬件）</label>
                    <div className="px-3 py-2 bg-slate-50 border rounded-lg text-sm text-slate-600">
                      直接使用宿主网络
                    </div>
                    <p className="text-xs text-slate-500 mt-1">服务/应用直接运行在物理硬件上，共享宿主的 IP 地址</p>
                  </div>
                )}
              </>)}
            </form.Subscribe>
            {/* Hostname */}
            <form.Field name="metadata.hostname">
              {(field) => (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hostname</label>
                  <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="主机名" />
                </div>
              )}
            </form.Field>
            {/* Icon */}
            <form.Field name="metadata.icon">
              {(field) => (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">图标</label>
                  <IconPicker value={(field.state.value as string) || ''} onChange={v => field.handleChange(v || undefined)} />
                </div>
              )}
            </form.Field>
            {/* 备注 */}
            <form.Field name="metadata.notes">
              {(field) => (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">备注</label>
                  <textarea value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value || undefined)} className="w-full px-3 py-2 border rounded-lg text-sm" rows={3} placeholder="备注信息" />
                </div>
              )}
            </form.Field>
          </div>
        )}

        {drawerTab === 'addresses' && (
          <form.Subscribe selector={(s) => ({
            category: s.values.category,
            deployType: s.values.metadata.deploy_type,
            networkMode: s.values.metadata.network_mode,
            hostEntityId: s.values.metadata.host_entity_id,
            dockerSubnet: s.values.metadata.docker_subnet,
            portMappings: s.values.metadata.port_mappings,
            addresses: s.values.metadata.addresses,
          })}>
            {({ category, deployType, networkMode, hostEntityId, dockerSubnet, portMappings, addresses }) => (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">管理此应用的网络地址（内部 IP、端口、外部暴露端口等）</p>

            {/* ===== Docker Bridge 模式：内部IP + 端口映射 ===== */}
            {isDockerBridgeMode(category, networkMode) ? (
              <div className="space-y-4">
                {/* Docker 网络信息 */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-medium text-blue-800">Docker Bridge 网络</p>
                  <p className="text-xs text-blue-600 mt-1">子网: {dockerSubnet || DOCKER_DEFAULT_BRIDGE_SUBNET}（容器通过端口映射对外暴露服务）</p>
                </div>

                {/* 宿主 IP 展示（外部访问地址） */}
                {hostEntityId && hostVmIps.length > 0 && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">宿主外部地址</label>
                    <div className="px-3 py-2 bg-slate-50 border rounded-lg text-sm font-mono text-slate-700">
                      {hostVmIps.map(ip => ip.address).join(', ')}
                    </div>
                  </div>
                )}

                {/* Docker 内部 IP */}
                <form.Field name="metadata.docker_internal_ip">
                  {(field) => (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">容器内部 IP（可选）</label>
                      <input
                        value={(field.state.value as string) || ''}
                        onChange={e => field.handleChange(e.target.value || undefined)}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        placeholder="如 172.17.0.2（留空则由 Docker 自动分配）"
                      />
                    </div>
                  )}
                </form.Field>

                {/* 端口映射表 */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">端口映射</label>
                  {(portMappings || []).length > 0 && (
                    <div className="space-y-1 mb-3">
                      <div className="grid grid-cols-[1fr_1fr_80px_1fr_32px] gap-2 text-xs text-slate-500 px-1">
                        <span>宿主端口</span><span>容器端口</span><span>协议</span><span>描述</span><span></span>
                      </div>
                      {(portMappings || []).map(pm => (
                        <div key={pm.id} className="grid grid-cols-[1fr_1fr_80px_1fr_32px] gap-2 items-center p-2 bg-slate-50 rounded border text-sm">
                          <span className="font-mono">{pm.host_port}</span>
                          <span className="font-mono">{pm.container_port}</span>
                          <span className="text-xs text-slate-500 uppercase">{pm.protocol}</span>
                          <span className="text-xs text-slate-500 truncate">{pm.description || '-'}</span>
                          <button onClick={() => handleRemovePortMapping(pm.id)} className="p-1 hover:bg-red-50 rounded">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 添加映射表单 */}
                  <div className="grid grid-cols-[1fr_1fr_80px] gap-2">
                    <input value={newPmHostPort} onChange={e => setNewPmHostPort(e.target.value)} className="px-2 py-1.5 border rounded text-sm" placeholder="宿主端口" type="number" />
                    <input value={newPmContainerPort} onChange={e => setNewPmContainerPort(e.target.value)} className="px-2 py-1.5 border rounded text-sm" placeholder="容器端口" type="number" />
                    <select value={newPmProtocol} onChange={e => setNewPmProtocol(e.target.value as 'tcp' | 'udp' | 'both')} className="px-2 py-1.5 border rounded text-sm">
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                      <option value="both">Both</option>
                    </select>
                  </div>
                  <input value={newPmDesc} onChange={e => setNewPmDesc(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm mt-2" placeholder="描述（可选）" />
                  <button onClick={handleAddPortMapping} className="mt-2 w-full px-3 py-1.5 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                    <Plus className="w-4 h-4 inline mr-1" /> 添加端口映射
                  </button>
                </div>
              </div>

            /* ===== Docker Host 模式：共享宿主网络 ===== */
            ) : isNoIpMode(deployType, networkMode) && networkMode === 'host' ? (
              <div className="space-y-4">
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-medium text-green-800">Host 模式</p>
                  <p className="text-xs text-green-600 mt-1">容器直接使用宿主网络栈，共享宿主 IP，无需独立 IP 地址</p>
                </div>
                {/* 显示继承的宿主 IP */}
                {hostEntityId && hostVmIps.length > 0 && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">继承的宿主 IP</label>
                    <div className="px-3 py-2 bg-slate-50 border rounded-lg text-sm font-mono text-slate-700">
                      {hostVmIps.map(ip => ip.address).join(', ')}
                    </div>
                  </div>
                )}
                {/* 仅记录监听端口 */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">监听端口（容器内服务端口）</label>
                  <input value={newAddrPort} onChange={e => setNewAddrPort(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="如 80, 443" />
                </div>
              </div>

            /* ===== Docker None 模式：无网络 ===== */
            ) : isNoIpMode(deployType, networkMode) && networkMode === 'none' ? (
              <div className="p-4 bg-slate-50 border rounded-lg text-center">
                <p className="text-sm text-slate-500">容器无网络连接，无需配置 IP 或端口</p>
              </div>

            /* ===== Macvlan / 服务跟随VM / IPAM / 手动 等原有模式 ===== */
            ) : (
              <div className="space-y-4">
                {/* Macvlan 模式提示 */}
                {category === 'container' && networkMode === 'macvlan' && (
                  <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                    <p className="text-sm font-medium text-purple-800">Macvlan 模式</p>
                    <p className="text-xs text-purple-600 mt-1">容器直接获得物理网络 IP，与宿主同子网通信</p>
                  </div>
                )}

                {/* 宿主子网信息（Macvlan自动过滤到宿主子网） */}
                {category === 'container' && networkMode === 'macvlan' && hostSubnets.length > 0 && (
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">宿主可用子网</label>
                    <div className="text-xs text-slate-600 space-y-1">
                      {hostSubnets.map(s => (
                        <div key={s.id} className="px-2 py-1 bg-slate-50 rounded">{s.cidr} {s.description ? `- ${s.description}` : ''}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 已有地址列表 */}
                {(addresses || []).length > 0 && (
                  <div className="space-y-2">
                    {(addresses || []).map(addr => (
                      <div key={addr.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm">
                            {addr.use_https ? <Lock className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> : <Globe className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
                            <span className="font-mono truncate">
                              {addr.ip || '(无IP)'}
                              {addr.port ? ':' + addr.port : ''}
                            </span>
                            {addr.label && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">{addr.label}</span>}
                          </div>
                          {addr.external_ports && addr.external_ports.length > 0 && (
                            <div className="text-xs text-slate-500 mt-1 ml-5">
                              外部端口: {addr.external_ports.join(', ')}
                            </div>
                          )}
                        </div>
                        <button onClick={() => handleRemoveAddress(addr.id)} className="p-1 hover:bg-red-50 rounded ml-2">
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 新增地址表单 */}
                <div className="border-t pt-4 space-y-3">
                  <h4 className="text-sm font-medium text-slate-700">添加地址</h4>
                  {/* 标签 */}
                  <input value={newAddrLabel} onChange={e => setNewAddrLabel(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="标签（如：管理口、业务口）" />

                  {/* IP 输入区域 - 根据网络模式和部署模式切换 */}
                  {isServiceOnVm ? (
                    /* 服务/应用部署在 VM 上：从宿主 VM 已有 IP 中选择 */
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500">选择宿主 VM 的 IP 地址</label>
                      {hostVmIps.length > 0 ? (
                        <select value={newAddrIp} onChange={e => setNewAddrIp(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                          <option value="">-- 选择 VM IP --</option>
                          {hostVmIps.map(ip => (
                            <option key={ip.address} value={ip.address}>{ip.address} {ip.subnet_cidr ? `(${ip.subnet_cidr})` : ''}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-amber-600 px-3 py-2 bg-amber-50 rounded-lg">
                          {hostEntityId ? '宿主 VM 尚未分配 IP，请先在 VM 管理中分配' : '请先选择关联的虚拟机'}
                        </p>
                      )}
                    </div>
                  ) : isServiceOnHardware ? (
                    /* 服务/应用部署在 Hardware 上：继承宿主硬件的 IP */
                    <div className="space-y-2">
                      <label className="text-xs text-slate-500">选择宿主硬件的 IP 地址</label>
                      {hostVmIps.length > 0 ? (
                        <select value={newAddrIp} onChange={e => setNewAddrIp(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                          <option value="">-- 选择硬件 IP --</option>
                          {hostVmIps.map(ip => (
                            <option key={ip.address} value={ip.address}>{ip.address} {ip.subnet_cidr ? `(${ip.subnet_cidr})` : ''}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-amber-600 px-3 py-2 bg-amber-50 rounded-lg">
                          {hostEntityId ? '宿主硬件尚未分配 IP，请先在硬件设备管理中分配' : '请先选择关联的硬件设备'}
                        </p>
                      )}
                    </div>
                  ) : isIpamMode(deployType, networkMode, category) ? (
                    <div className="space-y-2">
                      <select value={newAddrSubnetId} onChange={e => { setNewAddrSubnetId(e.target.value); loadAvailableIps(e.target.value); }} className="w-full px-3 py-2 border rounded-lg text-sm">
                        <option value="">-- 选择子网 --</option>
                        {/* Macvlan 优先显示宿主子网 */}
                        {(category === 'container' && networkMode === 'macvlan' && hostSubnets.length > 0 ? hostSubnets : subnets).map(s => (
                          <option key={s.id} value={s.id}>{s.cidr} {s.description ? `(${s.description})` : ''}</option>
                        ))}
                      </select>
                      {newAddrSubnetId && (
                        <select value={newAddrIp} onChange={e => setNewAddrIp(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                          <option value="">-- 选择可用 IP --</option>
                          {availableIps.map(ip => <option key={ip.id} value={ip.address}>{ip.address}</option>)}
                        </select>
                      )}
                    </div>
                  ) : isManualIpMode(deployType, networkMode, category) ? (
                    <input value={newAddrIp} onChange={e => setNewAddrIp(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="IP 地址（手动输入）" />
                  ) : (
                    <input value={newAddrIp} onChange={e => setNewAddrIp(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="IP 地址" />
                  )}

                  {/* 内部端口 + HTTPS */}
                  <div className="flex gap-2 items-center">
                    <input value={newAddrPort} onChange={e => setNewAddrPort(e.target.value)} className="flex-1 px-3 py-2 border rounded-lg text-sm" placeholder="内部端口" type="number" />
                    <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer whitespace-nowrap">
                      <input type="checkbox" checked={newAddrHttps} onChange={e => setNewAddrHttps(e.target.checked)} className="rounded" />
                      HTTPS
                    </label>
                  </div>

                  {/* 外部端口 */}
                  <input value={newAddrExtPorts} onChange={e => setNewAddrExtPorts(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="外部端口（多个用逗号分隔，如: 80,443,8080）" />

                  <button onClick={handleAddAddress} className="w-full px-3 py-2 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
                    <Plus className="w-4 h-4 inline mr-1" /> 添加此地址
                  </button>
                </div>
              </div>
            )}
          </div>
            )}
          </form.Subscribe>
        )}
      </Drawer>
    </div>
  );
}
