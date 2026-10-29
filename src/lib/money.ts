export function rupeesToPaise(value: number | string): number {
  const amount = typeof value === 'number' ? value : Number.parseFloat(value.replace(/,/g, ''))
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100)
}

export function paiseToRupees(value: number): number {
  return Math.round(value) / 100
}

export function formatMoney(paise: number, options?: { showZero?: boolean }): string {
  if (!options?.showZero && paise === 0) return '₹0'
  const value = Math.round(paise) / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value)
}

export function parseMoneyInput(value: string): number {
  return rupeesToPaise(value)
}

export function paiseToInput(paise: number): string {
  if (paise === 0) return ''
  const value = paise / 100
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

export function formatHours(minutes: number): string {
  if (!minutes) return '0h'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!rest) return `${hours}h`
  return `${hours}h ${rest}m`
}
