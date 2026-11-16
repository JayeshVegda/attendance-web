import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { Toaster, toast as sonnerToast } from 'sonner'

type ToastType = 'success' | 'error' | 'info'
type ToastContextValue = {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const toast = useCallback((message: string, type: ToastType = 'success') => {
    if (type === 'error') {
      sonnerToast.error(message, { duration: 4000 })
    } else if (type === 'info') {
      sonnerToast.info(message, { duration: 3500 })
    } else {
      sonnerToast.success(message, { duration: 3200 })
    }
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        theme="light"
        className="no-print"
        toastOptions={{
          style: {
            fontFamily: 'inherit',
            borderRadius: '0.875rem',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
          },
        }}
      />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context.toast
}
