/**
 * VM 表单 Zod Schema
 */
import { z } from 'zod';

/** VM 类型 */
export const vmTypeEnum = z.enum(['kvm', 'lxc']);

/** VM 网络模式 */
export const vmNetworkModeEnum = z.enum(['bridge', 'nat', 'host-only']);

/** NAT 协议 */
export const natProtocolEnum = z.enum(['tcp', 'udp', 'both']);

/** 单条 NAT 端口映射 */
export const natMappingSchema = z.object({
  id: z.string(),
  host_port: z.number().int().min(1).max(65535),
  vm_port: z.number().int().min(1).max(65535),
  protocol: natProtocolEnum,
  description: z.string().optional(),
});

/** VM metadata schema */
export const vmMetadataSchema = z.object({
  vm_type: vmTypeEnum.optional(),
  host_id: z.string().optional(),
  hostname: z.string().optional(),
  ip_address: z.string().optional(),
  mac_address: z.string().optional(),
  os: z.string().optional(),
  cpu: z.string().optional(),
  ram: z.number().optional(),
  disk: z.number().optional(),
  icon: z.string().optional(),
  note: z.string().optional(),
  network_mode: vmNetworkModeEnum.optional(),
  nat_mappings: z.array(natMappingSchema).optional(),
  // LXC 特有字段
  template: z.string().optional(),
  unprivileged: z.boolean().optional(),
  nesting: z.boolean().optional(),
  vmid: z.number().optional(),
});

/** VM 表单完整 schema */
export const vmFormSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  metadata: vmMetadataSchema,
});

export type VMFormValues = z.infer<typeof vmFormSchema>;
export type VMMetadataValues = z.infer<typeof vmMetadataSchema>;
export type NatMappingValues = z.infer<typeof natMappingSchema>;

/** 表单默认值 */
export const VM_DEFAULT_VALUES: VMFormValues = {
  name: '',
  metadata: {
    vm_type: 'kvm',
  },
};
