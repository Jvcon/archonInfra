/**
 * 表单文本输入组件 - 绑定 @tanstack/react-form 字段状态
 */
import { FormField } from './FormField';

/** 字段 API 最小接口（避免与 FieldApi 的 23 个泛型参数耦合） */
interface FieldLike<T = unknown> {
  state: { value: T; meta: { errors: any[] } };
  handleChange: (value: any) => void;
  handleBlur: () => void;
}

interface FormInputProps {
  /** 字段 API */
  field: FieldLike;
  /** 字段标签 */
  label?: string;
  /** 是否必填 */
  required?: boolean;
  /** placeholder */
  placeholder?: string;
  /** 辅助说明 */
  hint?: string;
  /** input 类型 */
  type?: 'text' | 'number' | 'password' | 'email';
  /** 是否只读 */
  readOnly?: boolean;
  /** 自定义 className */
  className?: string;
}

export function FormInput({
  field,
  label,
  required,
  placeholder,
  hint,
  type = 'text',
  readOnly,
  className,
}: FormInputProps) {
  const error = field.state.meta.errors[0];

  return (
    <FormField label={label} required={required} error={error} hint={hint} className={className}>
      <input
        type={type}
        value={(field.state.value as string) ?? ''}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
          error ? 'border-red-300' : 'border-slate-200'
        } ${readOnly ? 'bg-slate-50 text-slate-600 cursor-default' : ''}`}
      />
    </FormField>
  );
}
