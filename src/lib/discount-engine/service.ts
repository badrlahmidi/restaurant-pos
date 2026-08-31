import { Tables } from '@/api/db/tables.ts'
import type { Discount } from '@/api/model/discount.ts'
import type { OrderDiscount } from '@/api/model/order_discount.ts'
import type { AppliedDiscountLine } from '@/lib/discount-engine/types.ts'
import { nowSurrealDateTime } from '@/lib/datetime.ts'
import type { useDB } from '@/api/db/db.ts'
import type { User } from '@/api/model/user.ts'
import {toRecordId} from "@/lib/utils.ts";
import { toTargetId } from '@/lib/discount-engine/target-ids.ts'
import { nanoid } from 'nanoid'
import { runWriteTransaction, type TxStatement } from '@/lib/db-transaction.ts'

export type DbClient = ReturnType<typeof useDB>

const dedupeAppliedLines = (lines: AppliedDiscountLine[]): AppliedDiscountLine[] => {
  const seen = new Set<string>()
  return lines.filter(line => {
    const key = `${toTargetId(line.discountId)}:${(line.lineAllocations || []).map(l => toTargetId(l.orderItemId)).join(',')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Delete every order_discount for an order, then insert the new set.
 * History lives in the tracking/log table — do not soft-delete with removed_at.
 *
 * Clears order.order_discounts before DELETE so live/list refetches never FETCH
 * stale junction IDs that were already removed (that produced undefined entries
 * and blanked order totals UI).
 */
export const persistOrderDiscounts = async (
  db: DbClient,
  orderId: string,
  lines: AppliedDiscountLine[],
  user?: User,
  _existingIds?: string[]
): Promise<OrderDiscount[]> => {
  const orderRecordId = toRecordId(orderId)
  const now = nowSurrealDateTime()
  const uniqueLines = dedupeAppliedLines(lines)

  const newIds = uniqueLines.map(() => `${Tables.order_discounts}:${nanoid()}`)
  const payloads = uniqueLines.map(line => ({
    order: orderRecordId,
    discount: toRecordId(toTargetId(line.discountId) || line.discountId),
    name: line.name,
    scope: line.scope,
    value_type: line.valueType,
    applied_amount: line.appliedAmount,
    applied_rate: line.appliedRate ?? null,
    base_amount: line.appliedAmount,
    tax_treatment: line.taxTreatment,
    application_type: line.applicationType,
    reason: toRecordId(line.reasonId || null),
    reason_text: line.reasonText || null,
    applied_by: toRecordId(user?.id || null),
    order_items: line.lineAllocations?.map(l => toRecordId(l.orderItemId)) || [],
    line_allocations: line.lineAllocations?.map(l => ({
      order_item: toRecordId(l.orderItemId),
      amount: l.amount,
    })) || [],
    created_at: now,
  }))

  // One transaction: drop the old order_discounts, write the new set, and
  // re-point the order's denorm array. A concurrent FETCH sees the old set or
  // the new one, never a half-cleared gap — and a dropped connection can't
  // leave the order pointing at rows that were deleted but not replaced.
  const statements: TxStatement[] = [
    {
      sql: `UPDATE $od_order MERGE { order_discounts: [] }`,
      vars: { od_order: orderRecordId },
    },
    {
      sql: `DELETE ${Tables.order_discounts} WHERE order = $od_order`,
    },
  ]

  payloads.forEach((payload, index) => {
    statements.push({
      sql: `CREATE $od_new_${index} CONTENT $od_data_${index}`,
      vars: {
        [`od_new_${index}`]: toRecordId(newIds[index]),
        [`od_data_${index}`]: payload,
      },
    })
  })

  statements.push({
    sql: `UPDATE $od_order MERGE $od_denorm`,
    vars: { od_denorm: { order_discounts: newIds.map(id => toRecordId(id)) } },
  })

  await runWriteTransaction(db, statements)

  return uniqueLines.map((_, index) => ({
    ...payloads[index],
    id: toRecordId(newIds[index]),
  })) as unknown as OrderDiscount[]
}

export const loadActiveOrderDiscounts = async (
  db: DbClient,
  orderId: string
): Promise<OrderDiscount[]> => {
  const result = await db.query<[OrderDiscount[]]>(
    `SELECT * FROM ${Tables.order_discounts}
     WHERE order = $orderId AND (removed_at = NONE OR removed_at = null)
     FETCH discount, reason, applied_by`,
    { orderId: toRecordId(orderId) }
  )
  return result?.[0] ?? []
}

export const syncOrderDiscountDenorm = async (
  db: DbClient,
  orderId: string,
  lines: AppliedDiscountLine[],
): Promise<void> => {
  const total = lines.reduce((s, l) => s + l.appliedAmount, 0)
  const primaryRate = lines[0]?.appliedRate ?? 0

  await db.merge(orderId, {
    discount_amount: total,
    discount_rate: primaryRate,
    discount: lines[0]?.discountId ? toRecordId(toTargetId(lines[0].discountId)) : null,
  })
}

export const loadActiveDiscountRules = async (db: DbClient): Promise<Discount[]> => {
  const result = await db.query<[Discount[]]>(
    `SELECT * FROM ${Tables.discounts} WHERE deleted_at = none AND is_active != false ORDER BY priority ASC`
  )
  return result?.[0] ?? []
}
