import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import clsx from 'clsx'
import { AlertTriangle, Loader2, Search, X } from 'lucide-react'

export function cn(...values: Array<string | false | null | undefined>) {
  return clsx(values)
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'amber' | 'emerald' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-bold tracking-tight transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 select-none',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9.5 px-4 text-xs sm:text-sm',
        size === 'lg' && 'h-11 px-5 text-sm',
        variant === 'primary' &&
          'bg-emerald-700 text-white shadow-xs hover:bg-emerald-800 active:bg-emerald-900',
        variant === 'emerald' &&
          'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800',
        variant === 'secondary' &&
          'border border-stone-300/90 bg-white text-stone-800 shadow-2xs hover:border-stone-400 hover:bg-stone-50 active:bg-stone-100',
        variant === 'outline' &&
          'border border-emerald-600/30 bg-emerald-50/40 text-emerald-800 hover:bg-emerald-100/60 hover:border-emerald-600/50',
        variant === 'ghost' && 'text-stone-600 hover:bg-stone-200/50 hover:text-stone-900',
        variant === 'danger' && 'bg-rose-700 text-white shadow-xs hover:bg-rose-800 active:bg-rose-900',
        variant === 'amber' && 'bg-amber-600 text-white shadow-xs hover:bg-amber-700 active:bg-amber-800',
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
      {children}
    </button>
  )
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      {...props}
      className={cn(
        'rounded-2xl border border-stone-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'teal'
  dot?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-tight select-none',
        tone === 'neutral' && 'bg-stone-100 text-stone-700',
        tone === 'green' && 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/20',
        tone === 'teal' && 'bg-teal-50 text-teal-800 ring-1 ring-teal-600/20',
        tone === 'amber' && 'bg-amber-50 text-amber-800 ring-1 ring-amber-600/20',
        tone === 'red' && 'bg-rose-50 text-rose-800 ring-1 ring-rose-600/20',
        tone === 'blue' && 'bg-sky-50 text-sky-800 ring-1 ring-sky-600/20',
        tone === 'violet' && 'bg-violet-50 text-violet-800 ring-1 ring-violet-600/20',
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full shrink-0',
            tone === 'neutral' && 'bg-stone-400',
            tone === 'green' && 'bg-emerald-600',
            tone === 'teal' && 'bg-teal-600',
            tone === 'amber' && 'bg-amber-600',
            tone === 'red' && 'bg-rose-600',
            tone === 'blue' && 'bg-sky-600',
            tone === 'violet' && 'bg-violet-600',
          )}
        />
      )}
      {children}
    </span>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {eyebrow && <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800/80 mb-0.5">{eyebrow}</div>}
        <h1 className="text-2xl font-black tracking-tight text-stone-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-0.5 text-xs text-stone-500 max-w-2xl font-medium leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'green' | 'amber' | 'red' | 'blue' | 'teal'
}) {
  return (
    <Card className="p-3.5 transition hover:border-stone-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-stone-500">
            {label}
          </div>
          <div
            className={cn(
              'mt-1 text-2xl font-black tracking-tight tabular-nums',
              tone === 'default' && 'text-stone-900',
              tone === 'green' && 'text-emerald-800',
              tone === 'teal' && 'text-teal-800',
              tone === 'amber' && 'text-amber-800',
              tone === 'red' && 'text-rose-800',
              tone === 'blue' && 'text-sky-800',
            )}
          >
            {value}
          </div>
          {hint && <div className="mt-1 text-[11px] font-medium text-stone-500 truncate">{hint}</div>}
        </div>
        {icon && (
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              tone === 'default' && 'bg-stone-100 text-stone-700',
              tone === 'green' && 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/15',
              tone === 'teal' && 'bg-teal-50 text-teal-700 ring-1 ring-teal-600/15',
              tone === 'amber' && 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/15',
              tone === 'red' && 'bg-rose-50 text-rose-700 ring-1 ring-rose-600/15',
              tone === 'blue' && 'bg-sky-50 text-sky-700 ring-1 ring-sky-600/15',
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </Card>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-emerald-700', className)} />
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && (
        <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-600 ring-1 ring-stone-200">
          {icon}
        </div>
      )}
      <div className="text-sm font-extrabold text-stone-900">{title}</div>
      {description && <p className="mt-1 max-w-sm text-xs text-stone-500 leading-relaxed font-medium">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      {label && (
        <span className="mb-1 block text-xs font-bold text-stone-700">
          {label}
        </span>
      )}
      {children}
      {hint && !error && <span className="mt-1 block text-[11px] text-stone-500">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] font-semibold text-rose-600">{error}</span>}
    </label>
  )
}

const fieldClass =
  'w-full rounded-xl border border-stone-300/90 bg-white px-3.5 py-2 text-sm text-stone-900 shadow-2xs outline-none transition-all placeholder:text-stone-400 focus:border-emerald-600 focus:ring-3 focus:ring-emerald-600/15 hover:border-stone-400 disabled:bg-stone-50 disabled:text-stone-400 disabled:cursor-not-allowed'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldClass, className)} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(fieldClass, className)}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldClass, 'min-h-18 resize-y', className)} />
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className={cn('relative w-full', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldClass, 'h-9 pl-9 pr-8 text-xs font-medium')}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          aria-label="Clear search"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (val: T) => void
  options: Array<{ id: T; label: string; count?: number; icon?: ReactNode }>
  className?: string
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border border-stone-200/90 bg-stone-100/80 p-0.5 text-xs font-bold shadow-2xs select-none',
        className,
      )}
    >
      {options.map((opt) => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all duration-120',
              active
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900 hover:bg-white/60',
            )}
          >
            {opt.icon}
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 text-[10px] font-extrabold',
                  active ? 'bg-stone-100 text-stone-800' : 'bg-stone-200/80 text-stone-600',
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 no-print">
      <button
        className="absolute inset-0 bg-stone-950/45 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-stone-200 bg-white shadow-2xl sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-3.5 sm:px-6 bg-stone-50/60">
          <div>
            <h2 className="text-base font-black text-stone-900">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-stone-500 font-medium">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-200/60 hover:text-stone-700 transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 bg-stone-50/80 px-5 py-3 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  loading?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            tone === 'danger' ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-600/15' : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600/15',
          )}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p className="pt-1 text-xs leading-relaxed text-stone-600 font-medium">{message}</p>
      </div>
    </Modal>
  )
}

export function Avatar({
  name,
  employeeNo,
  size = 'md',
}: {
  name: string
  employeeNo?: string | number
  size?: 'sm' | 'md' | 'lg'
}) {
  const parts = name.split(/\s+/).filter(Boolean)
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  const palette = [
    'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-700/20',
    'bg-sky-100 text-sky-900 ring-1 ring-sky-700/20',
    'bg-amber-100 text-amber-900 ring-1 ring-amber-700/20',
    'bg-violet-100 text-violet-900 ring-1 ring-violet-700/20',
    'bg-rose-100 text-rose-900 ring-1 ring-rose-700/20',
    'bg-teal-100 text-teal-900 ring-1 ring-teal-700/20',
    'bg-indigo-100 text-indigo-900 ring-1 ring-indigo-700/20',
    'bg-orange-100 text-orange-900 ring-1 ring-orange-700/20',
  ]

  // Robust hash using full name characters + worker number
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  if (employeeNo) {
    const num = typeof employeeNo === 'number' ? employeeNo : parseInt(String(employeeNo), 10) || 0
    hash = hash * 31 + num
  }
  const tone = palette[Math.abs(hash) % palette.length]

  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-xl font-black select-none',
          tone,
          size === 'sm' && 'h-7 w-7 text-[10px]',
          size === 'md' && 'h-8.5 w-8.5 text-xs',
          size === 'lg' && 'h-11 w-11 text-sm',
        )}
      >
        {initials || '?'}
      </div>
      {employeeNo && (
        <span
          className={cn(
            'absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-stone-900 font-bold text-white shadow-xs',
            size === 'sm' && 'h-3.5 w-3.5 text-[8px]',
            size === 'md' && 'h-4 w-4 text-[9px]',
            size === 'lg' && 'h-5 w-5 text-[10px]',
          )}
        >
          {employeeNo}
        </span>
      )}
    </div>
  )
}
