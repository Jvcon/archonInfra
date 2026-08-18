/**
 * Storage 表单 Hook
 * 封装 @tanstack/react-form 的 useForm，提供 Storage 专用的表单实例
 */
import { useForm } from '@tanstack/react-form';
import { storageFormSchema, STORAGE_DEFAULT_VALUES, type StorageFormValues } from '../../../lib/schemas/storage';

interface UseStorageFormOpts {
  /** 编辑模式的初始值，为空则使用默认值（新建模式） */
  initialValues?: StorageFormValues;
  /** 提交回调 */
  onSubmit: (values: StorageFormValues) => Promise<void> | void;
}

export function useStorageForm({ initialValues, onSubmit }: UseStorageFormOpts) {
  return useForm({
    defaultValues: initialValues ?? STORAGE_DEFAULT_VALUES,
    validators: {
      onChange: storageFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}
