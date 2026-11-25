/** The column-funnel dropdown's width (TicketColumnFilter's w-60) and the gap it keeps from the window's edges. */
export const COLUMN_FILTER_WIDTH = 240;
const EDGE_GAP = 8;

/**
 * Where TicketColumnFilter's dropdown goes for a funnel at `rect` in a
 * `vw` × `vh` window: under the funnel, lined up with its left side — or its
 * right side when that would run off the right edge (e.g. the Ticket List's
 * last column, Posting) — never past either edge; above it when there's no
 * room below (`height` = the dropdown's height once known, 0 before).
 */
export function placeColumnFilterDropdown(
  rect: { left: number; right: number; top: number; bottom: number },
  vw: number,
  vh: number,
  height: number,
): { top: number; left: number } {
  let left = rect.left;
  if (left + COLUMN_FILTER_WIDTH > vw - EDGE_GAP) left = rect.right - COLUMN_FILTER_WIDTH;
  left = Math.max(EDGE_GAP, Math.min(left, vw - COLUMN_FILTER_WIDTH - EDGE_GAP));
  let top = rect.bottom + 4;
  if (height && top + height > vh - EDGE_GAP && rect.top - 4 - height >= EDGE_GAP) top = rect.top - 4 - height;
  return { top, left };
}
