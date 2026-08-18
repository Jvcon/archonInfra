/**
 * App 表单 Hook
 * 封装 @tanstack/react-form 的 useForm，提供 App 专用的表单实例
 */
import { useForm } from '@tanstack/react-form';
import { appFormSchema, APP_DEFAULT_VALUES, type AppFormValues } from '../../../lib/schemas/app';

interface UseAppFormOpts {
  /** 编辑模式的初始值，为空则使用默认值（新建模式） */
  initialValues?: AppFormValues;
  /** 提交回调 */
  onSubmit: (values: AppFormValues) => Promise<void> | void;
}

export function useAppForm({ initialValues, onSubmit }: UseAppFormOpts) {
  return useForm({
    defaultValues: initialValues ?? APP_DEFAULT_VALUES,
    validators: {
      onChange: appFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}
