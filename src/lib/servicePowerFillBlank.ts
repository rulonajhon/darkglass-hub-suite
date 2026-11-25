/**
 * "Fill-blank" ServicePower pull for a ticket that's already in AHS: which
 * empty AHS fields ServicePower can fill. Pure, so it can be tested and
 * shared by the hourly auto-pull (server/servicePowerAutoPull.ts).
 *
 * Only fields that are blank in AHS are filled, never overwritten. Status,
 * technician, schedule, time slot, check-ins, ticket source and location are
 * never touched (the app's full re-pull overwrote the technician and cleared
 * check-ins). Product fields are left alone once someone edited the product
 * (product_edited_by_user), account / claim company once someone edited the
 * source (source_edited_by_user), the customer once someone edited it
 * (customers.edited_by_user, phones also phone_edited_by_user).
 *
 * The writer applies each change with its own "still blank" condition, so a
 * value typed in between is never overwritten.
 */
import type { Ticket } from "./ticketData";

export interface FillChange {
  table: "tickets" | "customers";
  /** tickets.id or customers.id */
  id: string;
  column: string;
  value: string;
}

/** Ticket column → field of the ticket convertCallToTicket builds. */
const TICKET_FIELDS: Array<[string, keyof Ticket]> = [
  ["model", "model"],
  ["model_version", "modelVersion"],
  ["serial", "serial"],
  ["product_type", "productType"],
  ["type", "type"],
  ["manufacturer", "manufacturer"],
  ["purchase_date", "purchaseDate"],
  ["account_no", "accountNo"],
  ["account", "account"],
  ["claim_company", "claimCompany"],
  ["call_received_date", "callReceivedDate"],
  ["problem_description", "problemDescription"],
];
const PRODUCT_COLUMNS = new Set(["model", "model_version", "serial", "product_type", "type", "manufacturer", "purchase_date"]);
const SOURCE_COLUMNS = new Set(["account", "claim_company"]);

/** customers column → ticket field. */
const CUSTOMER_FIELDS: Array<[string, keyof Ticket]> = [
  ["email", "email"],
  ["phone", "phone"],
  ["second_phone", "secondPhone"],
  ["address", "address"],
  ["address2", "address2"],
  ["zip", "zip"],
  ["state", "state"],
  ["city", "city"],
  ["first_name", "firstName"],
  ["last_name", "lastName"],
];

/** Date columns: blank means null (a date can't be ""), values go in as YYYY-MM-DD. */
export const FILL_DATE_COLUMNS = new Set(["purchase_date", "call_received_date"]);

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/** "07/31/25" / "07/31/2025" / "2025-07-31…" → "2025-07-31"; "" when it isn't a date. */
export function spIsoDate(v: unknown): string {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (!m) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * What a fill-blank pull would write for one ticket. `row` is the tickets row
 * with its customer joined as `customer` (select=*,customer:customers(*));
 * `sp` is the call as convertCallToTicket builds it.
 */
export function planFillBlank(row: Record<string, any>, sp: Partial<Ticket>): FillChange[] {
  const changes: FillChange[] = [];
  if (!row?.id) return changes;
  for (const [column, field] of TICKET_FIELDS) {
    if (PRODUCT_COLUMNS.has(column) && row.product_edited_by_user) continue;
    if (SOURCE_COLUMNS.has(column) && row.source_edited_by_user) continue;
    let value = String((sp as any)[field] ?? "").trim();
    if (FILL_DATE_COLUMNS.has(column)) value = spIsoDate(value);
    if (!blank(row[column]) || !value) continue;
    changes.push({ table: "tickets", id: row.id, column, value });
  }
  const c = row.customer;
  if (c?.id && !c.edited_by_user) {
    for (const [column, field] of CUSTOMER_FIELDS) {
      if ((column === "phone" || column === "second_phone") && c.phone_edited_by_user) continue;
      const value = String((sp as any)[field] ?? "").trim();
      if (!blank(c[column]) || !value) continue;
      changes.push({ table: "customers", id: c.id, column, value });
    }
  }
  return changes;
}

/** PostgREST filter for "this column is still blank" — added to each fill's PATCH. */
export function stillBlankFilter(column: string): string {
  return FILL_DATE_COLUMNS.has(column) ? `${column}=is.null` : `or=(${column}.is.null,${column}.eq.)`;
}
