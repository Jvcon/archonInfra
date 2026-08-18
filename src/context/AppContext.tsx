/** 全局状态管理 */
import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { PageName } from '../types';
import type { StorageConfig } from '../lib/storage';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface AppState {
  currentPage: PageName;
  toasts: Toast[];
}

type AppAction =
  | { type: 'SET_PAGE'; page: PageName }
  | { type: 'ADD_TOAST'; toast: Toast }
  | { type: 'REMOVE_TOAST'; id: string };

const initialState: AppState = {
  currentPage: 'dashboard',
  toasts: [],
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_PAGE':
      return { ...state, currentPage: action.page };
    case 'ADD_TOAST':
      return { ...state, toasts: [...state.toasts, action.toast] };
    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.id) };
    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  setPage: (page: PageName) => void;
  switchDriver: (config: StorageConfig) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

interface AppProviderProps {
  children: ReactNode;
  switchDriver: (config: StorageConfig) => Promise<void>;
}

export function AppProvider({ children, switchDriver }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = crypto.randomUUID();
    dispatch({ type: 'ADD_TOAST', toast: { id, message, type } });
    setTimeout(() => dispatch({ type: 'REMOVE_TOAST', id }), 3000);
  };

  const setPage = (page: PageName) => {
    dispatch({ type: 'SET_PAGE', page });
  };

  return (
    <AppContext.Provider value={{ state, dispatch, showToast, setPage, switchDriver }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用');
  return ctx;
}
