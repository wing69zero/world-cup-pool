insert into pools (name, code, entry_amount)
values
  ('World Cup 2026 Knockout Pool', 'KO2026', 25),
  ('World Cup 2026 Knockout Test Pool', 'KOTEST2026', 25)
on conflict (code) do update
set name = excluded.name,
    entry_amount = excluded.entry_amount;

create table if not exists knockout_settings (
  pool_id uuid primary key references pools(id) on delete cascade,
  lock_at timestamptz not null,
  goals_pot numeric(10, 2) not null default 125,
  bracket_pot numeric(10, 2) not null default 125,
  updated_at timestamptz not null default now()
);

create table if not exists knockout_matches (
  id text primary key,
  pool_id uuid not null references pools(id) on delete cascade,
  slot_no integer not null,
  stage text not null,
  label text not null,
  kickoff timestamptz not null,
  team_a text not null,
  team_b text not null,
  actual_total_goals integer,
  winner text,
  created_at timestamptz not null default now(),
  unique (pool_id, slot_no)
);

create table if not exists knockout_predictions (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references pools(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  match_id text not null references knockout_matches(id) on delete cascade,
  goals_prediction integer,
  winner_prediction text,
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

drop trigger if exists knockout_predictions_set_updated_at on knockout_predictions;
create trigger knockout_predictions_set_updated_at
before update on knockout_predictions
for each row execute function set_updated_at();

alter table knockout_settings enable row level security;
alter table knockout_matches enable row level security;
alter table knockout_predictions enable row level security;

drop policy if exists "Casual pool read knockout settings" on knockout_settings;
drop policy if exists "Casual pool write knockout settings" on knockout_settings;
drop policy if exists "Casual pool read knockout matches" on knockout_matches;
drop policy if exists "Casual pool write knockout matches" on knockout_matches;
drop policy if exists "Casual pool read knockout predictions" on knockout_predictions;
drop policy if exists "Casual pool write knockout predictions" on knockout_predictions;

create policy "Casual pool read knockout settings" on knockout_settings for select to anon using (true);
create policy "Casual pool write knockout settings" on knockout_settings for all to anon using (true) with check (true);
create policy "Casual pool read knockout matches" on knockout_matches for select to anon using (true);
create policy "Casual pool write knockout matches" on knockout_matches for all to anon using (true) with check (true);
create policy "Casual pool read knockout predictions" on knockout_predictions for select to anon using (true);
create policy "Casual pool write knockout predictions" on knockout_predictions for all to anon using (true) with check (true);

insert into knockout_settings (pool_id, lock_at, goals_pot, bracket_pot)
select id, '2026-07-04 17:00:00+00'::timestamptz, 125, 125
from pools
where code in ('KO2026', 'KOTEST2026')
on conflict (pool_id) do nothing;

insert into knockout_matches (id, pool_id, slot_no, stage, label, kickoff, team_a, team_b)
select
  lower(p.code) || '-ko-' || s.slot_no,
  p.id,
  s.slot_no,
  s.stage,
  s.label,
  s.kickoff,
  s.team_a,
  s.team_b
from pools p
cross join (
  values
    (1, 'R16', 'M89: Round of 16 - PAR vs FRA', '2026-07-04 21:00:00+00'::timestamptz, 'PAR', 'FRA'),
    (2, 'R16', 'M90: Round of 16 - CAN vs MAR', '2026-07-04 17:00:00+00'::timestamptz, 'CAN', 'MAR'),
    (3, 'R16', 'M91: Round of 16 - BRA vs NOR', '2026-07-05 20:00:00+00'::timestamptz, 'BRA', 'NOR'),
    (4, 'R16', 'M92: Round of 16 - MEX vs W80', '2026-07-06 00:00:00+00'::timestamptz, 'MEX', 'W80'),
    (5, 'R16', 'M93: Round of 16 - W83 vs W84', '2026-07-06 19:00:00+00'::timestamptz, 'W83', 'W84'),
    (6, 'R16', 'M94: Round of 16 - W81 vs W82', '2026-07-07 00:00:00+00'::timestamptz, 'W81', 'W82'),
    (7, 'R16', 'M95: Round of 16 - W86 vs W88', '2026-07-07 16:00:00+00'::timestamptz, 'W86', 'W88'),
    (8, 'R16', 'M96: Round of 16 - W85 vs W87', '2026-07-07 20:00:00+00'::timestamptz, 'W85', 'W87'),
    (9, 'QF', 'M97: Quarter-final - W89 vs W90', '2026-07-09 20:00:00+00'::timestamptz, 'W89', 'W90'),
    (10, 'QF', 'M98: Quarter-final - W93 vs W94', '2026-07-10 19:00:00+00'::timestamptz, 'W93', 'W94'),
    (11, 'QF', 'M99: Quarter-final - W91 vs W92', '2026-07-11 21:00:00+00'::timestamptz, 'W91', 'W92'),
    (12, 'QF', 'M100: Quarter-final - W95 vs W96', '2026-07-12 01:00:00+00'::timestamptz, 'W95', 'W96'),
    (13, 'SF', 'M101: Semi-final - W97 vs W98', '2026-07-14 19:00:00+00'::timestamptz, 'W97', 'W98'),
    (14, 'SF', 'M102: Semi-final - W99 vs W100', '2026-07-15 19:00:00+00'::timestamptz, 'W99', 'W100'),
    (15, '3P', 'M103: Third-place match - RU101 vs RU102', '2026-07-18 21:00:00+00'::timestamptz, 'RU101', 'RU102'),
    (16, 'Final', 'M104: Final - W101 vs W102', '2026-07-19 19:00:00+00'::timestamptz, 'W101', 'W102')
) as s(slot_no, stage, label, kickoff, team_a, team_b)
where p.code in ('KO2026', 'KOTEST2026')
on conflict (id) do nothing;
