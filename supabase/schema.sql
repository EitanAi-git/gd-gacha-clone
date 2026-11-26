-- =====================================================================
-- EitanGD Gacha: database schema for Supabase
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run again: it drops and recreates the functions, and
-- tables are only created if missing. The seed only adds missing cards and packs.
--
-- Security model
--  * Row Level Security is ON for every table. Clients cannot insert,
--    update or delete anything directly.
--  * Players act only through the RPC functions below (security definer).
--    Each one checks the caller's session first (assert_player / assert_admin).
--  * A session counts only if the "api" Edge Function created it (it is listed
--    in app_sessions). Logging in straight against Supabase Auth gives a
--    session that every game function rejects, so lockouts and 2FA cannot be bypassed.
--  * 2FA uses an authenticator app (TOTP). Secrets sit in twofa_secrets, which no player can read.
--  * srv_* functions are callable only with the service-role key (the Edge Function).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  username       text not null,
  role           text not null default 'player' check (role in ('player','admin')),
  orbs           bigint not null default 0 check (orbs >= 0),
  pending        double precision not null default 0,
  last_tick      timestamptz not null default now(),
  daily_last     timestamptz,
  daily_streak   int not null default 0,
  packs_opened   bigint not null default 0,
  favorites      text[] not null default '{}',
  status         text not null default 'ok' check (status in ('ok','blocked','banned')),
  ban_reason     text,
  ban_until      timestamptz,
  kick_epoch     int not null default 0,      -- bumped on kick / ban / password reset
  wipe_epoch     int not null default 0,      -- bumped on wipe / reset
  twofa_enabled  boolean not null default false,
  twofa_email    text,
  created_at     timestamptz not null default now(),
  last_seen      timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

create table if not exists public.cards (
  id            text primary key,
  name          text not null,
  creator       text not null,
  set_name      text not null check (set_name in ('Official','Easy','Medium','Hard','Insane','Extreme')),
  rarity        text not null check (rarity in ('common','uncommon','rare','epic','legendary','mythic')),
  sell_override bigint check (sell_override is null or sell_override >= 0),
  enabled       boolean not null default true,
  custom        boolean not null default false,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists public.packs (
  id          text primary key,
  name        text not null,
  description text not null default '',
  size        int not null check (size between 1 and 20),
  price       bigint not null check (price >= 0),
  colors      text[] not null default '{"#3ee8ff","#7a3cff"}',
  sets        text[] not null,
  odds        jsonb not null,
  enabled     boolean not null default true,
  sort        int not null default 0
);

create table if not exists public.config (
  key   text primary key,
  value jsonb not null
);

create table if not exists public.collection (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  card_id   text not null references public.cards(id) on delete cascade,
  foil      boolean not null,
  full_art  boolean not null,
  qty       bigint not null check (qty > 0),
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now(),
  primary key (user_id, card_id, foil, full_art)
);

create table if not exists public.pulls (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  card_id   text not null references public.cards(id) on delete cascade,
  foil      boolean not null,
  full_art  boolean not null,
  pack_id   text,
  at        timestamptz not null default now()
);
create index if not exists pulls_user_at on public.pulls (user_id, at desc);

create table if not exists public.notifications (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  kind     text not null default 'popup',
  title    text,
  body     text not null,
  at       timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, at desc);
alter table public.notifications add column if not exists seen boolean not null default false;

create table if not exists public.app_sessions (
  session_id      uuid primary key,             -- auth.sessions.id (checked on every call)
  user_id         uuid not null references auth.users(id) on delete cascade,
  twofa           boolean not null default false,
  impersonated_by uuid references auth.users(id) on delete set null,
  ip              text,
  ua              text,
  created_at      timestamptz not null default now()
);

create table if not exists public.login_attempts (
  key           text primary key,          -- 'u:<username>' or 'ip:<address>'
  failures      int not null default 0,
  window_start  timestamptz not null default now(),
  locked_until  timestamptz,
  last_attempt  timestamptz not null default now()
);

create table if not exists public.twofa_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  purpose    text not null check (purpose in ('login','setup')),
  code_hash  text not null,
  email      text not null,
  attempts   int not null default 0,
  expires_at timestamptz not null,
  ip         text,
  ua         text,
  created_at timestamptz not null default now()
);

-- Authenticator-app (TOTP) secrets. Never readable by players; only the Edge Function uses them.
create table if not exists public.twofa_secrets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  secret     text not null,            -- base32
  last_step  bigint not null default 0, -- last accepted 30-second step (stops code reuse)
  created_at timestamptz not null default now()
);

create table if not exists public.totp_pending (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  secret     text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.login_events (
  id       bigint generated always as identity primary key,
  user_id  uuid references auth.users(id) on delete cascade,
  username text,
  ok       boolean not null,
  reason   text,
  ip       text,
  ua       text,
  at       timestamptz not null default now()
);
create index if not exists login_events_at on public.login_events (at desc);

create table if not exists public.admin_log (
  id       bigint generated always as identity primary key,
  admin_id uuid,
  action   text not null,
  target   uuid,
  details  jsonb,
  at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Row Level Security: deny by default. Players can read only their own
-- profile and notifications (needed for real-time updates). No client writes.
-- ---------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.cards            enable row level security;
alter table public.packs            enable row level security;
alter table public.config           enable row level security;
alter table public.collection       enable row level security;
alter table public.pulls            enable row level security;
alter table public.notifications    enable row level security;
alter table public.app_sessions     enable row level security;
alter table public.login_attempts   enable row level security;
alter table public.twofa_challenges enable row level security;
alter table public.twofa_secrets    enable row level security;
alter table public.totp_pending     enable row level security;
alter table public.login_events     enable row level security;
alter table public.admin_log        enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.profiles, public.notifications to authenticated;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists notifications_self_read on public.notifications;
create policy notifications_self_read on public.notifications for select to authenticated using (user_id = auth.uid());

-- Real-time: the client listens to its own profile row and notifications.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.cfg(p_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$ select value from public.config where key = p_key $$;

create or replace function public.rarities() returns text[]
language sql immutable as $$ select array['common','uncommon','rare','epic','legendary','mythic'] $$;

create or replace function public.parse_qty(p text) returns bigint
language plpgsql immutable as $$
declare v numeric;
begin
  if p is null or p !~ '^\s*\d{1,19}\s*$' then raise exception 'Quantity must be a whole number'; end if;
  v := trim(p)::numeric;
  if v < 1 or v > 9223372036854775807 then raise exception 'Quantity out of range'; end if;
  return v::bigint;
end $$;

create or replace function public.card_value(p_card text, p_foil boolean, p_full boolean) returns bigint
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare c public.cards; m jsonb := cfg('modifiers'); v bigint;
begin
  select * into c from public.cards where id = p_card;
  if not found then return 0; end if;
  v := coalesce(c.sell_override, (cfg('rarity_sell') ->> c.rarity)::bigint, 0);
  if p_foil then v := v + coalesce((m -> 'foil' ->> 'bonus')::bigint, 0); end if;
  if p_full then v := v + coalesce((m -> 'fullArt' ->> 'bonus')::bigint, 0); end if;
  return v;
end $$;

-- Session guard. Returns the caller's user id or raises.
create or replace function public.assert_player(p_play boolean default true) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  p   public.profiles;
begin
  if uid is null then raise exception 'Signed out' using errcode = '28000'; end if;
  begin sid := nullif(auth.jwt() ->> 'session_id', '')::uuid; exception when others then sid := null; end;
  if sid is null
     or not exists (select 1 from auth.sessions s where s.id = sid and s.user_id = uid)
     or not exists (select 1 from public.app_sessions a where a.session_id = sid and a.user_id = uid) then
    raise exception 'Signed out' using errcode = '28000';
  end if;
  select * into p from public.profiles where id = uid;
  if not found then raise exception 'Signed out' using errcode = '28000'; end if;
  if p.status = 'banned' then
    if p.ban_until is not null and p.ban_until <= now() then
      update public.profiles set status = 'ok', ban_reason = null, ban_until = null where id = uid;
    else
      raise exception 'Banned' using errcode = '28000';
    end if;
  end if;
  if p_play and p.status = 'blocked' then raise exception 'Your account is blocked'; end if;
  if p.last_seen < now() - interval '1 minute' then
    update public.profiles set last_seen = now() where id = uid;
  end if;
  return uid;
end $$;

create or replace function public.assert_admin() returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := assert_player(false); sid uuid := (auth.jwt() ->> 'session_id')::uuid;
begin
  if not exists (select 1 from public.profiles where id = uid and role = 'admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.app_sessions where session_id = sid and twofa) then
    raise exception 'Admin needs 2FA: turn it on in Account' using errcode = '42501';
  end if;
  return uid;
end $$;

create or replace function public.log_admin(p_admin uuid, p_action text, p_target uuid, p_details jsonb)
returns void language sql security definer set search_path = public, pg_temp
as $$ insert into public.admin_log(admin_id, action, target, details) values (p_admin, p_action, p_target, p_details) $$;

create or replace function public.tick_wallet(p_uid uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare e jsonb := cfg('economy');
begin
  update public.profiles set
    pending = least((e ->> 'cap')::double precision,
                    pending + extract(epoch from (now() - last_tick)) / 3600.0 * (e ->> 'perHour')::double precision),
    last_tick = now()
  where id = p_uid;
end $$;

create or replace function public.kill_sessions(p_uid uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from public.app_sessions where user_id = p_uid;
  delete from auth.sessions where user_id = p_uid;
end $$;

-- ---------------------------------------------------------------------
-- Public catalog (cards, packs, values). No private data.
-- ---------------------------------------------------------------------
create or replace function public.get_catalog() returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'creator', creator, 'set', set_name, 'rarity', rarity,
        'sell', card_value(id, false, false)::text, 'custom', custom, 'enabled', enabled) order by sort, created_at, id)
      from public.cards), '[]'::jsonb),
    'packs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'description', description, 'size', size, 'price', price::text,
        'colors', colors, 'sets', sets, 'odds', odds) order by sort, id)
      from public.packs where enabled), '[]'::jsonb),
    'raritySell', cfg('rarity_sell'),
    'modifiers', cfg('modifiers'),
    'economy', cfg('economy')
  )
$$;

-- ---------------------------------------------------------------------
-- Player functions
-- ---------------------------------------------------------------------
create or replace function public.get_state() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := assert_player(false); p public.profiles; sid uuid := (auth.jwt() ->> 'session_id')::uuid; s public.app_sessions; d jsonb;
begin
  perform tick_wallet(uid);
  select * into p from public.profiles where id = uid;
  select * into s from public.app_sessions where session_id = sid;
  d := daily_status(uid);
  return jsonb_build_object(
    'id', p.id, 'username', p.username, 'role', p.role, 'status', p.status,
    'orbs', p.orbs::text, 'pending', floor(p.pending)::bigint::text,
    'daily', d, 'packsOpened', p.packs_opened::text, 'favorites', to_jsonb(p.favorites),
    'kickEpoch', p.kick_epoch, 'wipeEpoch', p.wipe_epoch,
    'twofaEnabled', p.twofa_enabled,
    'session', jsonb_build_object('twofa', s.twofa, 'impersonatedBy', s.impersonated_by),
    'adminReady', (p.role = 'admin' and s.twofa),
    'collection', coalesce((select jsonb_agg(jsonb_build_object(
        'card', card_id, 'foil', foil, 'fullArt', full_art, 'qty', qty::text, 'at', last_at))
      from public.collection where user_id = uid), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(r) from (
        select jsonb_build_object('card', card_id, 'foil', foil, 'fullArt', full_art, 'at', at) r
        from public.pulls where user_id = uid order by at desc limit 15) x), '[]'::jsonb),
    'score', (select coalesce(sum(v), 0)::text from (
        select max(card_value(card_id, foil, full_art)) v from public.collection where user_id = uid group by card_id) t)
  );
end $$;

create or replace function public.daily_status(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare p public.profiles; e jsonb := cfg('economy'); streak int; claimed boolean;
begin
  select * into p from public.profiles where id = p_uid;
  claimed := p.daily_last is not null and (p.daily_last at time zone 'utc')::date = (now() at time zone 'utc')::date;
  streak := case when p.daily_last is null or (now() at time zone 'utc')::date - (p.daily_last at time zone 'utc')::date > 1
                 then 0 else p.daily_streak end;
  return jsonb_build_object('claimed', claimed, 'streak', case when claimed then p.daily_streak else streak end,
    'amount', least((e ->> 'dailyMax')::bigint, (e ->> 'dailyBase')::bigint + (e ->> 'dailyPerStreak')::bigint * streak)::text);
end $$;

create or replace function public.collect_orbs() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := assert_player(true); n bigint;
begin
  perform tick_wallet(uid);
  select floor(pending)::bigint into n from public.profiles where id = uid for update;
  update public.profiles set orbs = orbs + n, pending = pending - n where id = uid;
  return jsonb_build_object('collected', n::text);
end $$;

create or replace function public.claim_daily() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := assert_player(true); d jsonb;
begin
  perform 1 from public.profiles where id = uid for update;
  d := daily_status(uid);
  if (d ->> 'claimed')::boolean then raise exception 'Already claimed today'; end if;
  update public.profiles set orbs = orbs + (d ->> 'amount')::bigint, daily_last = now(),
    daily_streak = (d ->> 'streak')::int + 1 where id = uid;
  return jsonb_build_object('amount', d ->> 'amount', 'streak', (d ->> 'streak')::int + 1);
end $$;

create or replace function public.open_pack(p_pack text, p_count int, p_expected_price text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  uid uuid := assert_player(true);
  pk public.packs; m jsonb := cfg('modifiers');
  rs text[] := rarities();
  cost bigint; total double precision; x double precision; r text; idx int; i int; j int;
  chosen text; v_foil boolean; v_fa boolean; owned text[]; is_new boolean;
  result jsonb := '[]'::jsonb; order_r text[];
begin
  select * into pk from public.packs where id = p_pack and enabled;
  if not found then raise exception 'Pack unavailable'; end if;
  if p_count is null or p_count < 1 or p_count > 10 then raise exception 'You can open 1 to 10 packs at a time'; end if;
  if p_expected_price is distinct from pk.price::text then raise exception 'Price changed'; end if;
  if not exists (select 1 from public.cards where enabled and set_name = any(pk.sets)) then raise exception 'This pack has no cards'; end if;
  perform tick_wallet(uid);
  cost := pk.price * p_count;
  update public.profiles set orbs = orbs - cost, packs_opened = packs_opened + p_count
    where id = uid and orbs >= cost;
  if not found then raise exception 'Not enough orbs'; end if;

  select coalesce(array_agg(distinct card_id), '{}') into owned from public.collection where user_id = uid;
  select coalesce(sum(coalesce((pk.odds ->> v)::double precision, 0)), 0) into total from unnest(rs) v;
  if total <= 0 then raise exception 'Pack odds are all zero'; end if;

  for i in 1 .. p_count * pk.size loop
    -- roll rarity
    x := random() * total; r := 'common';
    for j in 1 .. array_length(rs, 1) loop
      x := x - coalesce((pk.odds ->> rs[j])::double precision, 0);
      if x < 0 then r := rs[j]; exit; end if;
    end loop;
    -- pick a card: the rolled rarity, else step down, else up
    idx := array_position(rs, r);
    order_r := (select array_agg(rs[k] order by k desc) from generate_series(1, idx) k)
            || coalesce((select array_agg(rs[k] order by k) from generate_series(idx + 1, array_length(rs, 1)) k), '{}');
    chosen := null;
    for j in 1 .. array_length(order_r, 1) loop
      select id into chosen from public.cards
        where enabled and set_name = any(pk.sets) and rarity = order_r[j] order by random() limit 1;
      exit when chosen is not null;
    end loop;
    v_foil := random() * 100 < coalesce((m -> 'foil' ->> 'chance')::double precision, 0);
    v_fa   := random() * 100 < coalesce((m -> 'fullArt' ->> 'chance')::double precision, 0);
    is_new := not (chosen = any(owned));
    if is_new then owned := owned || chosen; end if;
    insert into public.collection as c (user_id, card_id, foil, full_art, qty)
      values (uid, chosen, v_foil, v_fa, 1)
      on conflict (user_id, card_id, foil, full_art) do update set qty = c.qty + 1, last_at = now();
    insert into public.pulls(user_id, card_id, foil, full_art, pack_id) values (uid, chosen, v_foil, v_fa, pk.id);
    result := result || jsonb_build_object('card', chosen, 'foil', v_foil, 'fullArt', v_fa, 'isNew', is_new);
  end loop;
  -- keep the pull log small
  delete from public.pulls where user_id = uid and id not in (select id from public.pulls where user_id = uid order by at desc, id desc limit 200);
  return jsonb_build_object('cards', result);
end $$;

-- items: [{"card":"bloodbath","foil":false,"fullArt":false,"qty":"3"}]
create or replace function public.sell(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := assert_player(true); it jsonb; q bigint; have bigint; total bigint := 0; cnt bigint := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'Bad request'; end if;
  perform 1 from public.profiles where id = uid for update;
  for it in select * from jsonb_array_elements(p_items) loop
    q := parse_qty(it ->> 'qty');
    select qty into have from public.collection
      where user_id = uid and card_id = it ->> 'card' and foil = (it ->> 'foil')::boolean and full_art = (it ->> 'fullArt')::boolean
      for update;
    if have is null or have < q then raise exception 'You do not own that many copies'; end if;
    if have = q then
      delete from public.collection where user_id = uid and card_id = it ->> 'card' and foil = (it ->> 'foil')::boolean and full_art = (it ->> 'fullArt')::boolean;
    else
      update public.collection set qty = qty - q where user_id = uid and card_id = it ->> 'card' and foil = (it ->> 'foil')::boolean and full_art = (it ->> 'fullArt')::boolean;
    end if;
    total := total + card_value(it ->> 'card', (it ->> 'foil')::boolean, (it ->> 'fullArt')::boolean) * q;
    cnt := cnt + q;
  end loop;
  update public.profiles set orbs = orbs + total where id = uid;
  return jsonb_build_object('sold', cnt::text, 'orbs', total::text);
end $$;

-- Sells every copy except the best version of each card. p_cards limits it to those cards (null = all).
create or replace function public.sell_duplicates(p_cards text[] default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := assert_player(true); rec record; total bigint := 0; cnt bigint := 0; sell_q bigint;
begin
  perform 1 from public.profiles where id = uid for update;  -- one change at a time per player
  for rec in
    select card_id, foil, full_art, qty,
           row_number() over (partition by card_id order by (full_art::int * 2 + foil::int) desc) rn
    from public.collection
    where user_id = uid and (p_cards is null or card_id = any(p_cards))
  loop
    sell_q := case when rec.rn = 1 then rec.qty - 1 else rec.qty end;
    continue when sell_q <= 0;
    if sell_q = rec.qty then
      delete from public.collection where user_id = uid and card_id = rec.card_id and foil = rec.foil and full_art = rec.full_art;
    else
      update public.collection set qty = qty - sell_q where user_id = uid and card_id = rec.card_id and foil = rec.foil and full_art = rec.full_art;
    end if;
    total := total + card_value(rec.card_id, rec.foil, rec.full_art) * sell_q;
    cnt := cnt + sell_q;
  end loop;
  update public.profiles set orbs = orbs + total where id = uid;
  return jsonb_build_object('sold', cnt::text, 'orbs', total::text);
end $$;

create or replace function public.toggle_favorite(p_card text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := assert_player(false);
begin
  if not exists (select 1 from public.cards where id = p_card) then raise exception 'Unknown card'; end if;
  update public.profiles set favorites = case when p_card = any(favorites) then array_remove(favorites, p_card)
                                               else favorites || p_card end
    where id = uid;
  return (select to_jsonb(favorites) from public.profiles where id = uid);
end $$;

-- Unseen popups (also the ones sent while the player was offline). Marks them seen.
create or replace function public.get_notifications() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare uid uuid := assert_player(false); r jsonb;
begin
  with u as (
    update public.notifications set seen = true
    where user_id = uid and not seen
    returning id, kind, title, body, at)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'body', body, 'at', at) order by at), '[]'::jsonb)
    into r from u;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Admin functions (all require role=admin AND a 2FA-verified session)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_players(p_q text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin();
begin
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', p.id, 'username', p.username, 'role', p.role, 'status', p.status,
      'orbs', p.orbs::text, 'lastSeen', p.last_seen, 'createdAt', p.created_at,
      'cards', (select coalesce(sum(qty), 0)::text from public.collection c where c.user_id = p.id),
      'online', exists (select 1 from public.app_sessions s where s.user_id = p.id)) x
    from public.profiles p
    where coalesce(p_q, '') = '' or p.username ilike '%' || replace(replace(p_q, '%', '\%'), '_', '\_') || '%'
    order by p.last_seen desc limit 200) t), '[]'::jsonb);
end $$;

create or replace function public.admin_player_detail(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin(); p public.profiles;
begin
  perform tick_wallet(p_id);
  select * into p from public.profiles where id = p_id;
  if not found then raise exception 'Player not found'; end if;
  return jsonb_build_object(
    'profile', to_jsonb(p) || jsonb_build_object('orbs', p.orbs::text, 'pending', floor(p.pending)::bigint::text,
                                                 'packs_opened', p.packs_opened::text, 'daily', daily_status(p.id)),
    'collection', coalesce((select jsonb_agg(jsonb_build_object('card', card_id, 'foil', foil, 'fullArt', full_art,
        'qty', qty::text, 'firstAt', first_at, 'lastAt', last_at) order by last_at desc)
      from public.collection where user_id = p_id), '[]'::jsonb),
    'pulls', coalesce((select jsonb_agg(x) from (select jsonb_build_object('card', card_id, 'foil', foil, 'fullArt', full_art,
        'pack', pack_id, 'at', at) x from public.pulls where user_id = p_id order by at desc limit 50) t), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', session_id, 'twofa', twofa,
        'impersonatedBy', impersonated_by, 'ip', ip, 'ua', ua, 'at', created_at) order by created_at desc)
      from public.app_sessions where user_id = p_id), '[]'::jsonb),
    'logins', coalesce((select jsonb_agg(x) from (select jsonb_build_object('ok', ok, 'reason', reason, 'ip', ip, 'ua', ua, 'at', at) x
      from public.login_events where user_id = p_id order by at desc limit 50) t), '[]'::jsonb),
    'value', (select coalesce(sum(card_value(card_id, foil, full_art) * qty), 0)::text from public.collection where user_id = p_id)
  );
end $$;

create or replace function public.admin_set_orbs(p_id uuid, p_amount text, p_mode text default 'set') returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin(); v numeric; res bigint;
begin
  if p_amount !~ '^\s*-?\d{1,19}\s*$' then raise exception 'Amount must be a whole number'; end if;
  v := trim(p_amount)::numeric;
  if p_mode = 'set' then
    if v < 0 or v > 9223372036854775807 then raise exception 'Amount out of range'; end if;
    update public.profiles set orbs = v::bigint where id = p_id returning orbs into res;
  elsif p_mode = 'add' then
    update public.profiles set orbs = greatest(0, least(9223372036854775807::numeric, orbs::numeric + v))::bigint
      where id = p_id returning orbs into res;
  else raise exception 'Bad mode'; end if;
  if res is null then raise exception 'Player not found'; end if;
  perform log_admin(a, 'orbs_' || p_mode, p_id, jsonb_build_object('amount', p_amount));
  return jsonb_build_object('orbs', res::text);
end $$;

create or replace function public.admin_grant(p_id uuid, p_card text, p_foil boolean, p_full boolean, p_qty text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin(); q bigint := parse_qty(p_qty); res bigint;
begin
  if not exists (select 1 from public.profiles where id = p_id) then raise exception 'Player not found'; end if;
  if not exists (select 1 from public.cards where id = p_card) then raise exception 'Unknown card'; end if;
  insert into public.collection as c (user_id, card_id, foil, full_art, qty) values (p_id, p_card, p_foil, p_full, q)
    on conflict (user_id, card_id, foil, full_art)
    do update set qty = least(9223372036854775807::numeric, c.qty::numeric + q)::bigint, last_at = now()
    returning qty into res;
  insert into public.pulls(user_id, card_id, foil, full_art, pack_id) values (p_id, p_card, p_foil, p_full, 'admin');
  perform log_admin(a, 'grant', p_id, jsonb_build_object('card', p_card, 'foil', p_foil, 'fullArt', p_full, 'qty', p_qty));
  return jsonb_build_object('qty', res::text);
end $$;

create or replace function public.admin_grant_all(p_id uuid, p_qty text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin(); q bigint := parse_qty(p_qty);
begin
  if not exists (select 1 from public.profiles where id = p_id) then raise exception 'Player not found'; end if;
  insert into public.collection as c (user_id, card_id, foil, full_art, qty)
    select p_id, id, false, false, q from public.cards
    on conflict (user_id, card_id, foil, full_art)
    do update set qty = least(9223372036854775807::numeric, c.qty::numeric + q)::bigint, last_at = now();
  perform log_admin(a, 'grant_all', p_id, jsonb_build_object('qty', p_qty));
end $$;

create or replace function public.admin_take(p_id uuid, p_card text, p_foil boolean, p_full boolean) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin();
begin
  delete from public.collection where user_id = p_id and card_id = p_card and foil = p_foil and full_art = p_full;
  perform log_admin(a, 'take', p_id, jsonb_build_object('card', p_card, 'foil', p_foil, 'fullArt', p_full));
end $$;

-- action: kick | ban | unban | block | unblock | wipe | reset | promote | demote
create or replace function public.admin_action(p_id uuid, p_action text, p_reason text default null, p_minutes int default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin(); e jsonb := cfg('economy');
begin
  if not exists (select 1 from public.profiles where id = p_id) then raise exception 'Player not found'; end if;
  if p_id = a and p_action in ('kick','ban','block','demote','wipe') then raise exception 'You cannot do that to yourself'; end if;
  case p_action
    when 'kick' then
      perform kill_sessions(p_id);
      update public.profiles set kick_epoch = kick_epoch + 1 where id = p_id;
    when 'ban' then
      update public.profiles set status = 'banned', ban_reason = nullif(trim(p_reason), ''),
        ban_until = case when p_minutes is null or p_minutes <= 0 then null else now() + make_interval(mins => p_minutes) end,
        kick_epoch = kick_epoch + 1 where id = p_id;
      perform kill_sessions(p_id);
    when 'unban' then
      update public.profiles set status = 'ok', ban_reason = null, ban_until = null where id = p_id;
    when 'block' then
      update public.profiles set status = 'blocked', ban_reason = nullif(trim(p_reason), '') where id = p_id;
    when 'unblock' then
      update public.profiles set status = 'ok', ban_reason = null where id = p_id and status = 'blocked';
    when 'wipe' then
      delete from public.collection where user_id = p_id;
      delete from public.pulls where user_id = p_id;
      update public.profiles set orbs = (e ->> 'startOrbs')::bigint, pending = 0, last_tick = now(),
        daily_last = null, daily_streak = 0, packs_opened = 0, favorites = '{}', wipe_epoch = wipe_epoch + 1 where id = p_id;
    when 'reset' then
      update public.profiles set pending = 0, last_tick = now(), daily_last = null, daily_streak = 0,
        packs_opened = 0, favorites = '{}', wipe_epoch = wipe_epoch + 1 where id = p_id;
    when 'reset_2fa' then
      update public.profiles set twofa_enabled = false, twofa_email = null where id = p_id;
      delete from public.twofa_secrets where user_id = p_id;
      delete from public.totp_pending where user_id = p_id;
    when 'promote' then
      update public.profiles set role = 'admin' where id = p_id;
    when 'demote' then
      update public.profiles set role = 'player' where id = p_id;
    else raise exception 'Unknown action';
  end case;
  perform log_admin(a, p_action, p_id, jsonb_build_object('reason', p_reason, 'minutes', p_minutes));
  return jsonb_build_object('ok', true);
end $$;

-- p_id null = every player
create or replace function public.admin_popup(p_id uuid, p_title text, p_body text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin(); n int;
begin
  if coalesce(trim(p_body), '') = '' then raise exception 'Message is empty'; end if;
  if length(p_body) > 2000 or length(coalesce(p_title, '')) > 120 then raise exception 'Message is too long'; end if;
  insert into public.notifications(user_id, kind, title, body)
    select id, 'popup', nullif(trim(p_title), ''), p_body from public.profiles where p_id is null or id = p_id;
  get diagnostics n = row_count;
  perform log_admin(a, 'popup', p_id, jsonb_build_object('title', p_title, 'body', p_body, 'sent', n));
  return jsonb_build_object('sent', n);
end $$;

create or replace function public.admin_list_cards() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'creator', creator, 'set', set_name,
    'rarity', rarity, 'sellOverride', sell_override::text, 'value', card_value(id, false, false)::text,
    'enabled', enabled, 'custom', custom) order by sort, created_at, id) from public.cards), '[]'::jsonb);
end $$;

create or replace function public.admin_save_card(p_card jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin(); cid text := p_card ->> 'id'; so text := nullif(trim(coalesce(p_card ->> 'sellOverride', '')), '');
begin
  if coalesce(trim(p_card ->> 'name'), '') = '' or coalesce(trim(p_card ->> 'creator'), '') = '' then
    raise exception 'Name and creator are required';
  end if;
  if so is not null and so !~ '^\d{1,19}$' then raise exception 'Worth must be a whole number'; end if;
  if cid is null or cid = '' then
    cid := 'custom-' || trim(both '-' from regexp_replace(lower(p_card ->> 'name'), '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text), 1, 6);
    insert into public.cards(id, name, creator, set_name, rarity, sell_override, enabled, custom, sort)
      values (cid, trim(p_card ->> 'name'), trim(p_card ->> 'creator'), p_card ->> 'set', p_card ->> 'rarity',
              so::bigint, coalesce((p_card ->> 'enabled')::boolean, true), true, 10000);
    perform log_admin(a, 'card_add', null, p_card);
  else
    update public.cards set name = trim(p_card ->> 'name'), creator = trim(p_card ->> 'creator'),
      set_name = p_card ->> 'set', rarity = p_card ->> 'rarity', sell_override = so::bigint,
      enabled = coalesce((p_card ->> 'enabled')::boolean, true)
      where id = cid;
    if not found then raise exception 'Unknown card'; end if;
    perform log_admin(a, 'card_edit', null, p_card);
  end if;
  return jsonb_build_object('id', cid);
end $$;

create or replace function public.admin_delete_card(p_id text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin();
begin
  delete from public.cards where id = p_id and custom;
  if not found then raise exception 'Only custom cards can be deleted (disable built-in cards instead)'; end if;
  perform log_admin(a, 'card_delete', null, jsonb_build_object('id', p_id));
end $$;

create or replace function public.admin_list_packs() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description, 'size', size,
    'price', price::text, 'colors', colors, 'sets', sets, 'odds', odds, 'enabled', enabled, 'sort', sort) order by sort, id)
    from public.packs), '[]'::jsonb);
end $$;

create or replace function public.admin_save_pack(p_pack jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin(); pid text := nullif(trim(coalesce(p_pack ->> 'id', '')), ''); r text; o jsonb := '{}';
begin
  if coalesce(trim(p_pack ->> 'name'), '') = '' then raise exception 'Pack name is required'; end if;
  if coalesce(p_pack ->> 'price', '') !~ '^\d{1,19}$' then raise exception 'Price must be a whole number'; end if;
  foreach r in array rarities() loop
    o := o || jsonb_build_object(r, greatest(0, coalesce((p_pack -> 'odds' ->> r)::double precision, 0)));
  end loop;
  if pid is null then
    pid := trim(both '-' from regexp_replace(lower(p_pack ->> 'name'), '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text), 1, 4);
    insert into public.packs(id, name, description, size, price, colors, sets, odds, enabled, sort)
    values (pid, trim(p_pack ->> 'name'), coalesce(p_pack ->> 'description', ''), (p_pack ->> 'size')::int,
            (p_pack ->> 'price')::bigint,
            array(select jsonb_array_elements_text(coalesce(p_pack -> 'colors', '["#3ee8ff","#7a3cff"]'))),
            array(select jsonb_array_elements_text(p_pack -> 'sets')), o,
            coalesce((p_pack ->> 'enabled')::boolean, true), coalesce((p_pack ->> 'sort')::int, 100));
  else
    update public.packs set name = trim(p_pack ->> 'name'), description = coalesce(p_pack ->> 'description', ''),
      size = (p_pack ->> 'size')::int, price = (p_pack ->> 'price')::bigint,
      colors = array(select jsonb_array_elements_text(coalesce(p_pack -> 'colors', to_jsonb(colors)))),
      sets = array(select jsonb_array_elements_text(p_pack -> 'sets')), odds = o,
      enabled = coalesce((p_pack ->> 'enabled')::boolean, true), sort = coalesce((p_pack ->> 'sort')::int, sort)
      where id = pid;
    if not found then raise exception 'Unknown pack'; end if;
  end if;
  perform log_admin(a, 'pack_save', null, p_pack);
  return jsonb_build_object('id', pid);
end $$;

-- key: rarity_sell | modifiers | economy
create or replace function public.admin_set_config(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin(); k text;
begin
  if p_key not in ('rarity_sell','modifiers','economy') then raise exception 'Unknown setting'; end if;
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Bad value'; end if;
  if p_key = 'rarity_sell' then
    foreach k in array rarities() loop
      if coalesce(p_value ->> k, '') !~ '^\d{1,18}$' then raise exception 'Worth of % must be a whole number', k; end if;
    end loop;
  elsif p_key = 'economy' then
    foreach k in array array['startOrbs','perHour','cap','dailyBase','dailyPerStreak','dailyMax'] loop
      if coalesce(p_value ->> k, '') !~ '^\d{1,15}(\.\d+)?$' then raise exception '% must be a number', k; end if;
    end loop;
  elsif p_key = 'modifiers' then
    foreach k in array array['foil','fullArt'] loop
      if coalesce((p_value -> k ->> 'chance')::double precision, -1) not between 0 and 100
         or coalesce(p_value -> k ->> 'bonus', '') !~ '^\d{1,18}$' then raise exception 'Bad % settings', k; end if;
    end loop;
  end if;
  insert into public.config(key, value) values (p_key, p_value) on conflict (key) do update set value = excluded.value;
  perform log_admin(a, 'config_' || p_key, null, p_value);
end $$;

create or replace function public.admin_security() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin();
begin
  return jsonb_build_object(
    'locks', coalesce((select jsonb_agg(to_jsonb(l) order by last_attempt desc) from public.login_attempts l
                       where failures > 0 or locked_until > now()), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x) from (select jsonb_build_object('username', username, 'ok', ok, 'reason', reason,
                       'ip', ip, 'ua', ua, 'at', at) x from public.login_events order by at desc limit 200) t), '[]'::jsonb));
end $$;

create or replace function public.admin_unlock(p_key text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin();
begin
  delete from public.login_attempts where key = p_key or p_key = '*';
  perform log_admin(a, 'unlock', null, jsonb_build_object('key', p_key));
end $$;

create or replace function public.admin_logs() returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare a uuid := assert_admin();
begin
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('admin', (select username from public.profiles where id = l.admin_id), 'action', action,
      'target', (select username from public.profiles where id = l.target), 'details', details, 'at', at) x
    from public.admin_log l order by at desc limit 300) t), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Service functions (Edge Function only, via the service-role key)
-- ---------------------------------------------------------------------
-- Record a failed attempt against a key and lock when over the limit.
create or replace function public.srv_fail(p_key text, p_max int, p_window interval, p_base_lock interval, p_max_lock interval)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare r public.login_attempts; lock_for interval;
begin
  insert into public.login_attempts(key, failures, window_start, last_attempt) values (p_key, 0, now(), now())
    on conflict (key) do nothing;
  select * into r from public.login_attempts where key = p_key for update;
  if r.window_start < now() - p_window and (r.locked_until is null or r.locked_until < now()) then
    r.failures := 0; r.window_start := now();
  end if;
  r.failures := r.failures + 1;
  if r.failures >= p_max then
    -- 1st lock = base, then doubles for every extra failure, capped
    lock_for := least(p_max_lock, p_base_lock * power(2, least(20, r.failures - p_max)));
    r.locked_until := now() + lock_for;
  end if;
  update public.login_attempts set failures = r.failures, window_start = r.window_start,
    locked_until = r.locked_until, last_attempt = now() where key = p_key;
end $$;

create or replace function public.srv_locked(p_key text) returns timestamptz
language sql stable security definer set search_path = public, pg_temp
as $$ select locked_until from public.login_attempts where key = p_key and locked_until > now() $$;

-- Password check. Returns user info or an error code. Never says whether the username exists.
create or replace function public.srv_login(p_username text, p_password text, p_ip text, p_ua text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  uname text := lower(trim(coalesce(p_username, '')));
  u record; ok boolean := false; lock_u timestamptz; lock_ip timestamptz; p public.profiles;
begin
  lock_ip := srv_locked('ip:' || coalesce(p_ip, '?'));
  lock_u  := srv_locked('u:' || uname);
  if lock_ip is not null or lock_u is not null then
    insert into public.login_events(username, ok, reason, ip, ua) values (uname, false, 'locked', p_ip, p_ua);
    return jsonb_build_object('error', 'locked', 'until', greatest(lock_ip, lock_u));
  end if;

  select au.id, au.email, au.encrypted_password into u
    from public.profiles pr join auth.users au on au.id = pr.id
    where lower(pr.username) = uname;
  if u.id is not null and u.encrypted_password is not null then
    ok := extensions.crypt(coalesce(p_password, ''), u.encrypted_password) = u.encrypted_password;
  else
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));  -- same work either way (timing)
  end if;

  if not ok then
    perform srv_fail('u:' || uname, 5, interval '15 minutes', interval '1 minute', interval '1 hour');
    perform srv_fail('ip:' || coalesce(p_ip, '?'), 30, interval '10 minutes', interval '15 minutes', interval '1 hour');
    insert into public.login_events(user_id, username, ok, reason, ip, ua) values (u.id, uname, false, 'bad password', p_ip, p_ua);
    return jsonb_build_object('error', 'invalid');
  end if;

  select * into p from public.profiles where id = u.id;
  if p.status = 'banned' and (p.ban_until is null or p.ban_until > now()) then
    insert into public.login_events(user_id, username, ok, reason, ip, ua) values (u.id, uname, false, 'banned', p_ip, p_ua);
    return jsonb_build_object('error', 'banned', 'reason', p.ban_reason, 'until', p.ban_until);
  end if;
  if p.status = 'banned' then
    update public.profiles set status = 'ok', ban_reason = null, ban_until = null where id = u.id;
  end if;
  delete from public.login_attempts where key = 'u:' || uname;
  return jsonb_build_object('userId', u.id, 'email', u.email, 'username', p.username,
    'twofa', p.twofa_enabled and exists (select 1 from public.twofa_secrets t where t.user_id = u.id), 'role', p.role);
end $$;

create or replace function public.srv_check_password(p_user uuid, p_password text) returns boolean
language sql stable security definer set search_path = public, extensions, pg_temp
as $$ select coalesce((select extensions.crypt(coalesce(p_password, ''), encrypted_password) = encrypted_password
                       from auth.users where id = p_user), false) $$;

create or replace function public.srv_username_taken(p_username text) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.profiles where lower(username) = lower(trim(p_username))) $$;

create or replace function public.srv_create_profile(p_user uuid, p_username text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id, username, orbs) values (p_user, trim(p_username), (cfg('economy') ->> 'startOrbs')::bigint);
end $$;

create or replace function public.srv_log_login(p_user uuid, p_username text, p_ok boolean, p_reason text, p_ip text, p_ua text)
returns void language sql security definer set search_path = public, pg_temp
as $$ insert into public.login_events(user_id, username, ok, reason, ip, ua) values (p_user, lower(p_username), p_ok, p_reason, p_ip, p_ua) $$;

create or replace function public.srv_register_session(p_session uuid, p_user uuid, p_twofa boolean, p_imp uuid, p_ip text, p_ua text)
returns void language sql security definer set search_path = public, pg_temp
as $$ insert into public.app_sessions(session_id, user_id, twofa, impersonated_by, ip, ua)
      values (p_session, p_user, p_twofa, p_imp, p_ip, left(p_ua, 300))
      on conflict (session_id) do update set twofa = excluded.twofa $$;

-- Is this (user, session) a live admin session with 2FA?
create or replace function public.srv_is_admin(p_user uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.app_sessions a join public.profiles p on p.id = a.user_id
                     join auth.sessions s on s.id = a.session_id
                     where a.session_id = p_session and a.user_id = p_user and a.twofa and p.role = 'admin'
                       and p.status = 'ok') $$;

create or replace function public.srv_session_ok(p_user uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.app_sessions a join auth.sessions s on s.id = a.session_id
                     join public.profiles p on p.id = a.user_id
                     where a.session_id = p_session and a.user_id = p_user and p.status <> 'banned') $$;

create or replace function public.srv_user_email(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select email from auth.users where id = p_user $$;

-- 2FA challenges. Codes are stored as SHA-256 hashes.
drop function if exists public.srv_new_challenge(uuid, text, text, text, text, text);
drop function if exists public.srv_check_challenge(uuid, text, text);
drop function if exists public.srv_set_twofa(uuid, text);

-- A login waiting for its authenticator code. Valid 10 minutes, 5 tries.
create or replace function public.srv_new_challenge(p_user uuid, p_purpose text, p_ip text, p_ua text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare cid uuid;
begin
  if (select count(*) from public.twofa_challenges where user_id = p_user and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Too many login attempts. Wait a few minutes.';
  end if;
  delete from public.twofa_challenges where user_id = p_user and purpose = p_purpose;
  insert into public.twofa_challenges(user_id, purpose, code_hash, email, expires_at, ip, ua)
    values (p_user, p_purpose, '', '', now() + interval '10 minutes', p_ip, p_ua)
    returning id into cid;
  return cid;
end $$;

-- Uses up one try. Returns {userId, left} or {error:'expired'}.
create or replace function public.srv_challenge_attempt(p_id uuid, p_purpose text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare c public.twofa_challenges;
begin
  select * into c from public.twofa_challenges where id = p_id and purpose = p_purpose for update;
  if not found or c.expires_at < now() or c.attempts >= 5 then
    delete from public.twofa_challenges where id = p_id;
    return jsonb_build_object('error', 'expired');
  end if;
  update public.twofa_challenges set attempts = attempts + 1 where id = p_id;
  return jsonb_build_object('userId', c.user_id, 'left', 4 - c.attempts);
end $$;

create or replace function public.srv_challenge_done(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp
as $$ delete from public.twofa_challenges where id = p_id $$;

-- Authenticator-app setup and checks
create or replace function public.srv_totp_begin(p_user uuid, p_secret text) returns void
language sql security definer set search_path = public, pg_temp
as $$ insert into public.totp_pending(user_id, secret) values (p_user, p_secret)
      on conflict (user_id) do update set secret = excluded.secret, created_at = now() $$;

create or replace function public.srv_totp_pending(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select secret from public.totp_pending where user_id = p_user and created_at > now() - interval '15 minutes' $$;

create or replace function public.srv_totp_enable(p_user uuid, p_step bigint) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.twofa_secrets(user_id, secret, last_step)
    select user_id, secret, p_step from public.totp_pending where user_id = p_user
    on conflict (user_id) do update set secret = excluded.secret, last_step = excluded.last_step, created_at = now();
  if not found then raise exception 'Setup expired. Start again.'; end if;
  delete from public.totp_pending where user_id = p_user;
  update public.profiles set twofa_enabled = true, twofa_email = null where id = p_user;
end $$;

create or replace function public.srv_totp_secret(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select secret from public.twofa_secrets where user_id = p_user $$;

-- Accepts a code's time step only once (no replay). True if accepted.
create or replace function public.srv_totp_use(p_user uuid, p_step bigint) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.twofa_secrets set last_step = p_step where user_id = p_user and last_step < p_step;
  return found;
end $$;

create or replace function public.srv_twofa_disable(p_user uuid) returns void
language sql security definer set search_path = public, pg_temp
as $$
  delete from public.twofa_secrets where user_id = p_user;
  delete from public.totp_pending where user_id = p_user;
  update public.profiles set twofa_enabled = false, twofa_email = null where id = p_user;
$$;

create or replace function public.srv_mark_twofa(p_session uuid) returns void
language sql security definer set search_path = public, pg_temp
as $$ update public.app_sessions set twofa = true where session_id = p_session $$;

create or replace function public.srv_profile(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp
as $$ select jsonb_build_object('username', username, 'role', role, 'twofa', twofa_enabled, 'status', status)
      from public.profiles where id = p_user $$;

create or replace function public.srv_after_password_reset(p_user uuid, p_admin uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform kill_sessions(p_user);
  update public.profiles set kick_epoch = kick_epoch + 1 where id = p_user;
  if p_admin is not null then perform log_admin(p_admin, 'set_password', p_user, null); end if;
end $$;

create or replace function public.srv_log_admin(p_admin uuid, p_action text, p_target uuid) returns void
language sql security definer set search_path = public, pg_temp
as $$ select log_admin(p_admin, p_action, p_target, null) $$;

-- Housekeeping: remove app_sessions whose auth session is gone, old challenges.
create or replace function public.srv_cleanup() returns void
language sql security definer set search_path = public, pg_temp
as $$
  delete from public.twofa_challenges where expires_at < now() - interval '1 hour';
  delete from public.app_sessions a where not exists (select 1 from auth.sessions s where s.id = a.session_id);
  delete from public.login_attempts where last_attempt < now() - interval '1 day' and (locked_until is null or locked_until < now());
  delete from public.login_events where at < now() - interval '90 days';
$$;

-- ---------------------------------------------------------------------
-- Permissions: nothing callable except what is granted here.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.get_catalog() to anon, authenticated;
grant execute on function
  public.get_state(), public.collect_orbs(), public.claim_daily(),
  public.open_pack(text, int, text), public.sell(jsonb), public.sell_duplicates(text[]), public.toggle_favorite(text),
  public.get_notifications(),
  public.admin_list_players(text), public.admin_player_detail(uuid), public.admin_set_orbs(uuid, text, text),
  public.admin_grant(uuid, text, boolean, boolean, text), public.admin_grant_all(uuid, text),
  public.admin_take(uuid, text, boolean, boolean), public.admin_action(uuid, text, text, int),
  public.admin_popup(uuid, text, text), public.admin_list_cards(), public.admin_save_card(jsonb),
  public.admin_delete_card(text), public.admin_list_packs(), public.admin_save_pack(jsonb),
  public.admin_set_config(text, jsonb), public.admin_security(), public.admin_unlock(text), public.admin_logs()
to authenticated;

grant execute on function
  public.srv_fail(text, int, interval, interval, interval), public.srv_locked(text),
  public.srv_login(text, text, text, text), public.srv_check_password(uuid, text),
  public.srv_username_taken(text), public.srv_create_profile(uuid, text),
  public.srv_log_login(uuid, text, boolean, text, text, text),
  public.srv_register_session(uuid, uuid, boolean, uuid, text, text), public.srv_is_admin(uuid, uuid),
  public.srv_session_ok(uuid, uuid), public.srv_user_email(uuid),
  public.srv_new_challenge(uuid, text, text, text), public.srv_challenge_attempt(uuid, text), public.srv_challenge_done(uuid),
  public.srv_totp_begin(uuid, text), public.srv_totp_pending(uuid), public.srv_totp_enable(uuid, bigint),
  public.srv_totp_secret(uuid), public.srv_totp_use(uuid, bigint), public.srv_twofa_disable(uuid),
  public.srv_mark_twofa(uuid), public.srv_profile(uuid),
  public.srv_after_password_reset(uuid, uuid), public.srv_log_admin(uuid, text, uuid),
  public.srv_cleanup()
to service_role;

-- ---------------------------------------------------------------------
-- Default values (only inserted if missing; edit them in the admin panel)
-- ---------------------------------------------------------------------
insert into public.config(key, value) values
  ('rarity_sell', '{"common":2,"uncommon":5,"rare":15,"epic":50,"legendary":200,"mythic":1000}'),
  ('modifiers',   '{"foil":{"chance":8,"bonus":4},"fullArt":{"chance":6,"bonus":5}}'),
  ('economy',     '{"startOrbs":500,"perHour":60,"cap":600,"dailyBase":100,"dailyPerStreak":20,"dailyMax":300}')
on conflict (key) do nothing;

insert into public.packs(id, name, description, size, price, colors, sets, odds, sort) values
  ('demon', 'Demon Pack', 'Demons of every difficulty.', 5, 100, '{"#ff3e6c","#7a1fff"}', '{Easy,Medium,Hard,Insane,Extreme}',
   '{"common":52,"uncommon":29,"rare":14.5,"epic":4,"legendary":0.4,"mythic":0.1}', 1),
  ('classic', 'Classic Pack', 'RobTop''s official levels.', 5, 30, '{"#3ee8ff","#2b5cff"}', '{Official}',
   '{"common":52,"uncommon":29,"rare":14.5,"epic":4,"legendary":0.5,"mythic":0}', 2),
  ('easy-medium', 'Easy & Medium', 'A gentle start.', 5, 50, '{"#4fd17a","#ffd23e"}', '{Easy,Medium}',
   '{"common":52,"uncommon":29,"rare":14.5,"epic":4,"legendary":0.4,"mythic":0.1}', 3),
  ('hard-insane', 'Hard & Insane', 'Getting serious.', 5, 75, '{"#ff8a3e","#ff4fb3"}', '{Hard,Insane}',
   '{"common":52,"uncommon":29,"rare":14.5,"epic":4,"legendary":0.4,"mythic":0.1}', 4),
  ('extreme', 'Extreme Pack', 'Only the hardest demons.', 5, 200, '{"#ff3e3e","#1a0b2e"}', '{Extreme}',
   '{"common":45.06,"uncommon":31,"rare":17.2,"epic":6,"legendary":0.7,"mythic":0.04}', 5)
on conflict (id) do nothing;

-- Cards (level names belong to their creators; Geometry Dash by RobTop Games)
insert into public.cards(id, name, creator, set_name, rarity, sort) values
  ('stereo-madness', 'Stereo Madness', 'RobTop', 'Official', 'common', 1),
  ('back-on-track', 'Back on Track', 'RobTop', 'Official', 'common', 2),
  ('polargeist', 'Polargeist', 'RobTop', 'Official', 'common', 3),
  ('dry-out', 'Dry Out', 'RobTop', 'Official', 'common', 4),
  ('base-after-base', 'Base After Base', 'RobTop', 'Official', 'common', 5),
  ('cant-let-go', 'Cant Let Go', 'RobTop', 'Official', 'uncommon', 6),
  ('jumper', 'Jumper', 'RobTop', 'Official', 'uncommon', 7),
  ('time-machine', 'Time Machine', 'RobTop', 'Official', 'uncommon', 8),
  ('cycles', 'Cycles', 'RobTop', 'Official', 'uncommon', 9),
  ('xstep', 'xStep', 'RobTop', 'Official', 'uncommon', 10),
  ('clutterfunk', 'Clutterfunk', 'RobTop', 'Official', 'rare', 11),
  ('theory-of-everything', 'Theory of Everything', 'RobTop', 'Official', 'rare', 12),
  ('electroman-adventures', 'Electroman Adventures', 'RobTop', 'Official', 'rare', 13),
  ('electrodynamix', 'Electrodynamix', 'RobTop', 'Official', 'rare', 14),
  ('hexagon-force', 'Hexagon Force', 'RobTop', 'Official', 'rare', 15),
  ('blast-processing', 'Blast Processing', 'RobTop', 'Official', 'epic', 16),
  ('geometrical-dominator', 'Geometrical Dominator', 'RobTop', 'Official', 'epic', 17),
  ('fingerdash', 'Fingerdash', 'RobTop', 'Official', 'epic', 18),
  ('dash', 'Dash', 'RobTop', 'Official', 'legendary', 19),
  ('the-seven-seas', 'The Seven Seas', 'RobTop', 'Official', 'common', 20),
  ('viking-arena', 'Viking Arena', 'RobTop', 'Official', 'common', 21),
  ('airborne-robots', 'Airborne Robots', 'RobTop', 'Official', 'uncommon', 22),
  ('press-start', 'Press Start', 'RobTop', 'Official', 'common', 23),
  ('nock-em', 'Nock Em', 'RobTop', 'Official', 'uncommon', 24),
  ('power-trip', 'Power Trip', 'RobTop', 'Official', 'rare', 25),
  ('theory-of-everything-2', 'Theory of Everything 2', 'RobTop', 'Easy', 'uncommon', 26),
  ('the-nightmare', 'The Nightmare', 'Jax', 'Easy', 'common', 27),
  ('problematic', 'Problematic', 'Dhafin', 'Easy', 'common', 28),
  ('the-lightning-road', 'The Lightning Road', 'timeless real', 'Easy', 'uncommon', 29),
  ('clubstep', 'Clubstep', 'RobTop', 'Medium', 'uncommon', 30),
  ('deadlocked', 'Deadlocked', 'RobTop', 'Medium', 'rare', 31),
  ('supersonic', 'Supersonic', 'ZenthicAlpha', 'Medium', 'uncommon', 32),
  ('jawbreaker', 'Jawbreaker', 'ZenthicAlpha', 'Hard', 'rare', 33),
  ('nine-circles', 'Nine Circles', 'Zobros', 'Hard', 'rare', 34),
  ('xo', 'Xo', 'KrmaL', 'Hard', 'rare', 35),
  ('plasma-pulse', 'Plasma Pulse', 'Smokes', 'Insane', 'rare', 36),
  ('cataclysm', 'Cataclysm', 'Ggb0y', 'Extreme', 'rare', 37),
  ('change-of-scene', 'Change of Scene', 'Bianox', 'Extreme', 'rare', 38),
  ('bloodbath', 'Bloodbath', 'Riot', 'Extreme', 'epic', 39),
  ('sonic-wave', 'Sonic Wave', 'Cyclic', 'Extreme', 'epic', 40),
  ('yatagarasu', 'Yatagarasu', 'TrusTa', 'Extreme', 'epic', 41),
  ('kenos', 'Kenos', 'Bianox', 'Extreme', 'epic', 42),
  ('zodiac', 'Zodiac', 'Bianox', 'Extreme', 'epic', 43),
  ('erebus', 'Erebus', 'Bo', 'Extreme', 'epic', 44),
  ('sakupen-circles', 'Sakupen Circles', 'Diamond', 'Extreme', 'epic', 45),
  ('bloodlust', 'Bloodlust', 'Knobbelboy', 'Extreme', 'epic', 46),
  ('windy-landscape', 'Windy Landscape', 'WOOGI1411', 'Extreme', 'epic', 47),
  ('limbo', 'Limbo', 'MindCap', 'Extreme', 'epic', 48),
  ('artificial-ascent', 'Artificial Ascent', 'Viprin', 'Extreme', 'epic', 49),
  ('plasma-pulse-finale', 'Plasma Pulse Finale', 'Smokes', 'Extreme', 'epic', 50),
  ('allegiance', 'Allegiance', 'Nikroplays', 'Extreme', 'epic', 51),
  ('the-golden', 'The Golden', 'Bo', 'Extreme', 'legendary', 52),
  ('tartarus', 'Tartarus', 'Dolphy', 'Extreme', 'legendary', 53),
  ('acheron', 'Acheron', 'ryamu', 'Extreme', 'legendary', 54),
  ('slaughterhouse', 'Slaughterhouse', 'icedcave', 'Extreme', 'legendary', 55),
  ('abyss-of-darkness', 'Abyss of Darkness', 'Exen', 'Extreme', 'legendary', 56),
  ('avernus', 'Avernus', 'PockeWindfish', 'Extreme', 'legendary', 57),
  ('firework', 'Firework', 'Trick', 'Extreme', 'legendary', 58),
  ('kocmoc', 'Kocmoc', 'Luqualizer', 'Extreme', 'legendary', 59),
  ('acu', 'Acu', 'Neigefeu', 'Extreme', 'legendary', 60),
  ('silent-clubstep', 'Silent Clubstep', 'TheRealSailent', 'Extreme', 'mythic', 61),
  ('tidal-wave', 'Tidal Wave', 'OniLink', 'Extreme', 'mythic', 62)
on conflict (id) do nothing;
