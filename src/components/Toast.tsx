/** 通知 Toast 组件 */
import { useApp } from '../context/AppContext';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';

export function Toast() {
  const { state, dispatch } = useApp();

  if (state.toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {state.toasts.map(toast => (
        <div
          key={toast.id}
          className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-medium animate-in slide-in-from-right ${
            toast.type === 'success' ? 'bg-green-50 text-green-700 border-green-500' :
            toast.type === 'error' ? 'bg-red-50 text-red-700 border-red-500' :
            'bg-blue-50 text-blue-700 border-blue-500'
          }`}
        >
          {toast.type === 'success' && <CheckCircle className="w-4 h-4" />}
          {toast.type === 'error' && <XCircle className="w-4 h-4" />}
          {toast.type === 'info' && <Info className="w-4 h-4" />}
          <span>{toast.message}</span>
          <button onClick={() => dispatch({ type: 'REMOVE_TOAST', id: toast.id })} className="ml-2 hover:opacity-70">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
