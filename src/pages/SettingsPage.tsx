import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  CheckCircle2,
  Copy,
  Database,
  HardDrive,
  Info,
  Save,
  ShieldCheck,
} from 'lucide-react'
import { getSettings, listEmployees, listRuns, saveSetting } from '../lib/api'
import { DEFAULT_SETTINGS } from '../lib/cycle'
import { pb } from '../lib/pb'
import { useToast } from '../components/Toast'
import { getLanguage, setLanguage, type LanguageMode } from '../lib/i18n'
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '../components/ui'

const WEEKDAYS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday (Default)' },
  { value: '6', label: 'Saturday' },
]

const LANGUAGES = [
  { value: 'mixed', label: 'ગુજરાતી + English (Mixed / ભલામણ કરેલ)' },
  { value: 'gu', label: 'માત્ર ગુજરાતી (Gujarati Only)' },
  { value: 'en', label: 'English Only' },
]

export default function SettingsPage() {
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => listEmployees(true) })
  const runsQuery = useQuery({ queryKey: ['runs'], queryFn: listRuns })
  const queryClient = useQueryClient()
  const toast = useToast()

  const [businessName, setBusinessName] = useState('')
  const [firstCycleStart, setFirstCycleStart] = useState('')
  const [otDivisor, setOtDivisor] = useState('8')
  const [payoutWeekday, setPayoutWeekday] = useState('5')
  const [language, setLangState] = useState<LanguageMode>(() => getLanguage())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!settingsQuery.data) return
    setBusinessName(settingsQuery.data.business_name ?? DEFAULT_SETTINGS.business_name)
    setFirstCycleStart(settingsQuery.data.first_cycle_start ?? DEFAULT_SETTINGS.first_cycle_start)
    setOtDivisor(settingsQuery.data.ot_divisor ?? DEFAULT_SETTINGS.ot_divisor)
    setPayoutWeekday(
      settingsQuery.data.expected_payout_weekday ?? DEFAULT_SETTINGS.expected_payout_weekday,
    )
  }, [settingsQuery.data])

  const mutation = useMutation({
    mutationFn: async () => {
      setLanguage(language)
      await Promise.all([
        saveSetting('business_name', businessName.trim() || DEFAULT_SETTINGS.business_name),
        saveSetting('first_cycle_start', firstCycleStart),
        saveSetting('ot_divisor', String(Number.parseFloat(otDivisor) || 8)),
        saveSetting('expected_payout_weekday', payoutWeekday),
        saveSetting('app_language', language),
      ])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast('Settings saved successfully')
    },
    onError: (error) =>
      toast(error instanceof Error ? error.message : 'Could not save settings', 'error'),
  })

  function copyPath() {
    navigator.clipboard.writeText('C:\\Site_imp\\attendance-web\\pb\\pb_data')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast('Data folder path copied to clipboard')
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-28 text-sm font-semibold text-stone-500">
        <Spinner className="h-6 w-6" />
        <span>Loading settings…</span>
      </div>
    )
  }

  const activeCount = (employeesQuery.data ?? []).filter((employee) => employee.active).length

  return (
    <div>
      <PageHeader
        eyebrow="Configuration & Storage"
        title="Settings"
        description="Company profile, payroll calculation divisor, payout rules, and offline backup guidance."
        actions={
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
            <Save className="h-4 w-4" />
            <span>Save Settings</span>
          </Button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        {/* Left column: Business configuration & Guide */}
        <div className="space-y-5">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-teal-600/15">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-extrabold text-stone-900">
                  Business & Payroll Parameters
                </div>
                <div className="text-xs text-stone-500">
                  Printed on vouchers and statements, and used in wage calculations.
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business / Company Name" className="sm:col-span-2">
                <Input
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  placeholder="e.g. Ramesh Textiles / હાજરી પગાર"
                />
              </Field>

              <Field
                label="First Cycle Start Date"
                hint="Used only before the very first payout is closed."
              >
                <Input
                  type="date"
                  value={firstCycleStart}
                  onChange={(event) => setFirstCycleStart(event.target.value)}
                />
              </Field>

              <Field
                label="Overtime Divisor (Hours)"
                hint="Shift hours used to calculate hourly overtime pay."
              >
                <Input
                  type="number"
                  min="1"
                  max="24"
                  step="0.5"
                  value={otDivisor}
                  onChange={(event) => setOtDivisor(event.target.value)}
                />
              </Field>

              <Field
                label="Language / ભાષા"
                hint="Display language across attendance, payouts, and reports."
                className="sm:col-span-2"
              >
                <Select
                  value={language}
                  onChange={(event) => setLangState(event.target.value as LanguageMode)}
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Expected Weekly Payout Day"
                hint="Reminder day for weekly settlements (dates remain editable)."
                className="sm:col-span-2"
              >
                <Select
                  value={payoutWeekday}
                  onChange={(event) => setPayoutWeekday(event.target.value)}
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="sm:col-span-2 rounded-2xl border border-stone-200 bg-stone-50 p-3.5 text-xs leading-relaxed text-stone-600">
                Formula: Overtime Pay = (Daily Rate ÷{' '}
                <span className="font-extrabold text-stone-900">{Number.parseFloat(otDivisor) || 8}</span>) × OT Hours.
                Rate changes apply prospectively from their effective date.
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-600/15">
                <Info className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-extrabold text-stone-900">
                  How The Payroll Ledger Operates
                </div>
                <div className="text-xs text-stone-500">
                  Quick rules and accounting conventions used in this system.
                </div>
              </div>
            </div>

            <div className="space-y-3.5 text-xs leading-relaxed text-stone-600 divide-y divide-stone-100">
              <p className="pt-2">
                <strong className="text-stone-900">Attendance:</strong> Blank means unrecorded (no pay). Full day = 1.0 day rate, Half day = 0.5 day rate, Absent = 0. Friday is an off-day by default; any work entered on Friday is paid.
              </p>
              <p className="pt-2">
                <strong className="text-stone-900">Payout Cycles:</strong> A new cycle automatically begins the day after the last closed payout. Closing a payout generates official salary statements and carries forward any unpaid balances.
              </p>
              <p className="pt-2">
                <strong className="text-stone-900">Upad (Advances):</strong> Advances are tracked in a dedicated ledger. Deductions during payout settlement reduce both salary due and outstanding upad. Cash handbacks directly reduce upad balance.
              </p>
              <p className="pt-2">
                <strong className="text-stone-900">Staff Deactivation:</strong> Workers are never deleted to preserve historical audits. Deactivating an employee closes their active period while keeping all ledgers intact.
              </p>
            </div>
          </Card>
        </div>

        {/* Right column: Local database & Backup */}
        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100 text-stone-700">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-extrabold text-stone-900">Local Database</div>
                <div className="text-xs text-stone-500">100% offline on this computer.</div>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-stone-500">Status</span>
                <Badge tone="green" dot>
                  Connected Localhost
                </Badge>
              </div>

              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Data Folder Location
                </div>
                <div className="mt-1 flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 p-2 font-mono text-[11px] text-stone-700">
                  <span className="truncate">C:\Site_imp\attendance-web\pb\pb_data</span>
                  <button
                    type="button"
                    onClick={copyPath}
                    className="ml-2 rounded p-1 hover:bg-stone-200 transition text-stone-500 hover:text-stone-800"
                    title="Copy path"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-stone-100 pt-3">
                <span className="text-stone-500">Staff Count</span>
                <span className="font-extrabold text-stone-900">
                  {activeCount} active / {employeesQuery.data?.length ?? 0} total
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-stone-500">Closed Payouts</span>
                <span className="font-extrabold text-stone-900">
                  {runsQuery.data?.length ?? 0} runs
                </span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-100 text-stone-700">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-extrabold text-stone-900">Backup & Recovery</div>
                <div className="text-xs text-stone-500">Simple manual offline backup.</div>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-stone-600">
              Your entire data is stored inside the <code className="font-bold text-stone-800 bg-stone-100 px-1 py-0.5 rounded">pb_data</code> folder. To back up, simply close the app and copy that folder to a USB pen drive.
            </p>

            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-xs leading-relaxed text-amber-900">
              <strong>Tip:</strong> Always close the application window before copying or replacing <code className="font-bold">pb_data</code>.
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>
          <Save className="h-4 w-4" />
          <span>Save Settings</span>
        </Button>
      </div>
    </div>
  )
}
