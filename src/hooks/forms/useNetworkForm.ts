/**
 * Network 表单 Hooks
 * 3 个独立表单实例：创建网络、添加子网、分配 IP
 */
import { useForm } from '@tanstack/react-form';
import {
  createNetworkFormSchema,
  addSubnetFormSchema,
  assignIPFormSchema,
  CREATE_NETWORK_DEFAULT_VALUES,
  ADD_SUBNET_DEFAULT_VALUES,
  ASSIGN_IP_DEFAULT_VALUES,
  type CreateNetworkFormValues,
  type AddSubnetFormValues,
  type AssignIPFormValues,
} from '../../../lib/schemas/network';

interface UseCreateNetworkFormOpts {
  onSubmit: (values: CreateNetworkFormValues) => Promise<void> | void;
}

/** 创建网络表单（VLAN + 子网联合创建） */
export function useCreateNetworkForm({ onSubmit }: UseCreateNetworkFormOpts) {
  return useForm({
    defaultValues: CREATE_NETWORK_DEFAULT_VALUES,
    validators: {
      onChange: createNetworkFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}

interface UseAddSubnetFormOpts {
  onSubmit: (values: AddSubnetFormValues) => Promise<void> | void;
}

/** 添加子网表单（向已有 VLAN 添加子网） */
export function useAddSubnetForm({ onSubmit }: UseAddSubnetFormOpts) {
  return useForm({
    defaultValues: ADD_SUBNET_DEFAULT_VALUES,
    validators: {
      onChange: addSubnetFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}

interface UseAssignIPFormOpts {
  onSubmit: (values: AssignIPFormValues) => Promise<void> | void;
}

/** 分配 IP 表单 */
export function useAssignIPForm({ onSubmit }: UseAssignIPFormOpts) {
  return useForm({
    defaultValues: ASSIGN_IP_DEFAULT_VALUES,
    validators: {
      onChange: assignIPFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });
}
