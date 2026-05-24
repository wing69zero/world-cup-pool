create extension if not exists pgcrypto;

create table if not exists pools (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'World Cup 2026 Pool',
  code text not null unique,
  entry_amount numeric(10, 2) not null default 20,
  created_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references pools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (pool_id, name)
);

create table if not exists matches (
  id text primary key,
  pool_id uuid not null references pools(id) on delete cascade,
  match_no integer,
  group_name text,
  home_team text not null,
  away_team text not null,
  kickoff timestamptz not null,
  venue text,
  source text,
  home_score integer,
  away_score integer,
  created_at timestamptz not null default now()
);

create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references pools(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  match_id text not null references matches(id) on delete cascade,
  home_score integer not null,
  away_score integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pool_id, player_id, match_id)
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists predictions_set_updated_at on predictions;
create trigger predictions_set_updated_at
before update on predictions
for each row execute function set_updated_at();

alter table pools enable row level security;
alter table players enable row level security;
alter table matches enable row level security;
alter table predictions enable row level security;

drop policy if exists "Casual pool read pools" on pools;
drop policy if exists "Casual pool write pools" on pools;
drop policy if exists "Casual pool read players" on players;
drop policy if exists "Casual pool write players" on players;
drop policy if exists "Casual pool read matches" on matches;
drop policy if exists "Casual pool write matches" on matches;
drop policy if exists "Casual pool read predictions" on predictions;
drop policy if exists "Casual pool write predictions" on predictions;

create policy "Casual pool read pools" on pools for select to anon using (true);
create policy "Casual pool write pools" on pools for update to anon using (true) with check (true);
create policy "Casual pool read players" on players for select to anon using (true);
create policy "Casual pool write players" on players for all to anon using (true) with check (true);
create policy "Casual pool read matches" on matches for select to anon using (true);
create policy "Casual pool write matches" on matches for all to anon using (true) with check (true);
create policy "Casual pool read predictions" on predictions for select to anon using (true);
create policy "Casual pool write predictions" on predictions for all to anon using (true) with check (true);

insert into pools (name, code, entry_amount)
values ('World Cup 2026 Friends Pool', 'Fifa2026', 20)
on conflict (code) do update
set name = excluded.name;
