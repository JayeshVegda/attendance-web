import { useEffect, useState } from 'react'
import { AppShell, type View } from './components/AppShell'
import { ToastProvider } from './components/Toast'
import AttendancePage from './pages/AttendancePage'
import PayoutScreen from './pages/PayoutScreen'
import EmployeesPage from './pages/EmployeesPage'
import EmployeeDetailPage from './pages/EmployeeDetailPage'
import UpadPage from './pages/UpadPage'
import ReportsPage from './pages/ReportsPage'
import SettingsPage from './pages/SettingsPage'

type Route = { view: View; id?: string }

const VIEWS: View[] = ['attendance', 'payout', 'employees', 'upad', 'reports', 'settings']

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [first, second] = raw.split('/')
  const baseView = first.split('?')[0]
  const query = first.includes('?') ? first.slice(first.indexOf('?')) : undefined
  if (baseView === 'payout') return { view: 'payout', id: query }
  const view = (VIEWS.includes(baseView as View) ? baseView : 'attendance') as View
  return { view, id: second || query }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash())

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const names: Record<View, string> = {
      attendance: 'Attendance',
      payout: 'Issue Payout',
      employees: 'Employees',
      upad: 'Upad',
      reports: 'Reports',
      settings: 'Settings',
    }
    document.title = `${names[route.view]} · હાજરી પગાર`
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [route.view, route.id])

  function navigate(path: string) {
    const next = path.replace(/^#\/?/, '')
    if (window.location.hash === `#${next}`) return
    window.location.hash = next
  }

  let page: React.ReactNode
  if (route.view === 'employees' && route.id) {
    page = <EmployeeDetailPage employeeId={route.id} onNavigate={navigate} />
  } else if (route.view === 'employees') {
    page = <EmployeesPage onNavigate={navigate} />
  } else if (route.view === 'payout') {
    const workerMatch = route.id?.match(/worker=([^&]+)/)
    page = <PayoutScreen onNavigate={navigate} initialWorkerId={workerMatch ? workerMatch[1] : undefined} />
  } else if (route.view === 'upad') {
    page = <UpadPage onNavigate={navigate} />
  } else if (route.view === 'reports') {
    page = <ReportsPage runId={route.id} onNavigate={navigate} />
  } else if (route.view === 'settings') {
    page = <SettingsPage />
  } else {
    page = <AttendancePage onNavigate={navigate} />
  }

  return (
    <ToastProvider>
      <AppShell current={route.view} onNavigate={(view) => navigate(view)}>
        {page}
      </AppShell>
    </ToastProvider>
  )
}
