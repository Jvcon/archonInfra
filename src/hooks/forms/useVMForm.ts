/**
 * VM 表单 Hook
 * 封装 @tanstack/react-form 的 useForm，提供 VM 专用的表单实例
 */
import { useForm } from '@tanstack/react-form';
import { vmFormSchema, VM_DEFAULT_VALUES, type VMFormValues } from '../../../lib/schemas/vm';

interface UseVMFormOpts {
  /** 当前表单默认值（新建时传 DEFAULT_VALUES，编辑时传 item 的值） */
  defaultValues?: VMFormValues;
  /** 提交回调 */
  onSubmit: (values: VMFormValues) => Promise<void> | void;
}

export function useVMForm({ defaultValues, onSubmit }: UseVMFormOpts) {
  return useForm({
    defaultValues: defaultValues ?? VM_DEFAULT_VALUES,
    validators: {
      onChange: vmFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}
