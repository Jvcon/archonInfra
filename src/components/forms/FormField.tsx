/**
 * 表单字段容器 - 标签 + 插槽 + 错误信息
 */
import type { ReactNode } from 'react';

interface FormFieldProps {
  /** 字段标签 */
  label?: string;
  /** 是否必填（显示红色星号） */
  required?: boolean;
  /** 错误信息 */
  error?: string;
  /** 辅助说明文字 */
  hint?: string;
  /** 子元素（input/select 等） */
  children: ReactNode;
  /** 自定义 className */
  className?: string;
}

export function FormField({ label, required, error, hint, children, className }: FormFieldProps) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      {!error && hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
