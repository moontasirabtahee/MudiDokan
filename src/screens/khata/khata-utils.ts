import type { CustomerDue } from '@/lib/database.types'
import { matchesSearch, searchRank } from '@/lib/utils'

export type KhataTab = 'all' | 'due' | 'over_limit' | 'aging_7' | 'aging_15' | 'aging_30' | 'aging_60'

export type AgingBucket = 'current' | 'd7' | 'd15' | 'd30' | 'd60plus'

export interface KhataSummary {
  totalDue: number
  debtorCount: number
  totalCustomers: number
  overLimitCount: number
  agingCounts: {
    current: number
    d7: number
    d15: number
    d30: number
    d60plus: number
  }
}

/**
 * Classifies a debt by how many days since the last payment or credit entry.
 */
export function agingCategory(days: number | null | undefined): AgingBucket {
  if (days == null || days < 7) return 'current'
  if (days < 15) return 'd7'
  if (days < 30) return 'd15'
  if (days < 60) return 'd30'
  return 'd60plus'
}

/**
 * Returns a color tone for displaying the aging status.
 */
export function agingTone(days: number | null | undefined): 'neutral' | 'warn' | 'danger' {
  if (days == null || days < 7) return 'neutral'
  if (days < 30) return 'warn'
  return 'danger'
}

/**
 * Computes aggregate summary numbers for the Khata header card.
 */
export function calculateKhataSummary(customers: CustomerDue[]): KhataSummary {
  let totalDue = 0
  let debtorCount = 0
  let overLimitCount = 0
  const agingCounts = {
    current: 0,
    d7: 0,
    d15: 0,
    d30: 0,
    d60plus: 0,
  }

  for (const c of customers) {
    if (c.due_balance > 0) {
      totalDue += c.due_balance
      debtorCount += 1

      if (c.over_limit) {
        overLimitCount += 1
      }

      const bucket = agingCategory(c.days_since_payment)
      agingCounts[bucket] += 1
    }
  }

  return {
    totalDue: Math.round(totalDue * 100) / 100,
    debtorCount,
    totalCustomers: customers.length,
    overLimitCount,
    agingCounts,
  }
}

/**
 * Filters and ranks customers according to the active tab and search query.
 */
export function filterCustomers(
  customers: CustomerDue[],
  tab: KhataTab,
  query: string,
): CustomerDue[] {
  let list = customers

  // Tab filter
  if (tab === 'due') {
    list = list.filter((c) => c.due_balance > 0)
  } else if (tab === 'over_limit') {
    list = list.filter((c) => c.over_limit)
  } else if (tab === 'aging_7') {
    list = list.filter((c) => c.due_balance > 0 && (c.days_since_payment ?? 0) >= 7)
  } else if (tab === 'aging_15') {
    list = list.filter((c) => c.due_balance > 0 && (c.days_since_payment ?? 0) >= 15)
  } else if (tab === 'aging_30') {
    list = list.filter((c) => c.due_balance > 0 && (c.days_since_payment ?? 0) >= 30)
  } else if (tab === 'aging_60') {
    list = list.filter((c) => c.due_balance > 0 && (c.days_since_payment ?? 0) >= 60)
  }

  // Text search
  const trimmed = query.trim()
  if (!trimmed) {
    return list
  }

  return list
    .filter((c) => matchesSearch(trimmed, c.name, c.phone, c.address))
    .slice()
    .sort((a, b) => searchRank(trimmed, a.name, a.phone) - searchRank(trimmed, b.name, b.phone))
}

/**
 * Calculates remaining due after a prospective payment and optional discount.
 */
export function remainingDueAfterPayment(
  currentDue: number,
  paymentAmount: number,
  discount = 0,
): number {
  const remaining = currentDue - (paymentAmount + discount)
  return Math.round(remaining * 100) / 100
}

/**
 * Returns whether a customer is over their credit limit.
 */
export function isOverLimit(dueBalance: number, creditLimit: number): boolean {
  return creditLimit > 0 && dueBalance > creditLimit
}
