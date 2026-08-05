import {
  type JSX,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { IconCheck, IconWarning, IconX } from './icons.js';

type ToastTone = 'success' | 'error' | 'info';

type ToastOptions = {
  title: string;
  description?: string | undefined;
  tone?: ToastTone | undefined;
};

type ToastItem = ToastOptions & { id: string; tone: ToastTone };

type ToastApi = {
  toast: (options: ToastOptions) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<ToastTone, JSX.Element> = {
  success: <IconCheck />,
  error: <IconWarning />,
  info: <IconWarning />,
};

const TONE_ACCENT: Record<ToastTone, string> = {
  success: 'text-ok',
  error: 'text-bad',
  info: 'text-brand',
};

/** App-wide toast host. Wrap the tree once; call `useToast()` anywhere beneath it. */
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string): void => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions): void => {
      const id = Math.random().toString(36).slice(2);
      const tone = options.tone ?? 'info';
      setItems((current) => [...current, { ...options, id, tone }]);
      window.setTimeout(() => { dismiss(id); }, tone === 'error' ? 6000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => { toast({ title, description, tone: 'success' }); },
      error: (title, description) => { toast({ title, description, tone: 'error' }); },
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[2000] flex w-[min(360px,calc(100vw-2.5rem))] flex-col gap-2.5">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-lg"
          >
            <span className={`mt-0.5 flex size-5 flex-none items-center justify-center ${TONE_ACCENT[item.tone]}`}>
              {TONE_ICON[item.tone]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink">{item.title}</div>
              {item.description ? (
                <div className="mt-0.5 text-[13px] leading-snug text-ink-2">{item.description}</div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              className="flex size-6 flex-none items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
              onClick={() => { dismiss(item.id); }}
            >
              <IconX />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used within a ToastProvider.');
  return api;
}
