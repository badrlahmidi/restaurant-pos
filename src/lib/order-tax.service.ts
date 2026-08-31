import { Tables } from '@/api/db/tables.ts';
import type { useDB } from '@/api/db/db.ts';
import type { Order } from '@/api/model/order.ts';
import type { Tax } from '@/api/model/tax.ts';
import { ORDER_PAYMENT_FETCHES, parseOrderQueryResult } from '@/api/model/order.ts';
import { collectOrderTaxRows } from '@/lib/tax-calculator.ts';
import { toRecordId } from '@/lib/utils.ts';
import { nanoid } from 'nanoid';
import { runWriteTransaction, type TxStatement } from '@/lib/db-transaction.ts';

export type DbClient = ReturnType<typeof useDB>;

const roundTax = (value: number) => Math.round(value * 100) / 100;

const isOrderRecord = (value: unknown): value is Order => {
  return typeof value === 'object' && value !== null && Array.isArray((value as Order).items);
};

const loadOrderForTaxSync = async (db: DbClient, orderId: unknown): Promise<Order | undefined> => {
  const id = toRecordId(orderId);
  const fetches = ORDER_PAYMENT_FETCHES.join(', ');
  const onlyResult = await db.query(`SELECT * FROM ONLY ${id} FETCH ${fetches}`);
  const parsed = parseOrderQueryResult(onlyResult);
  if (parsed?.items) {
    return parsed;
  }

  const legacyResult = await db.query(`SELECT * FROM ${id} FETCH ${fetches}`);
  return parseOrderQueryResult(legacyResult);
};

export const syncOrderTaxes = async (
  db: DbClient,
  orderOrId: Order | unknown,
  orderTaxOverride?: Tax | null,
): Promise<void> => {
  const recordId = isOrderRecord(orderOrId) ? toRecordId(orderOrId.id) : toRecordId(orderOrId);
  const order = isOrderRecord(orderOrId)
    ? orderOrId
    : await loadOrderForTaxSync(db, recordId);

  if (!order) {
    return;
  }

  const resolvedOrderTax = orderTaxOverride ?? order.tax ?? null;
  const rows = collectOrderTaxRows(order, resolvedOrderTax);

  const existingResult = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM ${Tables.order_taxes} WHERE order = $orderId`,
    { orderId: recordId },
  );
  const existing = existingResult?.[0] ?? [];

  const newRows = rows.filter((row) => row.amount > 0 && row.tax?.id);
  const newIds = newRows.map(() => `${Tables.order_taxes}:${nanoid()}`);
  const totalAmount = roundTax(
    newRows.reduce((sum, row) => sum + roundTax(row.amount), 0),
  );

  // Delete the old order_taxes, write the new ones, and re-point the order's
  // denormalised tax fields — all in one transaction, so a dropped connection
  // can't leave the order with no tax rows but a stale tax_amount.
  const statements: TxStatement[] = [];

  existing.forEach((row, index) => {
    statements.push({
      sql: `DELETE $ot_del_${index}`,
      vars: { [`ot_del_${index}`]: toRecordId(row.id) },
    });
  });

  newRows.forEach((row, index) => {
    statements.push({
      sql: `CREATE $ot_new_${index} CONTENT $ot_data_${index}`,
      vars: {
        [`ot_new_${index}`]: toRecordId(newIds[index]),
        [`ot_data_${index}`]: {
          order: recordId,
          tax: toRecordId(row.tax.id),
          amount: roundTax(row.amount),
        },
      },
    });
  });

  statements.push({
    sql: `UPDATE $ot_order MERGE $ot_denorm`,
    vars: {
      ot_order: recordId,
      ot_denorm: {
        tax_amount: totalAmount,
        order_taxes: newIds.map((id) => toRecordId(id)),
      },
    },
  });

  await runWriteTransaction(db, statements);
};
