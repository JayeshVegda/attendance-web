import React, { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, Banknote, Calendar, HandCoins, Info, X } from 'lucide-react'
import { Button, Modal } from './ui'
import { useToast } from './Toast'
import {
  computePayout,
  type AdjustmentRow,
  type AttendanceRow,
  type DayStatus,
  type PayoutInputs,
  type PeriodRow,
  type RateRow,
  type UpadRow,
  type WorkerRef,
} from '../lib/engine'
import { formatDateLong, formatDateShort, parseDate } from '../lib/dates'
import { formatHours, formatMoney, paiseToInput, parseMoneyInput } from '../lib/money'
import { latestStatementByEmployee } from '../lib/payroll'
import { createUpadEntry } from '../lib/api'
import { isChaluUpadEnabled, isMotoUpadEnabled } from '../lib/cycle'
import { SettleModal, type SettleTarget } from './SettleModal'
import type {
  Adjustment,
  Attendance,
  CycleRow,
  EmploymentPeriod,
  RateHistory,
  Statement,
  UpadEntry,
} from '../lib/types'

export type RowInput = {
  recovery: string
  paid: string | null
  chaluRecovery?: string
  mainRecovery?: string
  newUpadAmount?: string
  newUpadBucket?: 'chalu' | 'moto'
}

export function WorkerCycleModal({
  open,
  onClose,
  row,
  cycleStart,
  payoutDate,
  attendance = [],
  upadEntries = [],
  rates = [],
  periods = [],
  statements = [],
  adjustments = [],
  settings,
  currentInput,
  onUpdateRowInput,
  onOpenUpad,
}: {
  open: boolean
  onClose: () => void
  row: CycleRow
  cycleStart: string
  payoutDate: string
  attendance?: Attendance[]
  upadEntries?: UpadEntry[]
  rates?: RateHistory[]
  periods?: EmploymentPeriod[]
  statements?: Statement[]
  adjustments?: Adjustment[]
  settings?: Record<string, string>
  currentInput: RowInput
  onUpdateRowInput: (patch: Partial<RowInput>) => void
  onOpenUpad: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [activePopoverDate, setActivePopoverDate] = useState<string | null>(null)
  const [settleTarget, setSettleTarget] = useState<SettleTarget | null>(null)

  const isChaluOn = isChaluUpadEnabled(settings)
  const isMotoOn = isMotoUpadEnabled(settings)
  const hasAnyUpad = isChaluOn || isMotoOn

  // Settlement Inputs
  const [chaluCut, setChaluCut] = useState(() => currentInput.chaluRecovery ?? currentInput.recovery ?? '')
  const [mainCut, setMainCut] = useState(() => currentInput.mainRecovery ?? '')
  const [salaryPaid, setSalaryPaid] = useState(() => currentInput.paid ?? '')
  const [newUpadAmount, setNewUpadAmount] = useState(() => currentInput.newUpadAmount ?? '')
  const [newUpadBucket, setNewUpadBucket] = useState<'chalu' | 'moto'>(
    () => currentInput.newUpadBucket ?? 'chalu',
  )

  // Engine Context Data
  const latestStatement = latestStatementByEmployee(statements).get(row.employee.id)
  const paidUpToDate = (latestStatement?.payout_date ?? '').slice(0, 10)
  const worker: WorkerRef = useMemo(
    () => ({
      id: row.employee.id,
      opening_carry_paise: latestStatement ? latestStatement.closing_paise : row.employee.opening_salary_paise ?? 0,
      opening_chalu_paise: row.employee.opening_chalu_paise ?? 0,
      opening_moto_paise: row.employee.opening_moto_paise ?? 0,
      opening_date: (row.employee.opening_date ?? row.employee.joined_on ?? '').slice(0, 10),
      daily_rate_paise: row.employee.daily_rate_paise,
    }),
    [row.employee, latestStatement],
  )

  const engineRates: RateRow[] = useMemo(
    () => rates.map((r) => ({ effective_from: r.effective_from, daily_rate_paise: r.daily_rate_paise })),
    [rates],
  )

  const enginePeriods: PeriodRow[] = useMemo(
    () => periods.map((p) => ({ start_date: (p.start_date ?? '').slice(0, 10), end_date: (p.end_date ?? '').slice(0, 10) })),
    [periods],
  )

  const engineAttendance: AttendanceRow[] = useMemo(
    () =>
      attendance.map((a) => ({
        id: a.id,
        employee: a.employee,
        date: (a.date ?? '').slice(0, 10),
        status: (a.status ?? '') as DayStatus,
        worked_minutes: a.worked_minutes,
        ot_minutes: a.ot_minutes ?? 0,
        settled: !!a.settled_payout,
      })),
    [attendance],
  )

  const engineAdjustments: AdjustmentRow[] = useMemo(
    () =>
      adjustments.map((a) => ({
        id: a.id,
        employee: a.employee,
        date: (a.date ?? '').slice(0, 10),
        kind: a.amount_paise >= 0 ? ('bonus' as const) : ('deduction' as const),
        amount_paise: Math.abs(a.amount_paise),
        settled: !!a.settled_payout,
      })),
    [adjustments],
  )

  const engineUpads: UpadRow[] = useMemo(
    () =>
      upadEntries.map((u) => ({
        id: u.id,
        employee: u.employee,
        date: (u.date ?? '').slice(0, 10),
        bucket: u.category === 'extra' || u.category === 'moto' ? 'moto' : 'chalu',
        kind: u.kind,
        amount_paise: u.amount_paise,
        voided: u.voided ?? false,
      })),
    [upadEntries],
  )

  const chaluCutPaise = parseMoneyInput(chaluCut)
  const mainCutPaise = parseMoneyInput(mainCut)
  const newUpadPaise = parseMoneyInput(newUpadAmount)
  const newChaluPaise = newUpadBucket === 'chalu' ? newUpadPaise : 0
  const newMotoPaise = newUpadBucket === 'moto' ? newUpadPaise : 0

  // 1. Initial compute with salary_paid_paise = 0 to get net payable
  const baseInputs: PayoutInputs = useMemo(
    () => ({
      chalu_recovery_paise: chaluCutPaise,
      moto_recovery_paise: mainCutPaise,
      new_chalu_given_paise: newChaluPaise,
      new_moto_given_paise: newMotoPaise,
      new_upad_given_paise: newUpadPaise,
      new_upad_bucket: newUpadBucket,
      salary_paid_paise: 0,
    }),
    [chaluCutPaise, mainCutPaise, newChaluPaise, newMotoPaise, newUpadPaise, newUpadBucket],
  )

  const baseOut = useMemo(
    () =>
      computePayout(
        worker,
        paidUpToDate,
        payoutDate,
        engineRates,
        enginePeriods,
        engineAttendance,
        engineAdjustments,
        engineUpads,
        baseInputs,
        { chalu_enabled: isChaluOn, moto_enabled: isMotoOn },
      ),
    [worker, paidUpToDate, payoutDate, engineRates, enginePeriods, engineAttendance, engineAdjustments, engineUpads, baseInputs],
  )

  const comp = baseOut.ok ? baseOut.result : null
  const netPayable = comp ? comp.payable_paise : 0
  const spPaise = salaryPaid.trim() === '' ? netPayable : parseMoneyInput(salaryPaid)

  // 2. Final compute with user-typed salary_paid_paise
  const finalInputs: PayoutInputs = useMemo(
    () => ({
      ...baseInputs,
      salary_paid_paise: spPaise,
    }),
    [baseInputs, spPaise],
  )

  const finalOut = useMemo(
    () =>
      computePayout(
        worker,
        paidUpToDate,
        payoutDate,
        engineRates,
        enginePeriods,
        engineAttendance,
        engineAdjustments,
        engineUpads,
        finalInputs,
        { chalu_enabled: isChaluOn, moto_enabled: isMotoOn },
      ),
    [worker, paidUpToDate, payoutDate, engineRates, enginePeriods, engineAttendance, engineAdjustments, engineUpads, finalInputs],
  )

  const finalComp = finalOut.ok ? finalOut.result : comp
  const allErrors = finalOut.ok ? [] : finalOut.errors

  // Inline Engine Errors
  const chaluError = allErrors.find((e) => e.code === 'chalu_recovery_exceeds_balance')
  const mainError = allErrors.find((e) => e.code === 'moto_recovery_exceeds_balance')
  const spError =
    allErrors.find((e) => e.code === 'salary_paid_out_of_range') ||
    (spPaise < 0 || spPaise > netPayable
      ? { code: 'salary_paid_out_of_range' as const, amount: Math.max(0, spPaise - netPayable) }
      : null)
  const newUpadError =
    allErrors.find((e) => e.code === 'new_upad_negative') ||
    (newUpadPaise < 0 ? { code: 'new_upad_negative' as const, amount: 0 } : null)

  const grossDue = finalComp ? finalComp.total_due_paise : row.totalDuePaise
  const chaluBal = finalComp ? finalComp.chalu_balance_paise : row.regularUpadPaise
  const motoBal = finalComp ? finalComp.moto_balance_paise : row.extraUpadPaise
  const cashToHandPaise = spPaise + newUpadPaise
  const closingCarryPaise = Math.max(0, netPayable - spPaise)
  const chaluLeftPaise = finalComp
    ? finalComp.chalu_after_paise
    : Math.max(0, chaluBal - chaluCutPaise + newChaluPaise)
  const motoLeftPaise = finalComp
    ? finalComp.moto_after_paise
    : Math.max(0, motoBal - mainCutPaise + newMotoPaise)

  // Section 1: Week Strip Data
  const dayBreakdown = finalComp?.day_breakdown ?? []
  const daysWorkedCount = dayBreakdown.reduce(
    (sum, d) => sum + (d.days_worked !== undefined ? d.days_worked : d.status === 'full' ? 1 : d.status === 'half' ? 0.5 : d.status === 'hours' ? ((d.worked_minutes ?? 0) / 480) : 0),
    0,
  )
  const totalOtMins = dayBreakdown.reduce((sum, d) => sum + d.ot_minutes, 0)
  const totalEarnedPaise = finalComp?.earned_paise ?? row.earnedPaise

  const selectedDayInfo = activePopoverDate
    ? dayBreakdown.find((d) => d.date === activePopoverDate)
    : null
  const selectedDayUpads = activePopoverDate
    ? upadEntries.filter((u) => (u.date ?? '').slice(0, 10) === activePopoverDate && !u.voided)
    : []

  async function handlePayWorker() {
    if (allErrors.length > 0) return
    setIsSaving(true)
    try {
      if (newUpadPaise > 0) {
        await createUpadEntry({
          employeeId: row.employee.id,
          date: payoutDate,
          kind: 'given',
          category: newUpadBucket === 'moto' ? 'extra' : 'regular',
          amountPaise: newUpadPaise,
          note: 'Advance given on payday (carry forward)',
        })
        queryClient.invalidateQueries({ queryKey: ['upad'] })
      }

      onUpdateRowInput({
        recovery: paiseToInput(chaluCutPaise + mainCutPaise),
        paid: salaryPaid.trim() === '' ? paiseToInput(netPayable) : salaryPaid,
        chaluRecovery: chaluCut,
        mainRecovery: mainCut,
        newUpadAmount: newUpadAmount,
        newUpadBucket: newUpadBucket,
      })
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      queryClient.invalidateQueries({ queryKey: ['employee-detail'] })
      toast(row.employee.active ? 'Worker payout input recorded' : 'Final payout recorded for inactive worker')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save payout', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={row.employee.name}
      description={`Worker #${row.employee.employee_no} · Daily Rate: ${formatMoney(row.employee.daily_rate_paise)}/day · Cycle: ${formatDateShort(cycleStart)} – ${formatDateShort(payoutDate)}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="ghost"
            onClick={onOpenUpad}
            className="text-amber-800 hover:bg-amber-50 font-bold text-xs flex items-center gap-1.5"
          >
            <HandCoins className="h-4 w-4 text-amber-700" />
            <span>Manage Upad Ledger</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
              className="text-xs font-semibold px-4"
            >
              Cancel
            </Button>
            <Button
              variant="emerald"
              size="sm"
              onClick={handlePayWorker}
              loading={isSaving}
              disabled={allErrors.length > 0}
              className="text-xs font-black bg-emerald-700 hover:bg-emerald-800 px-5 shadow-xs cursor-pointer"
            >
              {row.employee.active ? 'Save Worker Payout' : 'Final Payout (Inactive)'}
            </Button>
          </div>
        </div>
      }
    >
      <SettleModal target={settleTarget} onClose={() => setSettleTarget(null)} />
      <div className="space-y-4 text-stone-800 select-text">
        {/* Section 1 - WEEK STRIP */}
        <div className="rounded-2xl border border-stone-200 bg-white p-4 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-xs font-bold text-stone-800 uppercase tracking-wide flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-700" />
              <span>Cycle Attendance & Daily Earnings</span>
            </span>
            <span className="text-xs text-stone-500 font-medium">
              Click any day column to view details
            </span>
          </div>

          {/* Horizontal Week Strip */}
          <div className="flex items-stretch gap-2.5 overflow-x-auto pb-1.5 pt-0.5 no-scrollbar select-none">
            {dayBreakdown.map((d) => {
              const isFull = d.status === 'full'
              const isHalf = d.status === 'half'
              const isAbsent = d.status === 'absent'
              const isOff = !d.status
              const isHours = d.status === 'hours'
              const hoursText = isHours ? `${Number(((d.worked_minutes || 0) / 60).toFixed(1))}h` : ''
              const otHours = d.ot_minutes > 0 ? (d.ot_minutes % 60 === 0 ? `${d.ot_minutes / 60}h` : formatHours(d.ot_minutes)) : ''
              const statusLabel = isFull ? 'Present' : isHalf ? 'Half Day' : isAbsent ? 'Absent' : isHours ? `${hoursText} Worked` : 'Off'

              const dayDate = parseDate(d.date)
              const dayNum = isNaN(dayDate.getTime()) ? d.date.slice(8, 10) : dayDate.getDate()
              const monthName = isNaN(dayDate.getTime()) ? '' : dayDate.toLocaleString('en-US', { month: 'short' })
              const dayName = isNaN(dayDate.getTime()) ? '' : dayDate.toLocaleString('en-US', { weekday: 'short' })

              // Filter upads on this date
              const dayUpads = upadEntries.filter(
                (u) =>
                  (u.date ?? '').slice(0, 10) === d.date &&
                  !u.voided &&
                  ((isChaluOn && (u.category === 'chalu' || u.category === 'regular' || u.bucket === 'chalu')) ||
                    (isMotoOn && (u.category === 'moto' || u.category === 'extra' || u.bucket === 'moto'))),
              )
              const isSelected = activePopoverDate === d.date

              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setActivePopoverDate(isSelected ? null : d.date)}
                  className={clsx(
                    'flex-1 min-w-[96px] rounded-xl border p-2.5 text-center transition-all cursor-pointer flex flex-col justify-between min-h-[114px]',
                    isSelected
                      ? 'border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-50/70 shadow-xs'
                      : 'border-stone-200 bg-stone-50/60 hover:border-emerald-300 hover:bg-stone-50 shadow-2xs',
                  )}
                  title={`${d.date}: ${statusLabel}${otHours ? ` (+${otHours} OT)` : ''} · Earned ${formatMoney(d.total_paise)}`}
                >
                  {/* Date Header */}
                  <div className="flex items-center justify-between text-xs font-semibold text-stone-600 border-b border-stone-200/70 pb-1">
                    <span className="font-bold text-stone-800">{dayNum} {monthName}</span>
                    <span className="text-[11px] uppercase font-bold text-stone-400">
                      {dayName}
                    </span>
                  </div>

                  {/* Line 1: Attendance Mark with OT Badge */}
                  <div className="py-1">
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold leading-none shadow-2xs',
                        isFull && !otHours && 'bg-emerald-100/80 text-emerald-900 border border-emerald-300/80',
                        isFull && otHours && 'bg-emerald-100 text-emerald-950 border border-emerald-400/80',
                        isHalf && 'bg-amber-100/80 text-amber-900 border border-amber-300/80',
                        isAbsent && 'bg-rose-100/80 text-rose-900 border border-rose-300/80',
                        isHours && 'bg-sky-100 text-sky-950 border border-sky-300',
                        isOff && 'bg-stone-100 text-stone-600 border border-stone-200',
                      )}
                    >
                      <span>{isFull ? 'P' : isHalf ? 'H' : isAbsent ? 'A' : isHours ? hoursText : '—'}</span>
                      {otHours && <span className="font-black text-emerald-900">+{otHours}</span>}
                    </span>
                  </div>

                  {/* Line 2: Amount Earned that Day */}
                  <div className="text-xs font-bold text-stone-900 tabular-nums leading-none">
                    {d.total_paise > 0 ? formatMoney(d.total_paise) : '₹0'}
                  </div>

                  {/* Line 3: Small Chips for Upad Activity */}
                  <div className="flex flex-wrap items-center justify-center gap-1 pt-1 border-t border-stone-200/70 min-h-[18px]">
                    {dayUpads.length === 0 ? (
                      <span className="text-[10px] text-stone-400 font-medium">No Upad</span>
                    ) : (
                      dayUpads.slice(0, 2).map((u) => {
                        const isChalu = u.category === 'chalu' || u.category === 'regular'
                        const isGiven = u.kind === 'given'
                        const isReturned = u.kind === 'returned'
                        const sym = isChalu ? 'C' : 'M'
                        const amtStr = Math.round(u.amount_paise / 100)
                        return (
                          <span
                            key={u.id}
                            className={clsx(
                              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums border leading-none shadow-2xs',
                              isChalu
                                ? 'bg-amber-50 text-amber-900 border-amber-200'
                                : 'bg-purple-50 text-purple-900 border-purple-200',
                            )}
                          >
                            {isGiven ? <ArrowDown className="h-2.5 w-2.5 stroke-[2.5]" /> : isReturned ? <ArrowUp className="h-2.5 w-2.5 stroke-[2.5]" /> : null}
                            <span>₹{amtStr}</span>
                            <span className="opacity-70 font-semibold">{sym}</span>
                          </span>
                        )
                      })
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Caption Below Week Strip */}
          <div className="flex items-center justify-between text-xs font-medium text-stone-600 px-1 pt-1.5 border-t border-stone-200/80">
            <div className="flex items-center gap-2">
              <span className="text-stone-900 font-bold">
                {daysWorkedCount} Days Worked
              </span>
              <span className="text-stone-300">·</span>
              <span className="text-teal-900 font-bold">
                {formatHours(totalOtMins)} Overtime
              </span>
            </div>
            <div>
              <span className="text-stone-500">Total Cycle Wages: </span>
              <span className="text-stone-900 font-bold tabular-nums text-sm">{formatMoney(totalEarnedPaise)}</span>
            </div>
          </div>

          {/* Interactive Popover when a day is clicked */}
          {activePopoverDate && selectedDayInfo && (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50/90 p-3 text-xs space-y-2 relative shadow-sm">
              <button
                type="button"
                onClick={() => setActivePopoverDate(null)}
                className="absolute right-2 top-2 text-stone-400 hover:text-stone-800 p-0.5 rounded cursor-pointer"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="font-bold text-emerald-950 text-sm">
                {formatDateLong(selectedDayInfo.date)} · Status: {selectedDayInfo.status === 'full' ? 'Full Day' : selectedDayInfo.status === 'half' ? 'Half Day' : selectedDayInfo.status === 'absent' ? 'Absent' : 'Off'} · Earned: {formatMoney(selectedDayInfo.total_paise)}
              </div>
              <div className="text-xs text-stone-700">
                {selectedDayUpads.length === 0 ? (
                  <span className="text-stone-500 italic">No loan/advance records on this day.</span>
                ) : (
                  <div className="space-y-1.5">
                    {selectedDayUpads.map((u) => (
                      <div key={u.id} className="flex items-center gap-2">
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded text-xs font-bold uppercase tracking-tight',
                            u.category === 'extra' || u.category === 'moto'
                              ? 'bg-purple-100 text-purple-900 border border-purple-200'
                              : 'bg-amber-100 text-amber-900 border border-amber-200',
                          )}
                        >
                          {u.kind === 'given' ? 'Taken' : u.kind === 'returned' ? 'Returned' : 'Recovery'} · {u.category || 'Chalu'}
                        </span>
                        <span className="font-bold tabular-nums text-stone-900 text-xs">{formatMoney(u.amount_paise)}</span>
                        {u.note && <span className="text-stone-500 font-medium">({u.note})</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Section 2 - Financial Summary KPI Row */}
        <div className={clsx('grid gap-3', isChaluOn && isMotoOn ? 'grid-cols-3' : hasAnyUpad ? 'grid-cols-2' : 'grid-cols-1')}>
          <div className="rounded-xl border border-stone-200 bg-white p-3.5 shadow-2xs flex flex-col justify-between">
            <div className="text-xs font-semibold text-stone-600">
              Gross Due
            </div>
            <div className="my-1 text-2xl font-black text-stone-900 tabular-nums tracking-tight">
              {formatMoney(grossDue)}
            </div>
            <div className="text-xs text-stone-500 font-normal">
              Cycle Wages + Prior Carry
            </div>
          </div>

          {isChaluOn && (
            <div className="rounded-xl border border-stone-200 bg-white p-3.5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-600">
                  {isMotoOn ? 'Chalu Upad Balance' : 'Upad Balance'}
                </span>
                <div className="flex items-center gap-1.5">
                  {chaluBal > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setSettleTarget({
                          mode: 'single',
                          workerId: row.employee.id,
                          workerName: row.employee.name,
                          workerNo: row.employee.employee_no,
                          bucket: 'chalu',
                          balancePaise: chaluBal,
                        })
                      }
                      className="rounded bg-amber-100 hover:bg-amber-200 text-amber-900 px-1.5 py-0.5 text-[10px] font-bold cursor-pointer transition"
                      title="Settle or write off balance"
                    >
                      Settle
                    </button>
                  )}
                  {chaluBal > 0 && (
                    <span className="rounded bg-amber-50 text-amber-900 border border-amber-200/70 px-1.5 py-0.2 text-[10px] font-bold">
                      Active
                    </span>
                  )}
                </div>
              </div>
              <div className="my-1 text-2xl font-black text-amber-950 tabular-nums tracking-tight">
                {formatMoney(chaluBal)}
              </div>
              <div className="text-xs text-stone-500 font-normal">
                Current weekly advance
              </div>
            </div>
          )}

          {isMotoOn && (
            <div className="rounded-xl border border-stone-200 bg-white p-3.5 shadow-2xs flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-600">
                  {isChaluOn ? 'Main Loan Balance' : 'Loan Balance'}
                </span>
                <div className="flex items-center gap-1.5">
                  {motoBal > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setSettleTarget({
                          mode: 'single',
                          workerId: row.employee.id,
                          workerName: row.employee.name,
                          workerNo: row.employee.employee_no,
                          bucket: 'moto',
                          balancePaise: motoBal,
                        })
                      }
                      className="rounded bg-purple-100 hover:bg-purple-200 text-purple-900 px-1.5 py-0.5 text-[10px] font-bold cursor-pointer transition"
                      title="Settle or write off balance"
                    >
                      Settle
                    </button>
                  )}
                  {motoBal > 0 && (
                    <span className="rounded bg-purple-50 text-purple-900 border border-purple-200/70 px-1.5 py-0.2 text-[10px] font-bold">
                      Loan
                    </span>
                  )}
                </div>
              </div>
              <div className="my-1 text-2xl font-black text-purple-950 tabular-nums tracking-tight">
                {formatMoney(motoBal)}
              </div>
              <div className="text-xs text-stone-500 font-normal">
                Long-term loan account
              </div>
            </div>
          )}
        </div>

        {/* Section 3 - Settlement Inputs & Handover */}
        <div className="grid grid-cols-2 gap-3.5">
          {/* Left Column: Loan Deductions */}
          <div className="rounded-2xl border border-stone-200/90 bg-stone-50/70 p-4 space-y-3 shadow-2xs">
            <div className="text-xs font-bold uppercase tracking-wider text-stone-800 border-b border-stone-200/80 pb-2 flex justify-between items-center">
              <span>1. Loan Deductions</span>
              <span className="text-xs font-semibold text-stone-600 tabular-nums normal-case">
                Total Balance: <strong className="text-stone-900">{formatMoney(chaluBal + motoBal)}</strong>
              </span>
            </div>

{isChaluOn && (
            <div>
              <div className="flex items-center justify-between text-xs font-bold text-stone-800 mb-1.5">
                <span>{isMotoOn ? 'Chalu Loan Cut:' : 'Loan Cut:'}</span>
                <button
                  type="button"
                  onClick={() => setChaluCut(paiseToInput(Math.min(chaluBal, grossDue)))}
                  className="text-xs font-bold text-stone-700 hover:text-stone-900 hover:bg-stone-200/70 px-2 py-0.5 rounded-md border border-stone-300 bg-white cursor-pointer transition shadow-2xs"
                >
                  Max ({formatMoney(Math.min(chaluBal, grossDue))})
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400">₹</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={chaluCut}
                  onChange={(e) => setChaluCut(e.target.value)}
                  className="h-9 w-full rounded-lg border border-stone-300 bg-white pl-7 pr-3 text-right text-sm font-bold text-stone-900 tabular-nums focus:border-stone-500 focus:ring-1 focus:ring-stone-400 focus:outline-none shadow-2xs"
                />
              </div>
              {chaluError && (
                <p className="text-xs text-rose-600 font-bold mt-1">
                  Exceeds balance by {formatMoney(chaluError.amount)}
                </p>
              )}
            </div>
            )}

{isMotoOn && (
            <div>
              <div className="flex items-center justify-between text-xs font-bold text-stone-800 mb-1.5">
                <span>{isChaluOn ? 'Main Loan Cut:' : 'Loan Cut:'}</span>
                <button
                  type="button"
                  onClick={() => {
                    const maxVal = Math.min(motoBal, Math.max(0, grossDue - chaluCutPaise))
                    setMainCut(paiseToInput(maxVal))
                  }}
                  className="text-xs font-bold text-stone-700 hover:text-stone-900 hover:bg-stone-200/70 px-2 py-0.5 rounded-md border border-stone-300 bg-white cursor-pointer transition shadow-2xs"
                >
                  Max ({formatMoney(Math.min(motoBal, Math.max(0, grossDue - chaluCutPaise)))})
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400">₹</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={mainCut}
                  onChange={(e) => setMainCut(e.target.value)}
                  className="h-9 w-full rounded-lg border border-stone-300 bg-white pl-7 pr-3 text-right text-sm font-bold text-stone-900 tabular-nums focus:border-stone-500 focus:ring-1 focus:ring-stone-400 focus:outline-none shadow-2xs"
                />
              </div>
              {mainError && (
                <p className="text-xs text-rose-600 font-bold mt-1">
                  Exceeds balance by {formatMoney(mainError.amount)}
                </p>
              )}
            </div>
            )}
          </div>

          {/* Right Column: Salary Paid & Fresh Advance */}
          <div className="rounded-2xl border border-stone-200/90 bg-stone-50/70 p-4 space-y-3 shadow-2xs">
            <div className="text-xs font-bold uppercase tracking-wider text-stone-800 border-b border-stone-200/80 pb-2 flex justify-between items-center">
              <span>2. Cash Settlement</span>
              <span className="text-xs font-semibold text-emerald-800 tabular-nums normal-case">
                Net Payable: <strong className="text-emerald-900">{formatMoney(netPayable)}</strong>
              </span>
            </div>

            {/* Salary Paid */}
            <div>
              <div className="flex items-center justify-between text-xs font-bold text-stone-800 mb-1.5">
                <span>Salary Paid Out:</span>
                <button
                  type="button"
                  onClick={() => setSalaryPaid('')}
                  className="text-xs font-bold text-emerald-800 hover:bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-300 bg-white cursor-pointer transition shadow-2xs"
                >
                  Full ({formatMoney(netPayable)})
                </button>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400">₹</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={paiseToInput(netPayable) || 'Full Payable'}
                  value={salaryPaid}
                  onChange={(e) => setSalaryPaid(e.target.value)}
                  className="h-9 w-full rounded-lg border border-emerald-400 bg-white pl-7 pr-3 text-right text-sm font-bold text-stone-900 tabular-nums focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500 focus:outline-none shadow-2xs"
                />
              </div>
              {spError && (
                <p className="text-xs text-rose-600 font-bold mt-1">
                  Cannot exceed payable ({formatMoney(spError.amount)} short)
                </p>
              )}
            </div>

            {/* New Upad Advance */}
            <div>
              <div className="flex items-center justify-between text-xs font-bold text-stone-800 mb-1.5">
                <span>New Advance Given:</span>
                <div className="inline-flex rounded-md border border-stone-300 overflow-hidden text-xs font-bold shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setNewUpadBucket('chalu')}
                    className={clsx(
                      'px-2.5 py-0.5 transition cursor-pointer',
                      newUpadBucket === 'chalu'
                        ? 'bg-amber-600 text-white'
                        : 'bg-white text-stone-600 hover:bg-stone-50',
                    )}
                  >
                    Chalu
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewUpadBucket('moto')}
                    className={clsx(
                      'px-2.5 py-0.5 transition cursor-pointer border-l border-stone-200',
                      newUpadBucket === 'moto'
                        ? 'bg-purple-700 text-white'
                        : 'bg-white text-stone-600 hover:bg-stone-50',
                    )}
                  >
                    Main
                  </button>
                </div>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400">₹</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={newUpadAmount}
                  onChange={(e) => setNewUpadAmount(e.target.value)}
                  className="h-9 w-full rounded-lg border border-stone-300 bg-white pl-7 pr-3 text-right text-sm font-bold text-stone-900 tabular-nums focus:border-stone-500 focus:ring-1 focus:ring-stone-400 focus:outline-none shadow-2xs"
                />
              </div>
              {newUpadError && (
                <p className="text-xs text-rose-600 font-bold mt-1">
                  New advance cannot be negative
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Itemised Formula Line */}
        <div className="flex justify-center">
          <div className="rounded-full bg-stone-100/90 border border-stone-200 px-4 py-1 text-xs text-stone-600 font-medium tracking-tight">
            Gross {formatMoney(grossDue)}
            {chaluCutPaise > 0 ? ` − Chalu Cut ${formatMoney(chaluCutPaise)}` : ''}
            {mainCutPaise > 0 ? ` − Main Cut ${formatMoney(mainCutPaise)}` : ''}
            {newUpadPaise > 0 ? ` + New Advance ${formatMoney(newUpadPaise)}` : ''}
            {` = Net Cash ${formatMoney(cashToHandPaise)}`}
          </div>
        </div>

        {/* Hero Cash to Hand Card */}
        <div className="rounded-2xl bg-emerald-800 text-white p-4 flex items-center justify-between shadow-md">
          <div className="space-y-1">
            <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-200 flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              <span>CASH TO HAND</span>
            </div>
            <div className="text-xs text-emerald-100 font-medium">
              Salary: <strong>{formatMoney(spPaise)}</strong>
              {newUpadPaise > 0
                ? ` + Advance: ${formatMoney(newUpadPaise)} (${newUpadBucket === 'moto' ? 'Main' : 'Chalu'})`
                : ''}
            </div>
          </div>
          <div className="text-3xl font-black tabular-nums tracking-tight text-white">
            {formatMoney(cashToHandPaise)}
          </div>
        </div>

        {/* Carry Forward & Upad Debt Line */}
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-xs text-stone-600 font-medium flex items-center justify-between shadow-2xs">
          <div>
            <span className="text-stone-500">Carry Forward: </span>
            <strong className="text-stone-900 font-bold">{formatMoney(closingCarryPaise)}</strong>
            <span className="text-stone-400 text-xs ml-1">(unpaid salary)</span>
          </div>
          <div className="h-4 w-px bg-stone-300" />
          <div>
            <span className="text-stone-500">Total Upad Remaining: </span>
            <strong className="text-amber-900 font-extrabold">{formatMoney(chaluLeftPaise + motoLeftPaise)}</strong>
            <span className="text-stone-500 text-xs ml-1.5 font-medium">
              (Chalu: {formatMoney(chaluLeftPaise)}, Main: {formatMoney(motoLeftPaise)})
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}
