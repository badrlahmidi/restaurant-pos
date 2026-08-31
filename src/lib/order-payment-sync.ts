import { Tables } from "@/api/db/tables.ts";
import { OrderPayment } from "@/api/model/order_payment.ts";
import { toRecordId } from "@/lib/utils.ts";
import { nanoid } from "nanoid";
import { runWriteTransaction, type TxRunner, type TxStatement } from "@/lib/db-transaction.ts";

type SyncOrderPaymentsDb = TxRunner;

export const isPersistedOrderPaymentId = (id: unknown): boolean => {
  if (id === null || id === undefined) {
    return false;
  }

  if (typeof id === "object" && "tb" in (id as object)) {
    return String((id as { tb: unknown }).tb) === Tables.order_payment;
  }

  const value = String(id);
  return value.startsWith(`${Tables.order_payment}:`);
};

const paymentIdKey = (id: unknown): string => String(id);

/**
 * Incrementally sync UI payments to order_payment records.
 * Keeps existing rows, creates new (nanoid) ones, deletes only removed, drops stale null links.
 */
export async function syncOrderPayments(
  db: SyncOrderPaymentsDb,
  desiredPayments: OrderPayment[],
  existingPayments: (OrderPayment | null | undefined)[] | undefined,
  defaultPayable: number,
): Promise<{ paymentIds: any[]; payments: OrderPayment[] }> {
  const existing = (existingPayments ?? []).filter(
    (payment): payment is OrderPayment => payment != null && payment.id != null,
  );

  const desiredPersistedKeys = new Set(
    desiredPayments
      .filter((payment) => isPersistedOrderPaymentId(payment?.id))
      .map((payment) => paymentIdKey(payment.id)),
  );

  const statements: TxStatement[] = [];

  // Delete rows the UI dropped. DELETE of an already-gone record is a no-op,
  // so the old per-row try/catch is unnecessary inside the transaction.
  existing.forEach((existingPayment, index) => {
    if (!desiredPersistedKeys.has(paymentIdKey(existingPayment.id))) {
      statements.push({
        sql: `DELETE $pay_del_${index}`,
        vars: { [`pay_del_${index}`]: existingPayment.id },
      });
    }
  });

  const paymentIds: any[] = [];
  const payments: OrderPayment[] = [];

  desiredPayments.forEach((payment, index) => {
    if (payment == null || !payment.payment_type?.id) {
      return;
    }

    const payload = {
      amount: payment.amount,
      payment_type: payment.payment_type.id,
      comments: payment.comments || "",
      payable: payment.payable ?? defaultPayable,
    };

    if (isPersistedOrderPaymentId(payment.id)) {
      // UPSERT (not UPDATE) so a link to a vanished record recreates it —
      // the behaviour the old merge/catch/recreate path had.
      statements.push({
        sql: `UPSERT $pay_upd_${index} MERGE $pay_data_${index}`,
        vars: { [`pay_upd_${index}`]: payment.id, [`pay_data_${index}`]: payload },
      });
      paymentIds.push(payment.id);
      payments.push(payment);
      return;
    }

    const createdId = toRecordId(`${Tables.order_payment}:${nanoid()}`);
    statements.push({
      sql: `CREATE $pay_new_${index} CONTENT $pay_data_${index}`,
      vars: { [`pay_new_${index}`]: createdId, [`pay_data_${index}`]: payload },
    });
    paymentIds.push(createdId);
    payments.push({ ...payment, id: createdId });
  });

  await runWriteTransaction(db, statements);

  return { paymentIds, payments };
}
