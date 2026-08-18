/**
 * Network 表单 Zod Schema
 * 包含 3 个独立表单：创建网络、添加子网、分配 IP
 */
import { z } from 'zod';
import { cidrString, optionalIP } from './base';

/** 创建网络表单（VLAN + 子网联合创建） */
export const createNetworkFormSchema = z.object({
  vlan_id: z.string().min(1, 'VLAN ID 不能为空')
    .refine((v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 4094; }, { message: 'VLAN ID 范围 1-4094' }),
  vlan_name: z.string().min(1, 'VLAN 名称不能为空'),
  cidr: cidrString,
  gateway: optionalIP,
  entity_id: z.string().optional(),
  description: z.string().optional(),
});

/** 添加子网表单（向已有 VLAN 添加子网） */
export const addSubnetFormSchema = z.object({
  cidr: cidrString,
  gateway: optionalIP,
  entity_id: z.string().optional(),
  description: z.string().optional(),
});

/** 分配 IP 表单 */
export const assignIPFormSchema = z.object({
  ip: z.string().min(1, 'IP 地址不能为空'),
  description: z.string().optional(),
});

export type CreateNetworkFormValues = z.infer<typeof createNetworkFormSchema>;
export type AddSubnetFormValues = z.infer<typeof addSubnetFormSchema>;
export type AssignIPFormValues = z.infer<typeof assignIPFormSchema>;

/** 默认值 */
export const CREATE_NETWORK_DEFAULT_VALUES: CreateNetworkFormValues = {
  vlan_id: '',
  vlan_name: '',
  cidr: '',
  gateway: '',
  entity_id: '',
  description: '',
};

export const ADD_SUBNET_DEFAULT_VALUES: AddSubnetFormValues = {
  cidr: '',
  gateway: '',
  entity_id: '',
  description: '',
};

export const ASSIGN_IP_DEFAULT_VALUES: AssignIPFormValues = {
  ip: '',
  description: '',
};
