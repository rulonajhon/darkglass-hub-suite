-- =====================================================================
-- 0481 — eBay listing → Truck Stock row: part # written with a description.
--
-- Some branches' Truck Stock rows carry a description in the Part # cell
-- ("5304531011 HEATER", "W10899966 HOSE", "WH16X26911 (2)") — 42 Columbus /
-- Mobile listings had their part at their own branch that way, and 0480
-- then sent 4 of them (5304531011, W10899966, 243297608, AGM30045804) to
-- another branch's EBAY row instead. The row a listing is for is now:
--   1. the listing's branch, same part # (as 0477);
--   2. the listing's branch, a Part # that starts with the listing's part #
--      followed by a space / "(" ("5304531011 HEATER") — EBAY rows, then IN STOCK,
--      then the most units (a listing with two part #s in it, "WH16X26911
--      and WH16X26910", matches neither — list them separately);
--   3. only then the part's one EBAY row at another branch (as 0480).
-- The first word has to hold a digit and be 5+ characters, so "BOX 5" never
-- matches anything.
--
-- Only functions change (create or replace). No table or data is touched;
-- every listing was still Listed when this was written, so nothing had been
-- taken from the wrong row. Run once in the Supabase SQL Editor. Safe to
-- rerun. The page does the same match (src/lib/supabase/truckStockEbay.ts).
-- =====================================================================

-- First word of a part #, capitals: "5304531011 HEATER" / "WH16X26911 (2)" → 5304531011 / WH16X26911.
create or replace function ebay_part_first(p text)
returns text language sql immutable as $$
  select case when w ~ '[0-9]' and length(w) >= 5 then w end
  from (select upper(split_part(regexp_replace(btrim(coalesce(p, '')), '[[:space:](,*]+', ' ', 'g'), ' ', 1)) as w) s;
$$;

create or replace function ebay_truck_stock_row(p_company uuid, p_branch text, p_part text)
returns uuid language plpgsql stable set search_path = public as $$
declare
  v_row uuid;
  v_n   integer;
begin
  -- 1. The listing's own branch (however it's spelled), same part #: the row set aside for eBay (EBAY), then IN STOCK
  --    (a row 0482 turns EBAY keeps its listings), then any other, then the most units.
  select t.id into v_row from truck_stock t
  where t.company_id = p_company
    and chain_norm_branch(t.branch) = chain_norm_branch(p_branch)
    and ebay_part_key(t.part_no) = ebay_part_key(p_part)
  order by case t.status when 'ebay' then 0 when 'in_stock' then 1 else 2 end, t.quantity desc, t.created_at
  limit 1;
  if v_row is not null then
    return v_row;
  end if;

  -- 2. Same branch, the part # with a description after it ("5304531011 HEATER"):
  --    the row's first word is the listing's whole part #.
  select t.id into v_row from truck_stock t
  where t.company_id = p_company
    and chain_norm_branch(t.branch) = chain_norm_branch(p_branch)
    and ebay_part_first(t.part_no) = ebay_part_key(p_part)
  order by case t.status when 'ebay' then 0 when 'in_stock' then 1 else 2 end, t.quantity desc, t.created_at
  limit 1;
  if v_row is not null then
    return v_row;
  end if;

  -- 3. None there: the part's EBAY row at another branch, when it has exactly one.
  select count(*), min(t.id::text)::uuid into v_n, v_row from truck_stock t
  where t.company_id = p_company
    and t.status = 'ebay'
    and ebay_part_key(t.part_no) = ebay_part_key(p_part);
  return case when v_n = 1 then v_row else null end;
end;
$$;

notify pgrst, 'reload schema';
