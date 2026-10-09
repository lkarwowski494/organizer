-- Pierwsza cyfra ID grupy z równym rozkładem (migracja 20261008580000_join_id_first_digit, audyt 2 M-157).
begin;
select plan(3);

create temp table ids as select private.new_join_id() as v from generate_series(1, 4500);

select ok((select bool_and(v ~ '^[1-9][0-9]{8}$') from ids), '1: 9 cyfr, bez zera na początku');
-- Równy rozkład: 4500 / 9 = 500 na cyfrę (odchylenie ≈ 21). Dawny wzór dawał jedynce 2/10 = 900.
select ok((select count(*) between 400 and 620 from ids where left(v, 1) = '1'), '2: jedynka nie częściej niż inne cyfry');
select ok((select min(c) >= 400 and max(c) <= 620 from (select count(*) as c from ids group by left(v, 1)) s)
  and (select count(distinct left(v, 1)) = 9 from ids), '3: każda cyfra 1–9 w granicach równego rozkładu');

select * from finish();
rollback;
