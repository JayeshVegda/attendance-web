import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, Clock3, Languages, RotateCcw } from 'lucide-react'
import { getSettings, saveSettings } from '../lib/attendance-service'
import { setLanguage, tx, useLanguage, type LanguageMode } from '../lib/i18n'

export default function SettingsPage() {
  useLanguage()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const [shiftHours, setShiftHours] = useState('8')
  const [otMultiplier, setOtMultiplier] = useState('1')
  const [companyName, setCompanyName] = useState('Kapil Products')
  const [language, setLocalLanguage] = useState<LanguageMode>('en')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (query.data) {
      setShiftHours(String(query.data.shift_hours))
      setOtMultiplier(String(query.data.ot_multiplier))
      setCompanyName(query.data.company_name)
      setLocalLanguage(query.data.language)
    }
  }, [query.data])

  const mutation = useMutation({
    mutationFn: () =>
      saveSettings({
        shift_hours: Number(shiftHours),
        ot_multiplier: Number(otMultiplier),
        company_name: companyName.trim() || 'Kapil Products',
        language,
      }),
    onSuccess: () => {
      setLanguage(language)
      setSaved(true)
      void qc.invalidateQueries({ queryKey: ['settings'] })
      void qc.invalidateQueries({ queryKey: ['attendance-data'] })
      window.setTimeout(() => setSaved(false), 2500)
    },
  })

  if (query.isLoading) {
    return <div role="status" aria-live="polite" className="p-8 text-center text-xs font-semibold text-stone-500">{tx("Loading settings…")}</div>
  }
  if (query.isError || !query.data) {
    return <div role="alert" aria-live="assertive" className="p-4 text-xs font-bold text-rose-700">{tx("Could not load settings from database.")}</div>
  }

  const isValid =
    Number(shiftHours) > 0 &&
    Number(shiftHours) <= 24 &&
    Number(otMultiplier) >= 0 &&
    Number(otMultiplier) <= 10 &&
    Boolean(companyName.trim()) &&
    (language === 'en' || language === 'gu')

  return (
    <div className="mx-auto max-w-2xl space-y-3.5">
      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-xs">
        <h1 className="text-sm font-black text-stone-900">{tx("Application Settings")}</h1>
        <p className="mt-0.5 text-xs text-stone-500">
          {tx("Global payroll formulas and business details. Changes recalculate all open cycles immediately without affecting historical statements.")}
        </p>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-xs space-y-4">
        {/* Workday Calculation */}
        <div>
          <div className="flex items-center gap-2 text-xs font-black text-stone-900">
            <Clock3 className="h-4 w-4 text-emerald-700" />
            {tx("Workday & Overtime Calculation")}
          </div>
          <p className="mt-0.5 text-[11px] text-stone-400">
            {tx("Shift hours determine the hourly wage rate (daily rate / shift hours). Overtime multiplier applies to OT hours.")}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] font-bold text-stone-700">
              {tx("Shift Hours (1 full day)")}
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                value={shiftHours}
                onChange={(e) => setShiftHours(e.target.value)}
                className="mt-1 h-8 w-full rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-bold outline-none focus:border-emerald-600"
              />
              <span className="mt-1 block text-[10px] text-stone-400">{tx("Standard factory shift (e.g. 8 or 12 hours)")}</span>
            </label>

            <label className="text-[11px] font-bold text-stone-700">
              {tx("Overtime Multiplier")}
              <input
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={otMultiplier}
                onChange={(e) => setOtMultiplier(e.target.value)}
                className="mt-1 h-8 w-full rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-bold outline-none focus:border-emerald-600"
              />
              <span className="mt-1 block text-[10px] text-stone-400">{tx("e.g. 1.0 (standard rate) or 1.5 (150%)")}</span>
            </label>
          </div>
        </div>

        {/* Company Identity */}
        <div className="border-t border-stone-100 pt-3.5">
          <div className="flex items-center gap-2 text-xs font-black text-stone-900">
            <Building2 className="h-4 w-4 text-sky-700" />
            {tx("Company Identity")}
          </div>
          <p className="mt-0.5 text-[11px] text-stone-400">{tx("Displayed on the sidebar header and payroll reports.")}</p>

          <label className="mt-3 block text-[11px] font-bold text-stone-700">
            {tx("Company Name")}
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={tx("e.g. Kapil Products")}
              className="mt-1 h-8 w-full rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-bold outline-none focus:border-emerald-600"
            />
          </label>
        </div>

        <div className="border-t border-stone-100 pt-3.5">
          <div className="flex items-center gap-2 text-xs font-black text-stone-900">
            <Languages className="h-4 w-4 text-emerald-700" />
            {tx("Interface Language")}
          </div>
          <label className="mt-3 block text-[11px] font-bold text-stone-700">
            {tx("Language")}
            <select
              value={language}
              onChange={(event) => setLocalLanguage(event.target.value as LanguageMode)}
              className="mt-1 h-9 w-full rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-bold outline-none focus:border-emerald-600"
            >
              <option value="en">English</option>
              <option value="gu">ગુજરાતી</option>
            </select>
          </label>
          <p className="mt-1 text-[10px] text-stone-400">{tx("The interface language switches immediately after saving.")}</p>
        </div>

        {/* Save Bar */}
        <div className="flex items-center justify-between border-t border-stone-100 pt-3">
          <div className="text-xs font-bold">
            {saved && (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <Check className="h-3.5 w-3.5" /> {tx("Settings saved successfully.")}
              </span>
            )}
            {mutation.isError && (
              <span className="text-rose-700">{mutation.error.message}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (query.data) {
                  setShiftHours(String(query.data.shift_hours))
                  setOtMultiplier(String(query.data.ot_multiplier))
                  setCompanyName(query.data.company_name)
                  setLocalLanguage(query.data.language)
                }
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 text-xs font-bold text-stone-700 hover:bg-stone-50"
            >
              <RotateCcw className="h-3 w-3" />
              {tx("Reset")}
            </button>
            <button
              type="button"
              disabled={!isValid || mutation.isPending}
              onClick={() => mutation.mutate()}
              className="inline-flex h-8 items-center rounded-lg bg-emerald-700 px-4 text-xs font-black text-white shadow-xs hover:bg-emerald-800 disabled:opacity-50"
            >
              {mutation.isPending ? tx('Saving…') : tx('Save Settings')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
