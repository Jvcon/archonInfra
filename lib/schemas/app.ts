/**
 * App 表单 Zod Schema
 */
import { z } from 'zod';

/** 应用分类 */
export const appCategoryEnum = z.enum(['container', 'service', 'application']);

/** 部署类型 */
export const deployTypeEnum = z.enum(['standalone', 'vm', 'hardware']);

/** 应用网络模式（VM + Container 模式合并） */
export const appNetworkModeEnum = z.enum(['bridge', 'nat', 'host-only', 'host', 'macvlan', 'none']);

/** Docker 端口映射协议 */
export const portMappingProtocolEnum = z.enum(['tcp', 'udp', 'both']);

/** Docker 端口映射 */
export const dockerPortMappingSchema = z.object({
  id: z.string(),
  host_port: z.number().int().min(1).max(65535),
  container_port: z.number().int().min(1).max(65535),
  protocol: portMappingProtocolEnum,
  description: z.string().optional(),
});

/** 应用地址记录 */
export const appAddressSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  ip: z.string().optional(),
  subnet_id: z.string().optional(),
  ip_address_id: z.string().optional(),
  port: z.number().int().optional(),
  use_https: z.boolean().optional(),
  external_ports: z.array(z.number().int()).optional(),
});

/** App metadata schema */
export const appMetadataSchema = z.object({
  deploy_type: deployTypeEnum.optional(),
  host_entity_id: z.string().optional(),
  network_mode: appNetworkModeEnum.optional(),
  hostname: z.string().optional(),
  icon: z.string().optional(),
  notes: z.string().optional(),
  addresses: z.array(appAddressSchema).optional(),
  docker_internal_ip: z.string().optional(),
  docker_subnet: z.string().optional(),
  port_mappings: z.array(dockerPortMappingSchema).optional(),
});

/** App 表单完整 schema */
export const appFormSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  category: appCategoryEnum,
  metadata: appMetadataSchema,
});

export type AppFormValues = z.infer<typeof appFormSchema>;
export type AppMetadataValues = z.infer<typeof appMetadataSchema>;
export type AppAddressValues = z.infer<typeof appAddressSchema>;
export type DockerPortMappingValues = z.infer<typeof dockerPortMappingSchema>;

/** 表单默认值 */
export const APP_DEFAULT_VALUES: AppFormValues = {
  name: '',
  category: 'service',
  metadata: {},
};
