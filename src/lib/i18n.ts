import { useEffect, useState } from 'react'

/**
 * Language support for Gujarati, English, and Mixed labels.
 * Mixed is the default factory setting in Gujarat diamond / textile / manufacturing units.
 */

export type LanguageMode = 'mixed' | 'gu' | 'en'

const STORAGE_KEY = 'hajri_pagar_lang'

export function getLanguage(): LanguageMode {
  if (typeof window === 'undefined') return 'mixed'
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'gu' || saved === 'en' || saved === 'mixed') return saved
  return 'mixed'
}

export function setLanguage(lang: LanguageMode): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, lang)
  window.dispatchEvent(new Event('languagechange'))
}

export function useLanguage(): [LanguageMode, (l: LanguageMode) => void] {
  const [lang, setLangState] = useState<LanguageMode>(getLanguage)
  useEffect(() => {
    const handler = () => setLangState(getLanguage())
    window.addEventListener('languagechange', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('languagechange', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])
  const setLang = (newLang: LanguageMode) => {
    setLanguage(newLang)
    setLangState(newLang)
  }
  return [lang, setLang]
}

export const STRINGS = {
  // Navigation & App headers
  app_name: {
    mixed: 'હાજરી પગાર (Attendance & Payroll)',
    gu: 'હાજરી પગાર',
    en: 'Hajri Pagar Payroll',
  },
  nav_attendance: {
    mixed: 'હાજરી (Attendance)',
    gu: 'હાજરી',
    en: 'Attendance',
  },
  nav_payout: {
    mixed: 'પગાર ચૂકવણી (Issue Payout)',
    gu: 'પગાર ચૂકવણી',
    en: 'Issue Payout',
  },
  nav_employees: {
    mixed: 'કારીગરો (Workers)',
    gu: 'કારીગરો',
    en: 'Workers',
  },
  nav_upad: {
    mixed: 'ઉપાડ (Upad)',
    gu: 'ઉપાડ ખાતું',
    en: 'Advances (Upad)',
  },
  nav_reports: {
    mixed: 'રિપોર્ટ્સ (Reports)',
    gu: 'હિસાબ ચોપડો',
    en: 'Reports & Statements',
  },
  nav_settings: {
    mixed: 'સેટિંગ્સ (Settings)',
    gu: 'સેટિંગ્સ',
    en: 'Settings',
  },

  // Attendance & Roll Call
  roll_call: {
    mixed: "આજની હાજરી (Today's Roll Call)",
    gu: 'આજની હાજરી',
    en: "Today's Roll Call",
  },
  attendance_register: {
    mixed: 'હાજરી પત્રક (Cycle Register)',
    gu: 'હાજરી પત્રક',
    en: 'Attendance Register',
  },
  present: {
    mixed: 'હાજર (Present)',
    gu: 'હાજર',
    en: 'Present',
  },
  half_day: {
    mixed: 'અડધો દિવસ (Half)',
    gu: 'અડધો દિવસ',
    en: 'Half Day',
  },
  absent: {
    mixed: 'ગેરહાજર (Absent)',
    gu: 'ગેરહાજર',
    en: 'Absent',
  },
  overtime: {
    mixed: 'ઓવરટાઇમ (OT)',
    gu: 'ઓવરટાઇમ',
    en: 'Overtime',
  },
  mark_all_present: {
    mixed: 'બધાને હાજર કરો (Mark All Present)',
    gu: 'બધાને હાજર કરો',
    en: 'Mark All Present',
  },
  clear_today: {
    mixed: 'આજની હાજરી ભૂંસો (Clear Today)',
    gu: 'આજની હાજરી ભૂંસો',
    en: 'Clear Today',
  },
  unmarked: {
    mixed: 'બાકી હાજરી (Unmarked)',
    gu: 'બાકી હાજરી',
    en: 'Unmarked',
  },
  step1_title: {
    mixed: 'પગલું ૧: હાજરી ચકાસો (Step 1: Check Attendance)',
    gu: 'પગલું ૧: હાજરી ચકાસો',
    en: 'Step 1: Check Attendance',
  },
  step2_title: {
    mixed: 'પગલું ૨: પગાર ચૂકવણી (Step 2: Issue Payout)',
    gu: 'પગલું ૨: પગાર ચૂકવણી',
    en: 'Step 2: Issue Payout',
  },

  // Upad buckets
  chalu_upad: {
    mixed: 'ચાલુ ઉપાડ (Chalu Upad)',
    gu: 'ચાલુ ઉપાડ',
    en: 'Chalu Upad (Small)',
  },
  moto_upad: {
    mixed: 'મોટો ઉપાડ (Main Upad)',
    gu: 'મોટો ઉપાડ',
    en: 'Main Upad (Large)',
  },
  upad_recovery: {
    mixed: 'ઉપાડ કપાત (Upad Recovery)',
    gu: 'ઉપાડ કપાત',
    en: 'Upad Recovery',
  },
  cash_return: {
    mixed: 'જમા રોકડ (Cash Return)',
    gu: 'જમા રોકડ',
    en: 'Cash Return',
  },
  write_off: {
    mixed: 'માંડવાળ (Write-off)',
    gu: 'માંડવાળ',
    en: 'Write-off',
  },

  // Salary & Payout
  salary_earned: {
    mixed: 'કમાયેલ પગાર (Earned Salary)',
    gu: 'કમાયેલ પગાર',
    en: 'Earned Salary',
  },
  carry_forward: {
    mixed: 'જૂની બાકી (Carry in)',
    gu: 'જૂની બાકી',
    en: 'Carry Forward',
  },
  bonus: {
    mixed: 'બોનસ (Bonus)',
    gu: 'બોનસ',
    en: 'Bonus',
  },
  fine: {
    mixed: 'કપાત/દંડ (Fine/Deduction)',
    gu: 'કપાત / દંડ',
    en: 'Deduction',
  },
  total_due: {
    mixed: 'કુલ લેણી રકમ (Total Due)',
    gu: 'કુલ લેણી રકમ',
    en: 'Total Due',
  },
  owed_now: {
    mixed: 'હાલ લેણી રકમ (Owed Now)',
    gu: 'હાલ લેણી રકમ',
    en: 'Owed Now',
  },
  payable: {
    mixed: 'ચૂકવવાપાત્ર (Payable)',
    gu: 'ચૂકવવાપાત્ર',
    en: 'Net Payable',
  },
  cash_to_hand: {
    mixed: 'હાથમાં આપવાની રોકડ (Cash to Hand Over)',
    gu: 'હાથમાં આપવાની રોકડ',
    en: 'Cash to Hand Over',
  },
  cash_needed_today: {
    mixed: 'આજે જોઈતી કુલ રોકડ (Cash Needed Today)',
    gu: 'આજે જોઈતી કુલ રોકડ',
    en: 'Cash Needed Today',
  },
  pay_worker: {
    mixed: 'પગાર ચૂકવો (Pay)',
    gu: 'પગાર ચૂકવો',
    en: 'Pay',
  },
  pay_now: {
    mixed: 'હમણાં ચૂકવો (Pay Now)',
    gu: 'હમણાં ચૂકવો',
    en: 'Pay Now',
  },
  paid_done: {
    mixed: 'ચૂકવાઈ ગયું (Paid ✓)',
    gu: 'ચૂકવાઈ ગયું ✓',
    en: 'Paid ✓',
  },
  undo: {
    mixed: 'પાછું ખેંચો (Undo)',
    gu: 'પાછું ખેંચો',
    en: 'Undo',
  },
  settled: {
    mixed: 'હિસાબ પૂર્ણ (Settled)',
    gu: 'હિસાબ પૂર્ણ',
    en: 'Settled',
  },
  final_settlement: {
    mixed: 'આખરી હિસાબ (Final Settlement)',
    gu: 'આખરી હિસાબ',
    en: 'Final Settlement',
  },
  denominations: {
    mixed: 'નોટોની ગણતરી (Denominations)',
    gu: 'નોટોની ગણતરી',
    en: 'Denomination Breakdown',
  },
} as const

export type TranslationKey = keyof typeof STRINGS

export function t(key: TranslationKey, lang?: LanguageMode): string {
  const active = lang ?? getLanguage()
  const entry = STRINGS[key]
  if (!entry) return key
  return entry[active] ?? entry.mixed
}

