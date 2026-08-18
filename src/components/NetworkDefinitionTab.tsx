/**
 * 网络定义 Tab — 合并 VLAN + 子网 + IPAM 为联合视图
 * 支持一步创建网络，展开行查看 IP 分配
 */
import { useState, useEffect, useCallback } from 'react';
import { useStorageDriver } from '../hooks/useStorage';
import { Modal } from './Modal';
import { FormInput } from './forms/FormInput';
import { FormField } from './forms/FormField';
import { useCreateNetworkForm, useAddSubnetForm, useAssignIPForm } from '../hooks/forms/useNetworkForm';
import type { CreateNetworkFormValues, AddSubnetFormValues, AssignIPFormValues } from '../../lib/schemas/network';
import { CREATE_NETWORK_DEFAULT_VALUES, ADD_SUBNET_DEFAULT_VALUES, ASSIGN_IP_DEFAULT_VALUES } from '../../lib/schemas/network';
import { isValidCIDR, getHostRange, suggestGateway, validateGateway } from '../../lib/ip-utils';
import { Plus, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import type { Entity, Subnet } from '../types';
import { simpleFeatures, createColumnHelper, flexRender, useTable } from '../../lib/table';
import type { SimpleFeatures } from '../../lib/table';
import type { ColumnDef } from '@tanstack/react-table';

interface SubnetDevice {
  id: string;
  name: string;
  category: string;
  ips: string[];
}

interface NetworkOverviewItem {
  vlan: { id: number; name: string; description: string; zone_name: string | null };
  subnets: Array<Subnet & { entity_name: string | null; ip_total: number; ip_assigned: number; ip_available: number }>;
  unassociated_devices?: Array<{ id: string; name: string; category: string }>;
}

interface Props {
  showToast: (msg: string, type: 'success' | 'error') => void;
}

const subnetDeviceColumnHelper = createColumnHelper<SimpleFeatures, SubnetDevice>();

export function NetworkDefinitionTab({ showToast }: Props) {
  const driver = useStorageDriver();
  const [networks, setNetworks] = useState<NetworkOverviewItem[]>([]);
  const [expandedVlan, setExpandedVlan] = useState<number | null>(null);
  const [expandedSubnet, setExpandedSubnet] = useState<string | null>(null);

  // 联合创建表单
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [devices, setDevices] = useState<Entity[]>([]);

  // 单独添加子网
  const [showSubnetForm, setShowSubnetForm] = useState(false);
  const [subnetTargetVlan, setSubnetTargetVlan] = useState<number | null>(null);

  // 子网设备列表
  const [subnetDevices, setSubnetDevices] = useState<SubnetDevice[]>([]);
  const [nextAvailableIP, setNextAvailableIP] = useState<string | null>(null);

  // 分配 IP 弹窗
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ deviceId: string; deviceName: string; subnetId: string } | null>(null);

  const loadOverview = useCallback(async () => {
    const vlans = await driver.getVlans();
    const subnets = await driver.getSubnets();
    const ipAddrs = await driver.getIPAddresses();
    const entities = await driver.getEntities();

    // 聚合数据：按 VLAN 组织子网和 IP 使用率
    const networks = vlans.map(vlan => ({
      vlan: { id: vlan.id, name: vlan.name, description: vlan.description || '', zone_name: null },
      subnets: subnets
        .filter(s => s.vlan_id === vlan.id)
        .map(subnet => {
          const subnetIPs = ipAddrs.filter(ip => ip.subnet_id === subnet.id);
          const entity = entities.data.find(e => e.id === subnet.entity_id);
          const cidrParts = subnet.cidr.split('/');
          const mask = cidrParts.length > 1 ? parseInt(cidrParts[1]!, 10) : 24;
          return {
            ...subnet,
            entity_name: entity?.name || null,
            ip_total: Math.pow(2, 32 - mask) - 2,
            ip_assigned: subnetIPs.length,
            ip_available: Math.pow(2, 32 - mask) - 2 - subnetIPs.length,
          };
        }),
      unassociated_devices: [],
    }));
    setNetworks(networks);
  }, [driver]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const loadDevices = async () => {
    const routers = await driver.getEntities({ type: 'hardware', category: 'router' });
    const switches = await driver.getEntities({ type: 'hardware', category: 'switch' });
    setDevices([...routers.data, ...switches.data]);
  };

  // 表单提交处理
  const handleCreateSubmit = useCallback(async (values: CreateNetworkFormValues) => {
    try {
      const vlanId = parseInt(values.vlan_id);
      const vlan: any = { id: vlanId, name: values.vlan_name, description: values.description };
      await driver.saveVlan(vlan);

      const subnet: any = {
        id: crypto.randomUUID(),
        vlan_id: vlanId,
        cidr: values.cidr,
        gateway: values.gateway || '',
        entity_id: values.entity_id || undefined,
        description: values.description,
      };
      await driver.saveSubnet(subnet);

      showToast('网络创建成功', 'success');
      setShowCreateForm(false);
      createForm.reset(CREATE_NETWORK_DEFAULT_VALUES);
      loadOverview();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '创建失败', 'error');
    }
  }, [driver, showToast, loadOverview]);

  const handleAddSubnetSubmit = useCallback(async (values: AddSubnetFormValues) => {
    if (subnetTargetVlan === null) { showToast('未选择目标 VLAN', 'error'); return; }
    try {
      const subnet: any = {
        id: crypto.randomUUID(),
        vlan_id: subnetTargetVlan,
        cidr: values.cidr,
        gateway: values.gateway || '',
        entity_id: values.entity_id || undefined,
        description: values.description,
      };
      await driver.saveSubnet(subnet);
      showToast('子网添加成功', 'success');
      setShowSubnetForm(false);
      subnetForm.reset(ADD_SUBNET_DEFAULT_VALUES);
      loadOverview();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '创建失败', 'error');
    }
  }, [subnetTargetVlan, driver, showToast, loadOverview]);

  const handleAssignSubmit = useCallback(async (values: AssignIPFormValues) => {
    if (!assignTarget) { showToast('无目标设备', 'error'); return; }
    try {
      const ipAddress: any = {
        id: crypto.randomUUID(),
        subnet_id: assignTarget.subnetId,
        entity_id: assignTarget.deviceId,
        address: values.ip,
        description: values.description,
        status: 'assigned',
      };
      await driver.saveIPAddress(ipAddress);
      showToast('IP 分配成功', 'success');
      setShowAssignModal(false);
      assignForm.reset(ASSIGN_IP_DEFAULT_VALUES);
      loadSubnetDevices(assignTarget.subnetId);
      loadOverview();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '分配失败', 'error');
    }
  }, [assignTarget, driver, showToast, loadOverview]);

  const createForm = useCreateNetworkForm({ onSubmit: handleCreateSubmit });
  const subnetForm = useAddSubnetForm({ onSubmit: handleAddSubnetSubmit });
  const assignForm = useAssignIPForm({ onSubmit: handleAssignSubmit });

  // 展开子网加载设备列表
  const toggleSubnet = async (subnetId: string) => {
    if (expandedSubnet === subnetId) { setExpandedSubnet(null); return; }
    setExpandedSubnet(subnetId);
    loadSubnetDevices(subnetId);
  };

  const loadSubnetDevices = async (subnetId: string) => {
    const ipAddrs = await driver.getIPAddresses({ subnet_id: subnetId });
    const entities = await driver.getEntities();

    // 聚合设备及其 IP
    const deviceMap = new Map<string, SubnetDevice>();
    for (const ip of ipAddrs) {
      if (ip.entity_id) {
        if (!deviceMap.has(ip.entity_id)) {
          const entity = entities.data.find(e => e.id === ip.entity_id);
          deviceMap.set(ip.entity_id, {
            id: ip.entity_id,
            name: entity?.name || 'Unknown',
            category: entity?.category || '',
            ips: [],
          });
        }
        const device = deviceMap.get(ip.entity_id)!;
        device.ips.push(ip.address);
      }
    }

    setSubnetDevices(Array.from(deviceMap.values()));
    // 简单估计下一个可用 IP（第一个 IP + 已分配数量）
    const subnet = networks.flatMap(n => n.subnets).find(s => s.id === subnetId);
    if (subnet?.cidr) {
      const range = getHostRange(subnet.cidr);
      if (range && ipAddrs.length < range.total) {
        setNextAvailableIP(ipAddrs.length > 0 ? null : range.first);
      }
    }
  };

  // 释放 IP
  const handleReleaseIP = async (address: string, subnetId: string) => {
    if (!confirm(`确定释放 IP ${address}？`)) return;
    try {
      const ipAddrs = await driver.getIPAddresses({ subnet_id: subnetId });
      const ipToDelete = ipAddrs.find(ip => ip.address === address);
      if (ipToDelete) {
        await driver.deleteIPAddress(ipToDelete.id);
      }
      showToast('已释放', 'success');
      loadSubnetDevices(subnetId);
      loadOverview();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '释放失败', 'error');
    }
  };

  // 删除 VLAN
  const handleDeleteVlan = async (vlanId: number) => {
    if (!confirm('确定删除该 VLAN？关联的端口和 SSID 配置将解除绑定。')) return;
    try {
      await driver.deleteVlan(vlanId);
      showToast('已删除', 'success');
      loadOverview();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败', 'error');
    }
  };

  // 删除子网
  const handleDeleteSubnet = async (subnetId: string) => {
    if (!confirm('确定删除该子网？子网下的 IP 记录将一并删除。')) return;
    try {
      const ipAddrs = await driver.getIPAddresses({ subnet_id: subnetId });
      for (const ip of ipAddrs) {
        await driver.deleteIPAddress(ip.id);
      }
      await driver.deleteSubnet(subnetId);
      showToast('已删除', 'success');
      loadOverview();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败', 'error');
    }
  };

  // CIDR 实时提示
  const cidrHint = (cidr: string) => {
    if (!cidr) return null;
    if (!isValidCIDR(cidr)) return <span className="text-red-500 text-xs">CIDR 格式不合法（如 192.168.1.0/24）</span>;
    const range = getHostRange(cidr);
    if (!range) return null;
    return <span className="text-green-600 text-xs">可用: {range.first} - {range.last}（共 {range.total} 个地址）</span>;
  };

  // 网关实时校验
  const gwHint = (gw: string, cidr: string) => {
    if (!gw || !cidr || !isValidCIDR(cidr)) return null;
    const result = validateGateway(gw, cidr);
    if (!result.valid) return <span className="text-red-500 text-xs">{result.error}</span>;
    return <span className="text-green-600 text-xs">✓ 合法</span>;
  };

  // 子网设备表格列定义（使用 expandedSubnet 捕获当前子网 ID）
  const subnetDeviceColumns = [
    subnetDeviceColumnHelper.accessor('name', {
      header: '设备',
      cell: ({ getValue }) => <span className="font-medium text-slate-700">{getValue()}</span>,
    }),
    subnetDeviceColumnHelper.accessor('category', {
      header: '类型',
      cell: ({ getValue }) => (
        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">{getValue()}</span>
      ),
    }),
    subnetDeviceColumnHelper.display({
      id: 'ips',
      header: '已分配 IP',
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.ips.length > 0 ? row.original.ips.map(ip => (
            <span key={ip} className="inline-flex items-center gap-1 mr-2">
              <span className="text-green-700">{ip}</span>
              <button onClick={() => expandedSubnet && handleReleaseIP(ip, expandedSubnet)} className="text-red-400 hover:text-red-600" title="释放">×</button>
            </span>
          )) : <span className="text-slate-400">—</span>}
        </span>
      ),
    }),
    subnetDeviceColumnHelper.display({
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <button
          onClick={() => {
            if (!expandedSubnet) return;
            setAssignTarget({ deviceId: row.original.id, deviceName: row.original.name, subnetId: expandedSubnet });
            assignForm.reset({ ip: nextAvailableIP || '', description: '' });
            setShowAssignModal(true);
          }}
          className="px-2 py-0.5 text-blue-600 hover:bg-blue-50 rounded text-[11px]"
        >分配 IP</button>
      ),
    }),
  ] as ColumnDef<SimpleFeatures, SubnetDevice>[];

  const subnetDeviceTable = useTable({ features: simpleFeatures, columns: subnetDeviceColumns, data: subnetDevices });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-slate-500">VLAN + 子网 + IP 地址联合管理</p>
        <button onClick={() => { setShowCreateForm(true); loadDevices(); }} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Plus className="w-4 h-4" /> 创建网络
        </button>
      </div>

      {/* 网络列表 */}
      <div className="space-y-2">
        {networks.map(net => (
          <div key={net.vlan.id} className="bg-white border rounded-xl overflow-hidden">
            {/* VLAN 行 */}
            <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100" onClick={() => setExpandedVlan(expandedVlan === net.vlan.id ? null : net.vlan.id)}>
              {expandedVlan === net.vlan.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              <span className="font-mono text-sm font-medium text-blue-700">VLAN {net.vlan.id}</span>
              <span className="font-medium text-slate-800">{net.vlan.name}</span>
              {net.vlan.zone_name && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs">{net.vlan.zone_name}</span>}
              <span className="text-xs text-slate-400 ml-auto">{net.subnets.length} 个子网</span>
              {net.vlan.id !== 0 && (
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                  <button onClick={() => { setSubnetTargetVlan(net.vlan.id); setShowSubnetForm(true); loadDevices(); }} className="p-1 hover:bg-blue-50 rounded" title="添加子网"><Plus className="w-3.5 h-3.5 text-blue-500" /></button>
                  <button onClick={() => handleDeleteVlan(net.vlan.id)} className="p-1 hover:bg-red-50 rounded" title="删除"><Trash2 className="w-3.5 h-3.5 text-red-500" /></button>
                </div>
              )}
            </div>

            {/* 子网列表（展开） */}
            {expandedVlan === net.vlan.id && (
              <div className="divide-y divide-slate-100">
                {net.subnets.length === 0 && !net.unassociated_devices?.length && <div className="px-6 py-3 text-sm text-slate-400">暂无子网</div>}
                {net.subnets.map(subnet => (
                  <div key={subnet.id}>
                    <div className="flex items-center gap-3 px-6 py-2.5 hover:bg-slate-50 cursor-pointer" onClick={() => toggleSubnet(subnet.id)}>
                      {expandedSubnet === subnet.id ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                      <span className="font-mono text-sm">{subnet.cidr}</span>
                      <span className="text-xs text-slate-500">网关: {subnet.gateway || '-'}</span>
                      {subnet.entity_name && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px]">{subnet.entity_name}</span>}
                      {/* IP 使用率 */}
                      <div className="ml-auto flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${subnet.ip_total > 0 ? (subnet.ip_assigned / subnet.ip_total) * 100 : 0}%` }}></div>
                        </div>
                        <span className="text-xs text-slate-500">{subnet.ip_assigned}/{subnet.ip_total}</span>
                        <button onClick={e => { e.stopPropagation(); handleDeleteSubnet(subnet.id); }} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-3 h-3 text-red-400" /></button>
                      </div>
                    </div>

                    {/* 设备列表（展开） */}
                    {expandedSubnet === subnet.id && (
                      <div className="px-8 py-2 bg-slate-50/50 border-t">
                        {subnetDevices.length > 0 ? (
                          <table className="w-full text-xs">
                            <thead>
                              {subnetDeviceTable.getHeaderGroups().map(hg => (
                                <tr key={hg.id} className="text-slate-500">
                                  {hg.headers.map(header => (
                                    <th key={header.id} className="text-left py-1">
                                      {flexRender(header.column.columnDef.header, header.getContext())}
                                    </th>
                                  ))}
                                </tr>
                              ))}
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {subnetDeviceTable.getRowModel().rows.map(row => (
                                <tr key={row.id} className="hover:bg-white">
                                  {row.getAllCells().map(cell => (
                                    <td key={cell.id} className="py-1.5">
                                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : <p className="text-xs text-slate-400 py-2">暂无关联设备</p>}
                      </div>
                    )}
                  </div>
                ))}
                {/* 未归属 VLAN 的设备 */}
                {net.unassociated_devices && net.unassociated_devices.length > 0 && (
                  <div className="px-6 py-3 border-t border-slate-100">
                    <p className="text-xs font-medium text-slate-500 mb-2">未归属 VLAN 的设备（{net.unassociated_devices.length}）</p>
                    <div className="flex flex-wrap gap-2">
                      {net.unassociated_devices.map(dev => (
                        <span key={dev.id} className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded text-xs">
                          {dev.name}
                          <span className="text-[10px] text-amber-500">({dev.category})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {networks.length === 0 && <div className="text-center text-slate-400 py-8">暂无网络定义，点击"创建网络"开始</div>}
      </div>

      {/* 联合创建表单 */}
      <Modal open={showCreateForm} onClose={() => { createForm.reset(CREATE_NETWORK_DEFAULT_VALUES); setShowCreateForm(false); }} title="创建网络（VLAN + 子网）">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <createForm.Field name="vlan_id">
              {(field) => (
                <FormInput field={field} label="VLAN ID" required placeholder="1-4094" type="number" />
              )}
            </createForm.Field>
            <createForm.Field name="vlan_name">
              {(field) => (
                <FormInput field={field} label="VLAN 名称" required placeholder="如：办公网" />
              )}
            </createForm.Field>
          </div>
          <createForm.Field name="cidr">
            {(field) => (
              <div>
                <FormInput field={field} label="子网 CIDR" required placeholder="192.168.1.0/24" />
                <div className="mt-1">{cidrHint(field.state.value as string)}</div>
              </div>
            )}
          </createForm.Field>
          <createForm.Subscribe selector={(s) => s.values.cidr}>
            {(cidr) => (
              <createForm.Field name="gateway">
                {(field) => {
                  const gwError = field.state.meta.errors[0] as string | undefined;
                  return (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">网关 IP {!(field.state.value as string) && cidr && isValidCIDR(cidr) && <span className="text-slate-400 text-xs ml-1">建议: {suggestGateway(cidr)}</span>}</label>
                      <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value)} className={`w-full px-3 py-2 border rounded-lg text-sm ${gwError ? 'border-red-300' : ''}`} placeholder={cidr && isValidCIDR(cidr) ? suggestGateway(cidr) || '' : '192.168.1.1'} />
                      {gwError && <p className="text-xs text-red-500 mt-1">{gwError}</p>}
                      <div className="mt-1">{gwHint(field.state.value as string, cidr)}</div>
                    </div>
                  );
                }}
              </createForm.Field>
            )}
          </createForm.Subscribe>
          <createForm.Field name="entity_id">
            {(field) => (
              <FormField label="网关设备">
                <select value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="">未指定</option>
                  {devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.category})</option>)}
                </select>
              </FormField>
            )}
          </createForm.Field>
          <createForm.Field name="description">
            {(field) => (
              <FormInput field={field} label="描述" placeholder="网络用途说明" />
            )}
          </createForm.Field>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { createForm.reset(CREATE_NETWORK_DEFAULT_VALUES); setShowCreateForm(false); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
            <button onClick={() => createForm.handleSubmit()} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">创建</button>
          </div>
        </div>
      </Modal>

      {/* 添加子网表单 */}
      <Modal open={showSubnetForm} onClose={() => { subnetForm.reset(ADD_SUBNET_DEFAULT_VALUES); setShowSubnetForm(false); }} title={`为 VLAN ${subnetTargetVlan} 添加子网`}>
        <div className="space-y-4">
          <subnetForm.Field name="cidr">
            {(field) => (
              <div>
                <FormInput field={field} label="子网 CIDR" required placeholder="10.0.20.0/24" />
                <div className="mt-1">{cidrHint(field.state.value as string)}</div>
              </div>
            )}
          </subnetForm.Field>
          <subnetForm.Subscribe selector={(s) => s.values.cidr}>
            {(cidr) => (
              <subnetForm.Field name="gateway">
                {(field) => {
                  const gwError = field.state.meta.errors[0] as string | undefined;
                  return (
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">网关 IP</label>
                      <input value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value)} className={`w-full px-3 py-2 border rounded-lg text-sm ${gwError ? 'border-red-300' : ''}`} placeholder={cidr && isValidCIDR(cidr) ? suggestGateway(cidr) || '' : ''} />
                      {gwError && <p className="text-xs text-red-500 mt-1">{gwError}</p>}
                      <div className="mt-1">{gwHint(field.state.value as string, cidr)}</div>
                    </div>
                  );
                }}
              </subnetForm.Field>
            )}
          </subnetForm.Subscribe>
          <subnetForm.Field name="entity_id">
            {(field) => (
              <FormField label="网关设备">
                <select value={(field.state.value as string) || ''} onChange={e => field.handleChange(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="">未指定</option>
                  {devices.map(d => <option key={d.id} value={d.id}>{d.name} ({d.category})</option>)}
                </select>
              </FormField>
            )}
          </subnetForm.Field>
          <subnetForm.Field name="description">
            {(field) => (
              <FormInput field={field} label="描述" />
            )}
          </subnetForm.Field>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { subnetForm.reset(ADD_SUBNET_DEFAULT_VALUES); setShowSubnetForm(false); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
            <button onClick={() => subnetForm.handleSubmit()} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">添加</button>
          </div>
        </div>
      </Modal>

      {/* 分配 IP 弹窗 */}
      <Modal open={showAssignModal} onClose={() => { assignForm.reset(ASSIGN_IP_DEFAULT_VALUES); setShowAssignModal(false); }} title={`为 ${assignTarget?.deviceName || ''} 分配 IP`}>
        <div className="space-y-4">
          <assignForm.Field name="ip">
            {(field) => (
              <div>
                <FormInput field={field} label="IP 地址" required placeholder="如 192.168.1.10" />
                {nextAvailableIP && <p className="text-xs text-slate-400 mt-1">下一个可用: {nextAvailableIP}</p>}
              </div>
            )}
          </assignForm.Field>
          <assignForm.Field name="description">
            {(field) => (
              <FormInput field={field} label="描述" placeholder="用途说明（可选）" />
            )}
          </assignForm.Field>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { assignForm.reset(ASSIGN_IP_DEFAULT_VALUES); setShowAssignModal(false); }} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
            <button onClick={() => assignForm.handleSubmit()} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">分配</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
