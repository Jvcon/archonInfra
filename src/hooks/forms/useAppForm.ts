/**
 * App 表单 Hook
 * 封装 @tanstack/react-form 的 useForm，提供 App 专用的表单实例
 */
import { useForm } from '@tanstack/react-form';
import { appFormSchema, APP_DEFAULT_VALUES, type AppFormValues } from '../../../lib/schemas/app';

interface UseAppFormOpts {
  /** 当前表单默认值（新建时传 DEFAULT_VALUES，编辑时传 item 的值） */
  defaultValues?: AppFormValues;
  /** 提交回调 */
  onSubmit: (values: AppFormValues) => Promise<void> | void;
}

export function useAppForm({ defaultValues, onSubmit }: UseAppFormOpts) {
  return useForm({
    defaultValues: defaultValues ?? APP_DEFAULT_VALUES,
    validators: {
      onChange: appFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}
