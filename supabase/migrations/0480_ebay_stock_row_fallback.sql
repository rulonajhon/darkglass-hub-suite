-- =====================================================================
-- 0480 — eBay listing → Truck Stock row: fall back to the part's EBAY row.
--
-- 0477 matched a listing to the Truck Stock row at the listing's own branch
-- (same part #). Some parts set aside for eBay sit at another branch than
-- the one the listing was entered under — e.g. 5304531011 listed under
-- Columbus, while the unit for eBay is Chattanooga's row marked Status EBAY
-- (Description Warehouse101). Now, when the listing's branch has no row for
-- the part, the part's one EBAY-status row at any branch is used (only when
-- there is exactly one, so it's never a guess between branches).
--
-- Only ebay_truck_stock_row changes (create or replace). No table or data is
-- touched; listings already Sold keep the row they took from. Run once in
-- the Supabase SQL Editor. Safe to rerun. The page does the same match
-- (src/lib/supabase/truckStockEbay.ts resolveEbayStockRow).
-- =====================================================================

create or replace function ebay_truck_stock_row(p_company uuid, p_branch text, p_part text)
returns uuid language plpgsql stable set search_path = public as $$
declare
  v_row uuid;
  v_n   integer;
begin
  -- The listing's own branch (however it's spelled): IN STOCK first, then the most units.
  select t.id into v_row from truck_stock t
  where t.company_id = p_company
    and chain_norm_branch(t.branch) = chain_norm_branch(p_branch)
    and ebay_part_key(t.part_no) = ebay_part_key(p_part)
  order by (t.status = 'in_stock') desc, t.quantity desc, t.created_at
  limit 1;
  if v_row is not null then
    return v_row;
  end if;

  -- None there: the part's EBAY row at another branch, when it has exactly one.
  select count(*), min(t.id::text)::uuid into v_n, v_row from truck_stock t
  where t.company_id = p_company
    and t.status = 'ebay'
    and ebay_part_key(t.part_no) = ebay_part_key(p_part);
  return case when v_n = 1 then v_row else null end;
end;
$$;

notify pgrst, 'reload schema';
