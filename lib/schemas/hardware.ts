/**
 * Hardware 表单 Zod Schema
 */
import { z } from 'zod';

/** 硬件分类 */
export const hardwareCategoryEnum = z.enum([
  'switch', 'router', 'ont', 'server', 'pc', 'phone',
  'iot', 'camera', 'ap', 'ac', 'patch_panel', 'panel_ap',
]);

/** 虚拟化角色 */
export const hypervisorTypeEnum = z.enum(['kvm', 'vmware', 'hyperv', 'proxmox', 'other']);

/** 网口介质类型 */
export const mediaTypeEnum = z.enum(['ethernet', 'wifi']);

/** 网口连接器类型 */
export const connectorTypeEnum = z.enum(['rj45', 'sfp', 'sfp_plus']);

/** 网口速率 */
export const interfaceSpeedEnum = z.enum(['100M', '1G', '2.5G', '5G', '10G']);

/** Hardware metadata schema */
export const hardwareMetadataSchema = z.object({
  hostname: z.string().optional(),
  os: z.string().optional(),
  cpu: z.string().optional(),
  cpu_cores: z.number().optional(),
  ram: z.number().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  serial_number: z.string().optional(),
  location: z.string().optional(),
  icon: z.string().optional(),
  note: z.string().optional(),
  hypervisor_type: hypervisorTypeEnum.optional(),
});

/** Hardware 主表单 schema（基本信息 Tab） */
export const hardwareFormSchema = z.object({
  name: z.string().min(1, '设备名称不能为空'),
  category: hardwareCategoryEnum,
  metadata: hardwareMetadataSchema,
});

/** NIC 网口表单 schema（端口 Tab 中的添加/编辑表单） */
export const nicFormSchema = z.object({
  nic_name: z.string().min(1, '网口名称不能为空'),
  nic_index: z.number().int().min(0),
  port_index: z.number().int().min(0),
  media_type: mediaTypeEnum,
  connector_type: z.string().optional(),
  speed: z.string().optional(),
  mac_address: z.string().optional(),
  description: z.string().optional(),
});

export type HardwareFormValues = z.infer<typeof hardwareFormSchema>;
export type HardwareMetadataValues = z.infer<typeof hardwareMetadataSchema>;
export type NICFormValues = z.infer<typeof nicFormSchema>;

/** 主表单默认值 */
export const HARDWARE_DEFAULT_VALUES: HardwareFormValues = {
  name: '',
  category: 'server',
  metadata: {},
};

/** NIC 表单默认值 */
export const NIC_DEFAULT_VALUES: NICFormValues = {
  nic_name: '',
  nic_index: 0,
  port_index: 0,
  media_type: 'ethernet',
  connector_type: 'rj45',
  speed: '1G',
  mac_address: '',
  description: '',
};
