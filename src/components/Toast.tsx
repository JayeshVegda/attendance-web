import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import clsx from 'clsx'

type ToastType = 'success' | 'error' | 'info'
type ToastItem = { id: number; type: ToastType; message: string }
type ToastContextValue = {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random()
    setItems((current) => [...current, { id, type, message }])
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id))
    }, 4200)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex w-[min(92vw,24rem)] flex-col gap-2 no-print">
        {items.map((item) => (
          <div
            key={item.id}
            className={clsx(
              'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl',
              item.type === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
              item.type === 'error' && 'border-rose-200 bg-rose-50 text-rose-900',
              item.type === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
            )}
          >
            {item.type === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            {item.type === 'error' && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            {item.type === 'info' && <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="flex-1 leading-5">{item.message}</span>
            <button
              className="rounded p-0.5 opacity-60 hover:opacity-100"
              onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
              aria-label="Close notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context.toast
}
