import { type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  CalendarCheck,
  Coins,
  Settings,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import { pb } from '../lib/pb'

export type View = 'attendance' | 'employees' | 'upad' | 'reports' | 'settings'

const NAV: Array<{ id: View; label: string; short: string; icon: typeof CalendarCheck }> = [
  { id: 'attendance', label: 'Attendance & Payout', short: 'Attendance', icon: CalendarCheck },
  { id: 'employees', label: 'Employees', short: 'Workers', icon: Users },
  { id: 'upad', label: 'Upad (Advances)', short: 'Upad', icon: Coins },
  { id: 'reports', label: 'Reports & Vouchers', short: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', short: 'Settings', icon: Settings },
]

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-base font-black text-white">
        હ
      </div>
      <div>
        <div className="text-sm font-extrabold tracking-tight text-stone-900">હાજરી પગાર</div>
        <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
          Attendance & Payroll
        </div>
      </div>
    </div>
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
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => pb.health.check(),
    refetchInterval: 30_000,
    retry: 0,
  })

  return (
    <div className="min-h-screen">
      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-stone-200 bg-white/95 px-4 backdrop-blur-sm lg:hidden">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">
            હ
          </div>
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

      <div className="mx-auto flex min-h-screen w-full max-w-[1500px]">
        {/* Desktop sidebar */}
        <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 border-r border-stone-200 bg-white lg:block">
          <div className="flex h-full flex-col">
            <div className="border-b border-stone-100 px-5 py-5">
              <Logo />
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4">
              {NAV.map((item) => {
                const Icon = item.icon
                const active = current === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    className={clsx(
                      'flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-bold transition-colors select-none',
                      active
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
                    )}
                  >
                    <Icon className={clsx('h-4.5 w-4.5', active ? 'text-emerald-50' : 'text-stone-400')} />
                    <span>{item.label}</span>
                  </button>
                )
              })}
            </nav>
            <div className="border-t border-stone-100 px-5 py-4 text-xs">
              <div className="flex items-center gap-2 font-semibold text-stone-500">
                <span
                  className={clsx(
                    'h-2 w-2 rounded-full',
                    health.isError ? 'bg-rose-500' : 'bg-emerald-500',
                  )}
                />
                {health.isError ? 'Database offline' : 'Database connected'}
              </div>
              <div className="mt-1 font-mono text-[10px] text-stone-400/80">
                {typeof window !== 'undefined' ? window.location.host : '127.0.0.1'} · Local PC
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="no-print sticky bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur-sm lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = current === item.id
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={clsx(
                  'flex flex-col items-center gap-0.5 px-2 py-2.5 text-[10px] font-bold transition-colors select-none',
                  active ? 'text-emerald-700' : 'text-stone-500 hover:text-stone-700',
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.short}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
