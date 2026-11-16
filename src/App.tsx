import { lazy, Suspense, useEffect, useState } from 'react'
import { AppShell, type View } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'

const AttendancePage = lazy(() => import('./pages/AttendancePage'))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'))
const UpadPage = lazy(() => import('./pages/UpadPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

const VIEWS: View[] = ['attendance', 'employees', 'upad', 'reports', 'settings']
function readView(): View {
  const name = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return VIEWS.includes(name as View) ? (name as View) : 'attendance'
}

export default function App() {
  const [view, setView] = useState(readView)
  useEffect(() => {
    const update = () => setView(readView())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  function navigate(next: View) {
    window.location.hash = next
    setView(next)
  }

  useEffect(() => {
    document.title = `${view === 'attendance' ? 'Attendance' : view[0].toUpperCase() + view.slice(1)} · Kapil Products`
    window.scrollTo({ top: 0 })
  }, [view])

  const page = view === 'employees' ? <EmployeesPage />
    : view === 'upad' ? <UpadPage />
      : view === 'reports' ? <ReportsPage />
        : view === 'settings' ? <SettingsPage />
          : <AttendancePage />

  return (
    <AppShell current={view} onNavigate={navigate}>
      <ErrorBoundary key={view}>
        <Suspense fallback={<div role="status" aria-live="polite" className="mx-auto max-w-7xl p-8 text-sm text-stone-500">Loading…</div>}>
          {page}
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  )
}
