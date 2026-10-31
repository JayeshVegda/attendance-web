import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Banknote,
  BarChart3,
  CalendarCheck,
  Coins,
  Globe,
  Settings,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import { pb } from '../lib/pb'
import { getLanguage, setLanguage, t, type LanguageMode, type TranslationKey } from '../lib/i18n'

export type View = 'attendance' | 'payout' | 'employees' | 'upad' | 'reports' | 'settings'

const NAV: Array<{
  id: View
  tKey: TranslationKey
  shortKey: TranslationKey
  icon: typeof CalendarCheck
  badge?: string
}> = [
  { id: 'attendance', tKey: 'nav_attendance', shortKey: 'nav_attendance', icon: CalendarCheck },
  { id: 'payout', tKey: 'nav_payout', shortKey: 'nav_payout', icon: Banknote, badge: 'Pay' },
  { id: 'employees', tKey: 'nav_employees', shortKey: 'nav_employees', icon: Users },
  { id: 'upad', tKey: 'nav_upad', shortKey: 'nav_upad', icon: Coins },
  { id: 'reports', tKey: 'nav_reports', shortKey: 'nav_reports', icon: BarChart3 },
  { id: 'settings', tKey: 'nav_settings', shortKey: 'nav_settings', icon: Settings },
]

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-base font-black text-white shadow-xs">
        હ
      </div>
      <div>
        <div className="text-sm font-extrabold tracking-tight text-stone-900">હાજરી પગાર</div>
        <div className="text-[10px] uppercase tracking-wider text-stone-400 font-bold">
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
  const [lang, setLang] = useState<LanguageMode>(() => getLanguage())

  useEffect(() => {
    const handleLangChange = () => setLang(getLanguage())
    window.addEventListener('languagechange', handleLangChange)
    return () => window.removeEventListener('languagechange', handleLangChange)
  }, [])

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => pb.health.check(),
    refetchInterval: 30_000,
    retry: 0,
  })

  function handleSwitchLang(next: LanguageMode) {
    setLanguage(next)
    setLang(next)
  }

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
              Payroll
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Mobile Language switch */}
          <div className="flex items-center rounded-lg border border-stone-200 bg-stone-50 p-0.5 text-[10px] font-bold">
            <button
              onClick={() => handleSwitchLang('mixed')}
              className={clsx('px-1.5 py-0.5 rounded', lang === 'mixed' && 'bg-white shadow-2xs text-emerald-800')}
            >
              Mix
            </button>
            <button
              onClick={() => handleSwitchLang('gu')}
              className={clsx('px-1.5 py-0.5 rounded', lang === 'gu' && 'bg-white shadow-2xs text-emerald-800')}
            >
              ગુજ
            </button>
            <button
              onClick={() => handleSwitchLang('en')}
              className={clsx('px-1.5 py-0.5 rounded', lang === 'en' && 'bg-white shadow-2xs text-emerald-800')}
            >
              EN
            </button>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600">
            <span
              className={clsx(
                'h-1.5 w-1.5 rounded-full',
                health.isError ? 'bg-rose-500' : 'bg-emerald-500',
              )}
            />
            {health.isError ? 'Offline' : 'Local'}
          </div>
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
                      'flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-bold transition-colors select-none',
                      active
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={clsx('h-4.5 w-4.5', active ? 'text-white' : 'text-stone-400')} />
                      <span>{t(item.tKey, lang)}</span>
                    </div>
                    {item.badge && !active && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">
                        {item.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </nav>

            {/* Language Quick Switcher */}
            <div className="border-t border-stone-100 px-4 py-3 bg-stone-50/50">
              <div className="flex items-center justify-between text-[11px] font-bold text-stone-500 mb-1.5">
                <span className="inline-flex items-center gap-1">
                  <Globe className="h-3 w-3" /> ભાષા / Language
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => handleSwitchLang('mixed')}
                  className={clsx(
                    'rounded-lg py-1 transition border text-center',
                    lang === 'mixed'
                      ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                      : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100',
                  )}
                  title="ગુજરાતી + English mixed labels"
                >
                  Mixed
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchLang('gu')}
                  className={clsx(
                    'rounded-lg py-1 transition border text-center',
                    lang === 'gu'
                      ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                      : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100',
                  )}
                  title="માત્ર ગુજરાતી"
                >
                  ગુજરાતી
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchLang('en')}
                  className={clsx(
                    'rounded-lg py-1 transition border text-center',
                    lang === 'en'
                      ? 'border-emerald-600 bg-emerald-600 text-white shadow-2xs'
                      : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100',
                  )}
                  title="English only"
                >
                  English
                </button>
              </div>
            </div>

            <div className="border-t border-stone-100 px-5 py-3 text-xs">
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
        <div className="mx-auto grid max-w-md grid-cols-6">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = current === item.id
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={clsx(
                  'flex flex-col items-center gap-0.5 px-1 py-2 text-[9px] font-bold transition-colors select-none truncate',
                  active ? 'text-emerald-700' : 'text-stone-500 hover:text-stone-700',
                )}
              >
                <Icon className="h-4.5 w-4.5" />
                <span className="truncate">{t(item.shortKey, lang).split(' ')[0]}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
