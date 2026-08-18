/**
 * Hardware 表单 Hook
 * 封装 @tanstack/react-form 的 useForm，提供 Hardware 专用的表单实例
 */
import { useForm } from '@tanstack/react-form';
import {
  hardwareFormSchema,
  HARDWARE_DEFAULT_VALUES,
  type HardwareFormValues,
} from '../../../lib/schemas/hardware';

interface UseHardwareFormOpts {
  /** 当前表单默认值（新建时传 DEFAULT_VALUES，编辑时传 item 的值） */
  defaultValues?: HardwareFormValues;
  /** 提交回调 */
  onSubmit: (values: HardwareFormValues) => Promise<void> | void;
}

/** 主表单（基本信息 Tab） */
export function useHardwareForm({ defaultValues, onSubmit }: UseHardwareFormOpts) {
  return useForm({
    defaultValues: defaultValues ?? HARDWARE_DEFAULT_VALUES,
    validators: {
      onChange: hardwareFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}
