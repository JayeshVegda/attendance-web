import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  CalendarCheck,
  ChevronRight,
  Coins,
  HandCoins,
  Menu,
  Settings,
  Users,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { listEmployees, listRuns, getSettings } from '../lib/api'
import { cycleStartFor } from '../lib/cycle'
import { formatDateShort } from '../lib/dates'
import { pb } from '../lib/pb'
import { Spinner } from './ui'

export type View = 'attendance' | 'employees' | 'upad' | 'reports' | 'settings'

const NAV: Array<{ id: View; label: string; icon: typeof CalendarCheck }> = [
  { id: 'attendance', label: 'Attendance & Payout', icon: CalendarCheck },
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'upad', label: 'Upad (Advances)', icon: Coins },
  { id: 'reports', label: 'Reports & Vouchers', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600/15 text-base font-black text-emerald-300 ring-1 ring-emerald-500/20">
        હ
      </div>
      <div>
        <div className="text-sm font-extrabold tracking-tight text-white flex items-center gap-1.5">
          <span>હાજરી પગાર</span>
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-bold text-emerald-300 uppercase tracking-widest">
            Local
          </span>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
          Attendance & Payroll
        </div>
      </div>
    </div>
  )
}

function NavList({
  current,
  onNavigate,
  onClose,
}: {
  current: View
  onNavigate: (view: View) => void
  onClose?: () => void
}) {
  return (
    <nav className="space-y-1" aria-label="Main navigation">
      {NAV.map((item) => {
        const Icon = item.icon
        const active = current === item.id
        return (
          <button
            key={item.id}
            onClick={() => {
              onNavigate(item.id)
              onClose?.()
            }}
            className={clsx(
              'group flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-bold transition-all duration-120 select-none',
              active
                ? 'bg-emerald-600/20 text-white shadow-xs ring-1 ring-emerald-500/30'
                : 'text-stone-300/80 hover:bg-white/[0.06] hover:text-white',
            )}
          >
            <Icon
              className={clsx(
                'h-4.5 w-4.5 transition-colors',
                active ? 'text-emerald-400' : 'text-stone-400 group-hover:text-emerald-300',
              )}
            />
            <span>{item.label}</span>
            {active && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />
            )}
          </button>
        )
      })}
    </nav>
  )
}

export function AppShell({
  current,
  onNavigate,
  children,
}: {
  current: View
  onNavigate: (view: View) => void
  children: ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const employees = useQuery({ queryKey: ['employees'], queryFn: () => listEmployees(true) })
  const runs = useQuery({ queryKey: ['runs'], queryFn: listRuns })
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => pb.health.check(),
    refetchInterval: 30_000,
    retry: 0,
  })

  useEffect(() => {
    if (!mobileOpen) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const activeCount = (employees.data ?? []).filter((employee) => employee.active).length
  const cycleStart = settings.data ? cycleStartFor(runs.data ?? [], settings.data) : '—'

  const sidebar = (
    <div className="flex h-full flex-col bg-[#0f231d]">
      <div className="px-5 pb-5 pt-5">
        <Logo />
      </div>

      <div className="px-3">
        <NavList current={current} onNavigate={onNavigate} />
      </div>

      {/* Cycle Quick Card */}
      <div className="mx-3 mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            Current Cycle
          </span>
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-extrabold text-emerald-300">
            Open
          </span>
        </div>
        <div className="mt-1.5 text-sm font-bold text-white">
          From {cycleStart === '—' ? '—' : formatDateShort(cycleStart)}
        </div>
        <div className="mt-0.5 text-xs text-stone-400 font-medium">
          {activeCount} active worker{activeCount === 1 ? '' : 's'}
        </div>
        <button
          type="button"
          onClick={() => {
            onNavigate('attendance')
            setMobileOpen(false)
          }}
          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl bg-emerald-700/50 px-3 py-1.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-700 hover:text-white"
        >
          <span>Open Register</span>
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      {/* Quick Upad Action */}
      <div className="mx-3 mt-2.5">
        <button
          type="button"
          onClick={() => {
            onNavigate('upad')
            setMobileOpen(false)
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-200 transition hover:bg-amber-500/20 hover:text-white"
        >
          <HandCoins className="h-3.5 w-3.5 text-amber-300" />
          <span>Record Upad Advance</span>
        </button>
      </div>

      <div className="mt-auto border-t border-white/[0.08] px-5 py-4">
        <div className="flex items-center gap-2 text-xs text-stone-300">
          {health.isLoading ? (
            <Spinner className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <span
              className={clsx(
                'relative flex h-2 w-2 rounded-full',
                health.isError ? 'bg-rose-500' : 'bg-emerald-400',
              )}
            >
              {!health.isError && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
            </span>
          )}
          <span className="font-semibold text-stone-300">
            {health.isError ? 'Database offline' : 'Database connected'}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] text-stone-400/80 font-mono">
          {typeof window !== 'undefined' ? window.location.host : '127.0.0.1'} · Local PC
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 bg-[#0f231d] lg:block shadow-md z-20">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile Header */}
        <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-stone-200/90 bg-white/95 px-4 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-xl border border-stone-200 bg-white p-1.5 text-stone-700 shadow-2xs active:scale-95"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <div className="text-sm font-black text-stone-900">હાજરી પગાર</div>
              <div className="text-[10px] uppercase tracking-wider text-stone-400 font-bold">
                Attendance & Payroll
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold text-stone-600">
            <span
              className={clsx(
                'h-1.5 w-1.5 rounded-full',
                health.isError ? 'bg-rose-500' : 'bg-emerald-500',
              )}
            />
            {health.isError ? 'Offline' : 'Local'}
          </div>
        </header>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden no-print">
            <button
              className="absolute inset-0 bg-stone-950/50 backdrop-blur-xs transition-opacity"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            />
            <aside className="relative h-full w-[17.5rem] max-w-[85vw] bg-[#0f231d] shadow-2xl">
              <button
                className="absolute right-3.5 top-3.5 rounded-xl p-2 text-stone-300 hover:bg-white/10 hover:text-white"
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
              {sidebar}
            </aside>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6 lg:px-7 lg:py-6">
          {children}
        </main>
      </div>
    </div>
  )
}
