import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  Copy,
  Database,
  HardDrive,
  Info,
  Save,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import {
  getSettings,
  listEmployees,
  listRuns,
  saveSetting,
  BucketOutstandingBalanceError,
  type WorkerBalanceDetail,
} from '../lib/api'
import {
  DEFAULT_SETTINGS,
  isChaluUpadEnabled,
  isMotoUpadEnabled,
  isHoursAttendanceEnabled,
  hourStepMinutes as getHourStepMinutes,
} from '../lib/cycle'
import { pb } from '../lib/pb'
import { useToast } from '../components/Toast'
import { getLanguage, setLanguage, type LanguageMode } from '../lib/i18n'
import { formatMoney } from '../lib/money'
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
import { SettleModal, type SettleTarget } from '../components/SettleModal'

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

  // Feature 1 & 2 settings
  const [chaluUpadEnabled, setChaluUpadEnabled] = useState(true)
  const [motoUpadEnabled, setMotoUpadEnabled] = useState(true)
  const [chaluUpadLabel, setChaluUpadLabel] = useState('Chalu Upad')
  const [motoUpadLabel, setMotoUpadLabel] = useState('Main Upad')
  const [hoursAttendanceEnabled, setHoursAttendanceEnabled] = useState(true)
  const [hourStep, setHourStep] = useState('30')

  // Safety & Settle
  const [blockedBucketError, setBlockedBucketError] = useState<BucketOutstandingBalanceError | null>(null)
  const [settleTarget, setSettleTarget] = useState<SettleTarget | null>(null)

  useEffect(() => {
    if (!settingsQuery.data) return
    const s = settingsQuery.data
    setBusinessName(s.business_name ?? DEFAULT_SETTINGS.business_name)
    setFirstCycleStart(s.first_cycle_start ?? DEFAULT_SETTINGS.first_cycle_start)
    setOtDivisor(s.ot_divisor ?? DEFAULT_SETTINGS.ot_divisor)
    setPayoutWeekday(s.expected_payout_weekday ?? DEFAULT_SETTINGS.expected_payout_weekday)
    setChaluUpadEnabled(isChaluUpadEnabled(s))
    setMotoUpadEnabled(isMotoUpadEnabled(s))
    setChaluUpadLabel(s.chalu_upad_label ?? DEFAULT_SETTINGS.chalu_upad_label)
    setMotoUpadLabel(s.moto_upad_label ?? DEFAULT_SETTINGS.moto_upad_label)
    setHoursAttendanceEnabled(isHoursAttendanceEnabled(s))
    setHourStep(String(getHourStepMinutes(s)))
  }, [settingsQuery.data])

  const mutation = useMutation({
    mutationFn: async () => {
      setBlockedBucketError(null)
      setLanguage(language)

      // Service layer safety validation on saving bucket toggles
      await saveSetting('chalu_upad_enabled', String(chaluUpadEnabled))
      await saveSetting('moto_upad_enabled', String(motoUpadEnabled))
      await saveSetting('chalu_upad_label', chaluUpadLabel.trim() || 'Chalu Upad')
      await saveSetting('moto_upad_label', motoUpadLabel.trim() || 'Main Upad')
      await saveSetting('hours_attendance_enabled', String(hoursAttendanceEnabled))
      await saveSetting('hour_step_minutes', hourStep)

      await saveSetting('business_name', businessName.trim() || DEFAULT_SETTINGS.business_name)
      await saveSetting('first_cycle_start', firstCycleStart)
      await saveSetting('ot_divisor', String(Number.parseFloat(otDivisor) || 8))
      await saveSetting('expected_payout_weekday', payoutWeekday)
      await saveSetting('app_language', language)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['upad'] })
      toast('Settings saved successfully')
    },
    onError: (error) => {
      if (error instanceof BucketOutstandingBalanceError) {
        setBlockedBucketError(error)
        toast(error.message, 'error')
      } else {
        toast(error instanceof Error ? error.message : 'Could not save settings', 'error')
      }
    },
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

      {/* Safety Settle Modal for blocked bucket switches */}
      <SettleModal target={settleTarget} onClose={() => setSettleTarget(null)} />

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        {/* Left column: Business configuration & Guide */}
        <div className="space-y-5">
          {/* Outstanding Balance Blocker Alert */}
          {blockedBucketError && (
            <div className="rounded-2xl border-2 border-rose-300 bg-rose-50/90 p-4 space-y-3.5 shadow-xs animate-in fade-in">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-rose-200 text-rose-800 flex items-center justify-center shrink-0">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-black text-rose-950">
                    Cannot Turn Off {blockedBucketError.bucket === 'chalu' ? 'Chalu Upad' : 'Main Upad'}
                  </div>
                  <div className="text-xs text-rose-800 mt-1 leading-relaxed">
                    {blockedBucketError.workers.length} worker(s) have an outstanding balance totaling{' '}
                    <strong className="font-black text-rose-950">
                      {formatMoney(blockedBucketError.totalPaise)}
                    </strong>
                    . Per accounting safety rules, you cannot disable this bucket while money is still owed.
                  </div>
                </div>
              </div>

              {/* Worker List */}
              <div className="max-h-48 overflow-y-auto rounded-xl border border-rose-200 bg-white divide-y divide-rose-100 shadow-2xs">
                {blockedBucketError.workers.map((w) => (
                  <div key={w.id} className="flex items-center justify-between p-2.5 text-xs">
                    <div>
                      <span className="font-bold text-stone-900">{w.name}</span>{' '}
                      <span className="text-stone-400">#{w.employee_no}</span>
                      {!w.active && (
                        <span className="ml-1 text-[10px] text-stone-400 uppercase font-semibold">
                          (Inactive)
                        </span>
                      )}
                    </div>
                    <span className="font-black text-amber-700">{formatMoney(w.balance_paise)}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (blockedBucketError.bucket === 'chalu') setChaluUpadEnabled(true)
                    else setMotoUpadEnabled(true)
                    setBlockedBucketError(null)
                  }}
                >
                  Keep Enabled
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setSettleTarget({
                      mode: 'bulk',
                      bucket: blockedBucketError.bucket,
                      workers: blockedBucketError.workers,
                      onSuccessAll: async () => {
                        if (blockedBucketError.bucket === 'chalu') {
                          setChaluUpadEnabled(false)
                          await saveSetting('chalu_upad_enabled', 'false').catch(() => {})
                        } else {
                          setMotoUpadEnabled(false)
                          await saveSetting('moto_upad_enabled', 'false').catch(() => {})
                        }
                        setBlockedBucketError(null)
                        queryClient.invalidateQueries({ queryKey: ['settings'] })
                      },
                    })
                  }
                >
                  Settle these first ({blockedBucketError.workers.length})
                </Button>
              </div>
            </div>
          )}

          {/* Upad Feature Toggles Card */}
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-600/15">
                <Coins className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-extrabold text-stone-900">
                  Advance & Upad Settings
                </div>
                <div className="text-xs text-stone-500">
                  Control which advance buckets are active and customize their display labels.
                </div>
              </div>
            </div>

            <div className="divide-y divide-stone-100">
              {/* Chalu Upad Toggle & Name */}
              <div className="py-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="pr-4">
                    <div className="text-xs font-bold text-stone-900">
                      Chalu Upad (ચાલુ ઉપાડ - Weekly Current Advance)
                    </div>
                    <div className="text-[11px] text-stone-500 mt-0.5">
                      Short-term advance taken during the weekly cycle, settled in the regular payout.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChaluUpadEnabled(!chaluUpadEnabled)}
                    className="text-stone-700 hover:text-stone-900 transition cursor-pointer shrink-0"
                    title={chaluUpadEnabled ? 'Enabled. Click to disable' : 'Disabled. Click to enable'}
                  >
                    {chaluUpadEnabled ? (
                      <ToggleRight className="h-8 w-8 text-emerald-600" />
                    ) : (
                      <ToggleLeft className="h-8 w-8 text-stone-300" />
                    )}
                  </button>
                </div>
                {chaluUpadEnabled && (
                  <div className="pt-1 max-w-xs">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                      Display Label (Custom Name)
                    </label>
                    <Input
                      value={chaluUpadLabel}
                      onChange={(e) => setChaluUpadLabel(e.target.value)}
                      placeholder="Chalu Upad"
                      className="text-xs font-medium"
                    />
                  </div>
                )}
              </div>

              {/* Main Upad Toggle & Name */}
              <div className="py-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="pr-4">
                    <div className="text-xs font-bold text-stone-900">
                      Main Upad (મોટો ઉપાડ - Long-term Upad Account)
                    </div>
                    <div className="text-[11px] text-stone-500 mt-0.5">
                      Long-term advance tracked across cycles, recovered in fixed deductions.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMotoUpadEnabled(!motoUpadEnabled)}
                    className="text-stone-700 hover:text-stone-900 transition cursor-pointer shrink-0"
                    title={motoUpadEnabled ? 'Enabled. Click to disable' : 'Disabled. Click to enable'}
                  >
                    {motoUpadEnabled ? (
                      <ToggleRight className="h-8 w-8 text-emerald-600" />
                    ) : (
                      <ToggleLeft className="h-8 w-8 text-stone-300" />
                    )}
                  </button>
                </div>
                {motoUpadEnabled && (
                  <div className="pt-1 max-w-xs">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-500 mb-1">
                      Display Label (Custom Name)
                    </label>
                    <Input
                      value={motoUpadLabel}
                      onChange={(e) => setMotoUpadLabel(e.target.value)}
                      placeholder="Main Upad"
                      className="text-xs font-medium"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-600">
              <strong className="text-stone-800">No-Trace Rule:</strong> When only one bucket is enabled, the UI simplifies to a single upad without separate Chalu/Main labels. When both are OFF, advance tracking is completely hidden. Turning OFF is only allowed when all worker balances in that bucket are zero.
            </div>
          </Card>

          {/* Hours-Based Attendance Card */}
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700 ring-1 ring-sky-600/15">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <div className="text-base font-extrabold text-stone-900">
                  Hours-Based Attendance
                </div>
                <div className="text-xs text-stone-500">
                  Allow workers to log exact worked hours (1–7h) in roll call and cycle register.
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center justify-between sm:col-span-2 py-1">
                <div>
                  <div className="text-xs font-bold text-stone-900">
                    Enable Hours-based Days
                  </div>
                  <div className="text-[11px] text-stone-500 mt-0.5">
                    Allows entering fractional worked days (e.g. 3h) in Roll Call and Cycle Register.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHoursAttendanceEnabled(!hoursAttendanceEnabled)}
                  className="text-stone-700 hover:text-stone-900 transition cursor-pointer shrink-0"
                >
                  {hoursAttendanceEnabled ? (
                    <ToggleRight className="h-8 w-8 text-emerald-600" />
                  ) : (
                    <ToggleLeft className="h-8 w-8 text-stone-300" />
                  )}
                </button>
              </div>

              <Field
                label="Hour Step Setting"
                hint="Granularity for quick chips and validation."
              >
                <Select
                  value={hourStep}
                  onChange={(e) => setHourStep(e.target.value)}
                  disabled={!hoursAttendanceEnabled}
                >
                  <option value="30">30 minutes (0.5h step — Default)</option>
                  <option value="60">60 minutes (1h step)</option>
                </Select>
              </Field>

              <div className="sm:col-span-2 rounded-2xl border border-stone-200 bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-600">
                <strong className="text-stone-800">One Definition of a Day:</strong> Full day minutes = Shift Hours × 60 ({Number.parseFloat(otDivisor) || 8}h = {(Number.parseFloat(otDivisor) || 8) * 60} min). Pay for hours = Daily Rate × Worked Minutes ÷ Full Day Minutes. Half Day = {((Number.parseFloat(otDivisor) || 8) * 60) / 2} min (50% pay).
              </div>
            </div>
          </Card>

          {/* Business & Payroll Parameters Card */}
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
                label="Full Day Shift / OT Divisor (Hours)"
                hint="Hours per full day (OT and hours pay derive from this)."
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
                <strong className="text-stone-900">Attendance:</strong> Blank means unrecorded (no pay). Full day = 1.0 day rate, Half day = 0.5 day rate, Absent = 0. Worked hours (1–7h) credit exact worked minutes / full-day minutes. Friday is an off-day by default; work marked on Friday is paid.
              </p>
              <p className="pt-2">
                <strong className="text-stone-900">Payout Cycles:</strong> A new cycle automatically begins the day after the last closed payout. Closing a payout generates official salary statements and carries forward any unpaid balances.
              </p>
              <p className="pt-2">
                <strong className="text-stone-900">Upad (Advances):</strong> Advances are tracked in a dedicated ledger. Deductions during payout settlement reduce both salary due and outstanding upad. Cash repayments or write-offs directly reduce upad balance.
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
                <div className="text-sm font-extrabold text-stone-900">Local Database</div>
                <div className="text-xs text-stone-500">Embedded PocketBase engine</div>
              </div>
            </div>

            <div className="mt-4 space-y-2.5 rounded-2xl bg-stone-50 p-3.5 text-xs text-stone-600">
              <div className="flex justify-between">
                <span>Active Workers:</span>
                <span className="font-extrabold text-stone-900">{activeCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Employees:</span>
                <span className="font-extrabold text-stone-900">
                  {employeesQuery.data?.length ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Closed Payouts:</span>
                <span className="font-extrabold text-stone-900">
                  {(runsQuery.data ?? []).filter((run) => run.status === 'closed').length}
                </span>
              </div>
              <div className="flex justify-between border-t border-stone-200/80 pt-2 text-[11px] text-stone-500">
                <span>Database Engine:</span>
                <span className="font-mono font-bold text-stone-700">PocketBase v0.24</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-extrabold text-stone-900">Zero-Cloud Backup</div>
                <div className="text-xs text-stone-500">100% Offline local storage</div>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-stone-600">
              All attendance records, salary statements, and advances reside directly on this PC
              inside the local folder:
            </p>

            <div className="mt-2.5 rounded-xl border border-stone-200 bg-stone-100 p-2 font-mono text-[11px] text-stone-800 break-all">
              C:\Site_imp\attendance-web\pb\pb_data
            </div>

            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={copyPath}>
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Path Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy Storage Path</span>
                </>
              )}
            </Button>

            <div className="mt-3 text-[11px] text-stone-500 leading-relaxed">
              To backup, simply copy the <code className="text-stone-700 font-bold">pb_data</code>{' '}
              folder to a pen drive or external hard disk.
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
