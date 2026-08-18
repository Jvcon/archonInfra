/**
 * Hardware 表单 Hook
 * 封装 @tanstack/react-form 的 useForm，提供 Hardware 专用的表单实例
 *
 * 注意：NIC 网口表单使用独立的 useNICForm，不与主表单共享 isDirty
 */
import { useForm } from '@tanstack/react-form';
import {
  hardwareFormSchema,
  nicFormSchema,
  HARDWARE_DEFAULT_VALUES,
  NIC_DEFAULT_VALUES,
  type HardwareFormValues,
  type NICFormValues,
} from '../../../lib/schemas/hardware';

interface UseHardwareFormOpts {
  /** 编辑模式的初始值，为空则使用默认值（新建模式） */
  initialValues?: HardwareFormValues;
  /** 提交回调 */
  onSubmit: (values: HardwareFormValues) => Promise<void> | void;
}

/** 主表单（基本信息 Tab） */
export function useHardwareForm({ initialValues, onSubmit }: UseHardwareFormOpts) {
  return useForm({
    defaultValues: initialValues ?? HARDWARE_DEFAULT_VALUES,
    validators: {
      onChange: hardwareFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}

interface UseNICFormOpts {
  /** 编辑模式的初始值，为空则使用默认值 */
  initialValues?: NICFormValues;
  /** 提交回调 */
  onSubmit: (values: NICFormValues) => Promise<void> | void;
}

/** NIC 网口子表单（端口 Tab 中的添加/编辑表单） */
export function useNICForm({ initialValues, onSubmit }: UseNICFormOpts) {
  return useForm({
    defaultValues: initialValues ?? NIC_DEFAULT_VALUES,
    validators: {
      onChange: nicFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}
