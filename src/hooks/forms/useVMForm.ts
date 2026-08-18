/**
 * VM 表单 Hook
 * 封装 @tanstack/react-form 的 useForm，提供 VM 专用的表单实例
 */
import { useForm } from '@tanstack/react-form';
import { vmFormSchema, VM_DEFAULT_VALUES, type VMFormValues } from '../../../lib/schemas/vm';

interface UseVMFormOpts {
  /** 编辑模式的初始值，为空则使用默认值（新建模式） */
  initialValues?: VMFormValues;
  /** 提交回调 */
  onSubmit: (values: VMFormValues) => Promise<void> | void;
}

export function useVMForm({ initialValues, onSubmit }: UseVMFormOpts) {
  return useForm({
    defaultValues: initialValues ?? VM_DEFAULT_VALUES,
    validators: {
      onChange: vmFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}
