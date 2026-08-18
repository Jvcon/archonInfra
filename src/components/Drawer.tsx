/** 侧滑抽屉组件 */
import { type ReactNode, useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** 关闭前回调，返回 false 阻止关闭（用于未保存提示） */
  onBeforeClose?: () => boolean;
}

/** 确认放弃修改弹窗 */
function ConfirmDiscardDialog({ open, onConfirm, onCancel }: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-lg shadow-xl p-6 w-90 max-w-[90vw]">
        <h4 className="text-base font-semibold text-slate-800 mb-2">放弃修改？</h4>
        <p className="text-sm text-slate-500 mb-5">当前有未保存的修改，关闭后修改将丢失。</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            继续编辑
          </button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">
            放弃修改
          </button>
        </div>
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, footer, onBeforeClose }: DrawerProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  // 打开时禁止 body 滚动
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const tryClose = () => {
    if (onBeforeClose && !onBeforeClose()) {
      setShowConfirm(true);
      return;
    }
    onClose();
  };

  const handleConfirmDiscard = () => {
    setShowConfirm(false);
    onClose();
  };

  return (
    <>
      {/* 遮罩 */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={tryClose}
      />
      {/* 抽屉面板 */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-140 max-w-[90vw] bg-white border-l flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
          <button onClick={tryClose} className="p-1.5 hover:bg-slate-100 rounded">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
        {/* 底部固定按钮栏 */}
        {footer && (
          <div className="border-t bg-white px-6 py-3 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
      {/* 确认放弃弹窗 */}
      <ConfirmDiscardDialog open={showConfirm} onConfirm={handleConfirmDiscard} onCancel={() => setShowConfirm(false)} />
    </>
  );
}
