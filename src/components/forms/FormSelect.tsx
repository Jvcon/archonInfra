/**
 * 表单下拉选择组件 - 绑定 @tanstack/react-form 字段状态
 */
import { FormField } from './FormField';

/** 字段 API 最小接口 */
interface FieldLike<T = unknown> {
  state: { value: T; meta: { errors: any[] } };
  handleChange: (value: any) => void;
  handleBlur: () => void;
}

interface Option {
  value: string;
  label: string;
}

interface FormSelectProps {
  /** 字段 API */
  field: FieldLike;
  /** 字段标签 */
  label?: string;
  /** 是否必填 */
  required?: boolean;
  /** 选项列表 */
  options: Option[];
  /** 辅助说明 */
  hint?: string;
  /** placeholder（空选项文案） */
  placeholder?: string;
  /** 自定义 className */
  className?: string;
}

export function FormSelect({
  field,
  label,
  required,
  options,
  hint,
  placeholder = '请选择',
  className,
}: FormSelectProps) {
  const error = field.state.meta.errors[0];

  return (
    <FormField label={label} required={required} error={error} hint={hint} className={className}>
      <select
        value={(field.state.value as string) ?? ''}
        onChange={(e) => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        className={`w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
          error ? 'border-red-300' : 'border-slate-200'
        }`}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
