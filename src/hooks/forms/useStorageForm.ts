/**
 * Storage 表单 Hook
 * 封装 @tanstack/react-form 的 useForm，提供 Storage 专用的表单实例
 */
import { useForm } from '@tanstack/react-form';
import { storageFormSchema, STORAGE_DEFAULT_VALUES, type StorageFormValues } from '../../../lib/schemas/storage';

interface UseStorageFormOpts {
  /** 当前表单默认值（新建时传 DEFAULT_VALUES，编辑时传 item 的值） */
  defaultValues?: StorageFormValues;
  /** 提交回调 */
  onSubmit: (values: StorageFormValues) => Promise<void> | void;
}

export function useStorageForm({ defaultValues, onSubmit }: UseStorageFormOpts) {
  return useForm({
    defaultValues: defaultValues ?? STORAGE_DEFAULT_VALUES,
    validators: {
      onChange: storageFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}
