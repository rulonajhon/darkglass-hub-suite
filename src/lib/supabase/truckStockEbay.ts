/**
 * Truck Stock ↔ eBay (migration 0477): units of a branch's part that are
 * currently Listed on Parts Daily Report eBAY count as "On eBay" — still on
 * the shelf, but not available to pull for a ticket or transfer. Nothing is
 * stored on truck_stock for this; it's worked out from the Listed listings.
 *
 * Matching is the same as the database's (0477 ebay_truck_stock_row): the
 * branch however it's spelled (branchMatchKey = chain_norm_branch) and the
 * part # ignoring case and spaces (ebayPartKey = ebay_part_key).
 */
import { supabase } from "./client";
import { branchMatchKey } from "@/lib/branchName";
import type { TruckStockRow } from "./truckStock";

/** Part # as matched between eBay and Truck Stock: no spaces, capitals. */
export function ebayPartKey(partNo: string | null | undefined): string {
  return String(partNo ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * First word of a Truck Stock Part # cell, capitals — "5304531011 HEATER" /
 * "WH16X26911 (2)" → 5304531011 / WH16X26911 (migration 0481's
 * ebay_part_first). "" unless it holds a digit and is 5+ characters.
 */
export function ebayPartFirst(partNo: string | null | undefined): string {
  const w = String(partNo ?? "").trim().toUpperCase().split(/[\s(,*]+/)[0] ?? "";
  return /\d/.test(w) && w.length >= 5 ? w : "";
}

/** One key per branch + part # — blank when either is missing (never matches). */
export function ebayStockKey(branch: string | null | undefined, partNo: string | null | undefined): string {
  const b = branchMatchKey(branch);
  const p = ebayPartKey(partNo);
  return b && p ? `${b}|${p}` : "";
}

/** Units currently Listed on eBay per branch + part (ebayStockKey → units). */
export async function getOnEbayCounts(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("ebay_listings")
      .select("branch, part_no, quantity")
      .eq("status", "Listed")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const key = ebayStockKey(r.branch, r.part_no);
      if (key) out.set(key, (out.get(key) ?? 0) + Math.max(0, Number(r.quantity) || 0));
    }
    if ((data ?? []).length < 1000) return out;
  }
}

type StockLike = Pick<TruckStockRow, "id" | "branch" | "partNo" | "quantity" | "status">;

/**
 * The part's one EBAY-status row at any branch (part # key → row), for parts
 * that have exactly one — what a listing falls back to when its own branch
 * has no row for the part (0480: e.g. listed under Columbus, the unit for
 * eBay is Chattanooga's EBAY row). Parts with two or more are left out: no guessing.
 */
export function singleEbayRowByPart<T extends StockLike>(rows: T[]): Map<string, T> {
  const seen = new Map<string, T | null>();
  for (const r of rows) {
    if (r.status !== "ebay") continue;
    const pk = ebayPartKey(r.partNo);
    if (!pk) continue;
    seen.set(pk, seen.has(pk) ? null : r);
  }
  const out = new Map<string, T>();
  for (const [pk, r] of seen) if (r) out.set(pk, r);
  return out;
}

/** Index for matchListingRows: rows by exact branch + part #, by branch + first word, and each part's one EBAY row. */
export function indexStockForEbay<T extends StockLike>(rows: T[]) {
  const exact = new Map<string, T[]>();
  const firstWord = new Map<string, T[]>();
  const push = (m: Map<string, T[]>, k: string, r: T) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  };
  for (const r of rows) {
    const key = ebayStockKey(r.branch, r.partNo);
    if (key) push(exact, key, r);
    const b = branchMatchKey(r.branch);
    const fw = ebayPartFirst(r.partNo);
    if (b && fw) push(firstWord, `${b}|${fw}`, r);
  }
  return { exact, firstWord, ebayRow: singleEbayRowByPart(rows) };
}

// The row set aside for eBay (EBAY) first — a row turned EBAY by its listings keeps them (0481 / 0482) —
// then IN STOCK, then any other; then the most units.
const rank = (r: StockLike) => (r.status === "ebay" ? 0 : r.status === "in_stock" ? 1 : 2);
const sameRowOrder = (a: StockLike, b: StockLike) => rank(a) - rank(b) || b.quantity - a.quantity;

/**
 * The Truck Stock rows a listing (by its ebayStockKey) is for — the same
 * order the database uses (0477 / 0480 / 0481): 1. its branch, same part #;
 * 2. its branch, a Part # that is the listing's part # plus a description
 * ("5304531011 HEATER"); 3. the part's one EBAY row at another branch
 * (`elsewhere`). IN STOCK rows first, then the most units.
 */
export function matchListingRows<T extends StockLike>(index: ReturnType<typeof indexStockForEbay<T>>, listingKey: string): { rows: T[]; elsewhere: boolean } {
  if (!listingKey) return { rows: [], elsewhere: false };
  const own = index.exact.get(listingKey);
  if (own?.length) return { rows: [...own].sort(sameRowOrder), elsewhere: false };
  const described = index.firstWord.get(listingKey);
  if (described?.length) return { rows: [...described].sort(sameRowOrder), elsewhere: false };
  const r = index.ebayRow.get(listingKey.slice(listingKey.indexOf("|") + 1));
  return r ? { rows: [r], elsewhere: true } : { rows: [], elsewhere: false };
}

/**
 * How many of each row's units are on eBay (row id → units): each listing's
 * units go to the rows matchListingRows picks for it — the same row a sale
 * is taken off — and never more than a row holds.
 */
export function allocateOnEbay(rows: StockLike[], onEbay: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (onEbay.size === 0) return out;
  const index = indexStockForEbay(rows);
  for (const [key, units] of onEbay) {
    let left = units;
    for (const r of matchListingRows(index, key).rows) {
      if (left <= 0) break;
      const take = Math.min(left, Math.max(0, r.quantity - (out.get(r.id) ?? 0)));
      if (take > 0) out.set(r.id, (out.get(r.id) ?? 0) + take);
      left -= take;
    }
  }
  return out;
}

/** The rows with Quantity cut to what's available (on eBay taken out); rows left with 0 are dropped. */
export async function availableAfterEbay<T extends StockLike>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const onEbay = await getOnEbayCounts().catch((err) => {
    console.warn("On-eBay counts unavailable:", err);
    return new Map<string, number>();
  });
  const taken = allocateOnEbay(rows, onEbay);
  return rows
    .map((r) => (taken.has(r.id) ? { ...r, quantity: r.quantity - (taken.get(r.id) ?? 0) } : r))
    .filter((r) => r.quantity > 0);
}
