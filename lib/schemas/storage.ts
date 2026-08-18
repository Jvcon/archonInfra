/**
 * Storage 表单 Zod Schema
 */
import { z } from 'zod';

/** 部署类型 */
export const deployTypeEnum = z.enum(['standalone', 'vm', 'hardware']);

/** 存储分类 */
export const storageCatEnum = z.enum(['nas', 'san', 'disk']);

/** 分享协议类型 */
export const shareTypeEnum = z.enum(['NFS', 'SMB', 'iSCSI', 'FTP', 'SFTP', 'WebDav', 'Other']);

/** 单条分享记录 */
export const shareEntrySchema = z.object({
  id: z.string(),
  type: shareTypeEnum,
  name: z.string().min(1, '分享名称不能为空'),
  notes: z.string().optional(),
});

/** Storage metadata schema */
export const storageMetadataSchema = z.object({
  deploy_type: deployTypeEnum.optional(),
  host_entity_id: z.string().optional(),
  storage_type: z.string().optional(),
  raid_type: z.string().optional(),
  drive_count: z.number().optional(),
  raw_space: z.string().optional(),
  usable_space: z.string().optional(),
  file_system: z.string().optional(),
  icon: z.string().optional(),
  note: z.string().optional(),
  shares: z.array(shareEntrySchema).optional(),
});

/** Storage 表单完整 schema */
export const storageFormSchema = z.object({
  name: z.string().min(1, '存储名称不能为空'),
  category: storageCatEnum,
  metadata: storageMetadataSchema,
});

export type StorageFormValues = z.infer<typeof storageFormSchema>;
export type ShareEntryValues = z.infer<typeof shareEntrySchema>;
export type StorageMetadataValues = z.infer<typeof storageMetadataSchema>;

/** 表单默认值 */
export const STORAGE_DEFAULT_VALUES: StorageFormValues = {
  name: '',
  category: 'nas',
  metadata: {
    shares: [],
  },
};
