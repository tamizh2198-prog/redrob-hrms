import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export interface ToastInput {
  title: string
  body?: string
}

interface Toast extends ToastInput {
  id: number
}

interface ToastContextValue {
  pushToast: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const AUTO_DISMISS_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { ...toast, id }])
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2 rounded-xl border border-border bg-card p-3 text-sm text-card-foreground shadow-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-top-2"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.title}</p>
              {t.body && <p className="mt-0.5 text-muted-foreground">{t.body}</p>}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => dismiss(t.id)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
