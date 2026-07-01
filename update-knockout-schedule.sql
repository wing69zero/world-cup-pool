update knockout_settings ks
set lock_at = '2026-07-04 17:00:00+00'::timestamptz,
    goals_pot = 125,
    bracket_pot = 125,
    updated_at = now()
from pools p
where ks.pool_id = p.id
  and p.code in ('KO2026', 'KOTEST2026');

update knockout_matches km
set stage = s.stage,
    label = s.label,
    kickoff = s.kickoff,
    team_a = s.team_a,
    team_b = s.team_b
from pools p
join (
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
on p.code in ('KO2026', 'KOTEST2026')
where km.pool_id = p.id
  and km.slot_no = s.slot_no;
