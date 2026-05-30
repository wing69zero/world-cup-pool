insert into pools (name, code, entry_amount)
values ('World Cup 2026 Test Pool', 'Test2026', 20)
on conflict (code) do update
set name = excluded.name,
    entry_amount = excluded.entry_amount;
