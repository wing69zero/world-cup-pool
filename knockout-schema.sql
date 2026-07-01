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
select id, '2026-07-04 00:00:00+00'::timestamptz, 125, 125
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
  '2026-07-04 00:00:00+00'::timestamptz + (s.slot_no - 1) * interval '4 hours',
  s.team_a,
  s.team_b
from pools p
cross join (
  values
    (1, 'R16', 'Round of 16 - Match 1', 'R16 Team A1', 'R16 Team B1'),
    (2, 'R16', 'Round of 16 - Match 2', 'R16 Team A2', 'R16 Team B2'),
    (3, 'R16', 'Round of 16 - Match 3', 'R16 Team A3', 'R16 Team B3'),
    (4, 'R16', 'Round of 16 - Match 4', 'R16 Team A4', 'R16 Team B4'),
    (5, 'R16', 'Round of 16 - Match 5', 'R16 Team A5', 'R16 Team B5'),
    (6, 'R16', 'Round of 16 - Match 6', 'R16 Team A6', 'R16 Team B6'),
    (7, 'R16', 'Round of 16 - Match 7', 'R16 Team A7', 'R16 Team B7'),
    (8, 'R16', 'Round of 16 - Match 8', 'R16 Team A8', 'R16 Team B8'),
    (9, 'QF', 'Quarter-final 1', 'QF Team A1', 'QF Team B1'),
    (10, 'QF', 'Quarter-final 2', 'QF Team A2', 'QF Team B2'),
    (11, 'QF', 'Quarter-final 3', 'QF Team A3', 'QF Team B3'),
    (12, 'QF', 'Quarter-final 4', 'QF Team A4', 'QF Team B4'),
    (13, 'SF', 'Semi-final 1', 'SF Team A1', 'SF Team B1'),
    (14, 'SF', 'Semi-final 2', 'SF Team A2', 'SF Team B2'),
    (15, '3P', 'Third-place match', 'Third-place Team A', 'Third-place Team B'),
    (16, 'Final', 'Final', 'Finalist A', 'Finalist B')
) as s(slot_no, stage, label, team_a, team_b)
where p.code in ('KO2026', 'KOTEST2026')
on conflict (id) do nothing;
