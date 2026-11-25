-- =====================================================================
-- 0482 — Truck Stock Status follows eBay: EBAY when every unit is listed.
--
-- Run AFTER 0481 (uses its ebay_truck_stock_row / ebay_part_first).
--
-- A row's Status is set by the database ("automatic", status_auto_ebay):
--   * IN STOCK row, Qty > 0, and its Listed eBay listings cover every unit
--     (On eBay >= Qty)                       → EBAY (automatic)
--   * automatic row, not every unit listed any more (a listing Ended /
--     Undone / deleted, or Qty raised)       → IN STOCK (no longer automatic)
--   * automatic row whose units all sold (Qty 0)  → SOLD; Undo brings it
--     back to EBAY
-- A Status set by hand — including every row already marked EBAY by hand —
-- is never changed: setting Status by hand (page, Import) clears the
-- automatic mark. Every change shows in the row's History (0464).
--
-- A listing counts against the row a sale would take from
-- (ebay_truck_stock_row, 0477 / 0480 / 0481).
--
-- The LAST statement brings today's rows in line: IN STOCK rows whose every
-- unit is already Listed become EBAY (190 rows when this was written:
-- Mobile 90, Columbus 36, Jackson TN 26, Memphis 15, Knoxville 12,
-- Jacksonville 9, Atlanta 1, Raleigh 1). Those rows are marked automatic, so
-- they go back to IN STOCK by themselves when their listing is Ended or
-- Undone. Quantities are not changed. Run once in the Supabase SQL Editor.
-- Safe to rerun.
--
-- Second version (2026-11-25): the first one's catch-up scanned all of
-- Truck Stock for every listing and ran for minutes, holding Truck Stock and
-- the eBay listings locked (the run was rolled back; nothing had changed).
-- Now: indexes for the lookups a listing makes, ebay_listings.part_key (the
-- listing's part # as matched, kept by the database), a re-check that only
-- looks at listings with the row's part #, a one-pass catch-up, and a
-- 5-second lock timeout so it never queues behind the live app — if it says
-- "lock timeout", just run it again. Measured at full size (8,700 rows, 246
-- listings): the whole file 0.4 s; a listing Ended 6 ms; a 500-row Truck
-- Stock Import batch 0.2 s.
-- =====================================================================

set lock_timeout = '5s';

alter table truck_stock add column if not exists status_auto_ebay boolean not null default false;

-- Lookups ebay_truck_stock_row (0481) and the listing counts make — index, not a scan of every row.
create index if not exists idx_truck_stock_ebay_exact
  on truck_stock (company_id, chain_norm_branch(branch), ebay_part_key(part_no));
create index if not exists idx_truck_stock_ebay_first
  on truck_stock (company_id, chain_norm_branch(branch), ebay_part_first(part_no));
create index if not exists idx_truck_stock_ebay_rows
  on truck_stock (company_id, ebay_part_key(part_no)) where status = 'ebay';
-- Each listing's part # as matched (ebay_part_key), kept up to date by the database, so the
-- check every Truck Stock change makes is a plain comparison.
alter table ebay_listings add column if not exists part_key text generated always as (ebay_part_key(part_no)) stored;
create index if not exists idx_ebay_listings_listed_part
  on ebay_listings (company_id, part_key) where status = 'Listed';

-- Units of Listed listings that count against this row (same match as a sale).
create or replace function ebay_listed_units_for_row(p_row uuid)
returns integer language plpgsql stable set search_path = public as $$
declare
  t       truck_stock;
  k_exact text;
  k_first text;
  l       record;
  v_units integer := 0;
begin
  select * into t from truck_stock where id = p_row;
  if not found then
    return 0;
  end if;
  k_exact := ebay_part_key(t.part_no);
  k_first := ebay_part_first(t.part_no);
  -- Only listings with this part # (or the part # this row's description follows) can count;
  -- which row each of those is for is checked one by one (a loop, so the check never runs
  -- on every listing).
  for l in
    select el.company_id, el.branch, el.part_no, el.quantity
    from ebay_listings el
    where el.company_id = t.company_id
      and el.status = 'Listed'
      and el.part_key in (k_exact, k_first)
  loop
    if ebay_truck_stock_row(l.company_id, l.branch, l.part_no) = t.id then
      v_units := v_units + greatest(coalesce(l.quantity, 0), 0);
    end if;
  end loop;
  return v_units;
end;
$$;

-- Bring one row's Status in line with its listings (see the rules above).
create or replace function ebay_sync_row_status(p_row uuid)
returns void language plpgsql set search_path = public as $$
declare
  t        truck_stock;
  v_listed integer;
  v_target text;
begin
  if p_row is null then
    return;
  end if;
  select * into t from truck_stock where id = p_row;
  if not found then
    return;
  end if;
  -- Hand-set statuses and empty rows never change: skip counting listings for them.
  if not t.status_auto_ebay and (t.status <> 'in_stock' or t.quantity <= 0) then
    return;
  end if;
  v_listed := ebay_listed_units_for_row(p_row);
  if t.status_auto_ebay then
    v_target := case
      when t.quantity <= 0 then 'sold'
      when v_listed >= t.quantity then 'ebay'
      else 'in_stock'
    end;
  elsif t.status = 'in_stock' and t.quantity > 0 and v_listed >= t.quantity then
    v_target := 'ebay';
  else
    return;
  end if;
  if v_target = t.status and t.status_auto_ebay = (v_target <> 'in_stock') then
    return;
  end if;
  perform set_config('ahs.ebay_status_sync', 'on', true);
  update truck_stock
     set status = v_target,
         status_auto_ebay = (v_target <> 'in_stock')
   where id = p_row;
  perform set_config('ahs.ebay_status_sync', 'off', true);
end;
$$;

-- Status changed by anyone but ebay_sync_row_status = set by hand: no longer automatic.
create or replace function truck_stock_status_set_by_hand()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('ahs.ebay_status_sync', true), 'off') <> 'on' then
    new.status_auto_ebay := false;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_truck_stock_status_set_by_hand on truck_stock;
create trigger trg_truck_stock_status_set_by_hand
  before update on truck_stock
  for each row execute function truck_stock_status_set_by_hand();

-- A listing added / changed / removed: re-check the rows it counted against.
create or replace function ebay_listing_sync_stock_status()
returns trigger language plpgsql set search_path = public as $$
declare
  v_old uuid;
  v_new uuid;
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.quantity is not distinct from old.quantity
     and new.branch is not distinct from old.branch
     and new.part_no is not distinct from old.part_no then
    return null;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := ebay_truck_stock_row(old.company_id, old.branch, old.part_no);
    perform ebay_sync_row_status(v_old);
    if old.stock_row_id is not null and old.stock_row_id is distinct from v_old then
      perform ebay_sync_row_status(old.stock_row_id);
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := ebay_truck_stock_row(new.company_id, new.branch, new.part_no);
    if v_new is distinct from v_old then
      perform ebay_sync_row_status(v_new);
    end if;
    if new.stock_row_id is not null and new.stock_row_id is distinct from v_new and new.stock_row_id is distinct from v_old then
      perform ebay_sync_row_status(new.stock_row_id);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_ebay_listings_sync_stock_status on ebay_listings;
create trigger trg_ebay_listings_sync_stock_status
  after insert or update or delete on ebay_listings
  for each row execute function ebay_listing_sync_stock_status();

-- A row's Qty changed (or a row added): re-check it.
create or replace function truck_stock_sync_ebay_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.quantity is not distinct from old.quantity
     and new.part_no is not distinct from old.part_no and new.branch is not distinct from old.branch then
    return null;
  end if;
  perform ebay_sync_row_status(new.id);
  return null;
end;
$$;
drop trigger if exists trg_truck_stock_sync_ebay_status on truck_stock;
create trigger trg_truck_stock_sync_ebay_status
  after insert or update of quantity, part_no, branch on truck_stock
  for each row execute function truck_stock_sync_ebay_status();

notify pgrst, 'reload schema';

-- ---------- Catch up: today's fully-listed IN STOCK rows → EBAY (automatic) ----------
-- One pass: each Listed listing's row is worked out once, units added up per
-- row, and every IN STOCK row they fully cover is set EBAY in one update.
do $$
begin
  perform set_config('ahs.ebay_status_sync', 'on', true);
  with per_row as (
    select ebay_truck_stock_row(l.company_id, l.branch, l.part_no) as row_id,
           sum(greatest(l.quantity, 0)) as units
    from ebay_listings l
    where l.status = 'Listed'
    group by 1
  )
  update truck_stock t
     set status = 'ebay',
         status_auto_ebay = true
    from per_row p
   where t.id = p.row_id
     and t.status = 'in_stock'
     and t.quantity > 0
     and p.units >= t.quantity;
  perform set_config('ahs.ebay_status_sync', 'off', true);
end;
$$;

reset lock_timeout;
