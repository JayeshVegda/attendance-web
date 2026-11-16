import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, CalendarCheck, Coins, PanelLeftClose, PanelLeftOpen, Settings, Users } from 'lucide-react'
import clsx from 'clsx'
import { pb } from '../lib/pb'
import { loadAppData, saveSettings } from '../lib/attendance-service'
import { getLanguage, hasLanguagePreference, setLanguage, type LanguageMode } from '../lib/i18n'

export type View = 'attendance' | 'employees' | 'upad' | 'reports' | 'settings'

const NAV: Array<{ id: View; label: string; icon: typeof CalendarCheck }> = [
  { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { id: 'employees', label: 'Workers', icon: Users },
  { id: 'upad', label: 'Upad', icon: Coins },
  { id: 'reports', label: 'Report', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
]
const NAV_GU: Record<View, string> = {
  attendance: 'હાજરી',
  employees: 'કામદારો',
  upad: 'ઉપાડ',
  reports: 'રિપોર્ટ',
  settings: 'સેટિંગ્સ',
}
const NAV_SHORT: Record<View, string> = {
  attendance: 'Attend',
  employees: 'Workers',
  upad: 'Upad',
  reports: 'Report',
  settings: 'Settings',
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
  const [language, setLocalLanguage] = useState<LanguageMode>(() => getLanguage())
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('agy_sidebar_collapsed') === 'true'
    } catch {
      return false
    }
  })

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => pb.health.check(),
    refetchInterval: 30_000,
    retry: 0,
  })

  const appData = useQuery({
    queryKey: ['attendance-data'],
    queryFn: loadAppData,
  })

  const companyName = appData.data?.settings.company_name || 'Kapil Products'

  useEffect(() => {
    const syncLanguage = () => setLocalLanguage(getLanguage())
    window.addEventListener('languagechange', syncLanguage)
    return () => window.removeEventListener('languagechange', syncLanguage)
  }, [])

  useEffect(() => {
    const setting = appData.data?.settings.language
    if (setting && !hasLanguagePreference() && setting !== language) {
      setLanguage(setting)
      setLocalLanguage(setting)
    }
  }, [appData.data?.settings.language, language])

  function chooseLanguage(value: LanguageMode) {
    setLanguage(value)
    setLocalLanguage(value)
    void saveSettings({ language: value }).then(() => appData.refetch()).catch(() => {})
  }

  function toggleSidebar() {
    setCollapsed((value) => {
      const next = !value
      try {
        localStorage.setItem('agy_sidebar_collapsed', String(next))
      } catch {
        // Local state preserved
      }
      return next
    })
  }

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 antialiased">
      <a
        href="#main-content"
        className="skip-link"
      >
        {language === 'gu' ? 'મુખ્ય સામગ્રી પર જાઓ' : 'Skip to main content'}
      </a>
      <header className="no-print sticky top-0 z-30 flex h-12 items-center justify-between border-b border-stone-200 bg-white/95 px-3 backdrop-blur-sm lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-700 text-[11px] font-black text-white">KP</div>
          <div className="min-w-0"><div className="truncate text-xs font-black text-stone-900">{companyName}</div><div className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{language === 'gu' ? 'હાજરી અને પગાર' : 'Attendance & Payroll'}</div></div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitch language={language} onChange={chooseLanguage} />
          <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-1 text-[9px] font-bold text-stone-600"><span className={clsx('h-1.5 w-1.5 rounded-full', health.isError ? 'bg-rose-500' : 'bg-emerald-500')} />{health.isError ? (language === 'gu' ? 'બંધ' : 'Offline') : (language === 'gu' ? 'સ્થાનિક' : 'Local')}</span>
        </div>
      </header>
      <div className="flex min-h-screen w-full">
        <aside
          className={clsx(
            'no-print sticky top-0 hidden h-screen shrink-0 border-r border-stone-200 bg-white transition-[width] duration-200 ease-in-out lg:block',
            collapsed ? 'w-16' : 'w-56',
          )}
        >
          <div className="flex h-full flex-col">
            <div
              className={clsx(
                'flex min-h-[64px] items-center border-b border-stone-100',
                collapsed ? 'justify-center p-3' : 'justify-between px-4 py-3',
              )}
            >
              {!collapsed ? (
                <>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-700 text-sm font-black text-white shadow-sm">
                      KP
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black tracking-tight text-stone-900">
                        {companyName}
                      </div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                        {language === 'gu' ? 'હાજરી અને પગાર' : 'Attendance & Payroll'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={toggleSidebar}
                    aria-label="Collapse sidebar"
                    title="Collapse sidebar"
                    className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-700 text-xs font-black text-white shadow-sm">
                    KP
                  </div>
                  <button
                    onClick={toggleSidebar}
                    aria-label="Expand sidebar"
                    title="Expand sidebar"
                    className="rounded-lg p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <nav aria-label={language === 'gu' ? 'મુખ્ય મેનૂ' : 'Primary navigation'} className="flex-1 space-y-1 px-2 py-3">
              {NAV.map((item) => {
                const Icon = item.icon
                const active = current === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    aria-current={active ? 'page' : undefined}
                    title={language === 'gu' ? NAV_GU[item.id] : item.label}
                    className={clsx(
                      'relative flex w-full select-none items-center rounded-xl font-bold transition-colors',
                      collapsed ? 'justify-center p-2.5' : 'px-3 py-2 text-xs',
                      active
                        ? 'bg-emerald-700 text-white shadow-sm'
                        : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900',
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className={clsx('h-4 w-4 shrink-0', active ? 'text-white' : 'text-stone-400')} />
                      {!collapsed && <span>{language === 'gu' ? NAV_GU[item.id] : item.label}</span>}
                    </span>
                  </button>
                )
              })}
            </nav>

            <div className="border-t border-stone-100 bg-stone-50/70 p-3">
              {!collapsed ? (
                <div className="mb-2.5">
                  <div className="mb-1 text-[10px] font-bold text-stone-500">{language === 'gu' ? 'ભાષા' : 'Language'}</div>
                  <LanguageSwitch language={language} onChange={chooseLanguage} wide />
                </div>
              ) : (
                <button type="button" onClick={() => chooseLanguage(language === 'en' ? 'gu' : 'en')} aria-label={language === 'en' ? 'Switch language to Gujarati' : 'Switch language to English'} className="mb-2 w-full rounded-md py-1 text-[10px] font-black text-stone-600 hover:bg-stone-200">{language === 'en' ? 'ગુજ' : 'EN'}</button>
              )}
              <div className="flex items-center gap-2 text-[11px] font-semibold text-stone-500">
                <span
                  className={clsx(
                    'h-2 w-2 shrink-0 rounded-full',
                    health.isError ? 'bg-rose-500' : 'bg-emerald-500',
                  )}
                />
                {!collapsed && (
                  <div className="min-w-0 truncate">
                    <span>{health.isError ? (language === 'gu' ? 'ડેટાબેઝ બંધ' : 'Database offline') : (language === 'gu' ? 'ડેટાબેઝ જોડાયેલ' : 'Database connected')}</span>
                    <div className="font-mono text-[9px] text-stone-400">127.0.0.1:8091</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-x-hidden p-3.5 pb-20 lg:p-4">
          {children}
        </main>
      </div>
      <nav aria-label={language === 'gu' ? 'મુખ્ય મેનૂ' : 'Primary navigation'} className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(15,23,42,0.06)] backdrop-blur-sm lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = current === item.id
            const label = language === 'gu' ? NAV_GU[item.id] : NAV_SHORT[item.id]
            return <button key={item.id} type="button" onClick={() => onNavigate(item.id)} aria-current={active ? 'page' : undefined} className={clsx('flex min-w-0 flex-col items-center gap-0.5 px-1 py-2 text-[9px] font-bold transition-colors', active ? 'text-emerald-800' : 'text-stone-500 hover:text-stone-800')}><Icon className="h-4 w-4" /><span className="max-w-full truncate">{label}</span></button>
          })}
        </div>
      </nav>
    </div>
  )
}

function LanguageSwitch({ language, onChange, wide = false }: { language: LanguageMode; onChange: (value: LanguageMode) => void; wide?: boolean }) {
  return <div role="group" aria-label="Language" className={clsx('inline-flex items-center rounded-md border border-stone-200 bg-white p-0.5 text-[10px] font-bold', wide && 'grid w-full grid-cols-2')}>
    {(['en', 'gu'] as const).map((value) => <button key={value} type="button" aria-pressed={language === value} onClick={() => onChange(value)} className={clsx('rounded px-2 py-1 transition-colors', wide && 'text-center', language === value ? 'bg-emerald-700 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-100')}>{value === 'en' ? 'EN' : 'ગુજરાતી'}</button>)}
  </div>
}
