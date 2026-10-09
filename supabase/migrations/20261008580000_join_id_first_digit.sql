-- Audyt 2 (M-157): pierwsza cyfra ID grupy z równym rozkładem. Dotąd `1 + (cyfra % 9)` dawało jedynkę dwa razy
-- częściej (cyfry 0 i 9 → 1: 2/10, pozostałe 1/10). Teraz losujemy całe 9 cyfr i odrzucamy wynik z zerem na początku,
-- więc każde ID z [10^8, 10^9) ma tę samą szansę (rachunek: odrzucenie zachowuje rozkład równy na pozostałych
-- wartościach; średnio 10/9 losowania). Pierwsza cyfra 1–9 jak dotąd (ADR 0020 pkt 5), istniejące ID bez zmian.
create or replace function private.new_join_id() returns text language plpgsql volatile set search_path = '' as $$
declare v text;
begin
  loop
    v := private.random_digits(private.join_id_digits());
    exit when left(v, 1) <> '0' and not exists (select 1 from public.groups where join_id = v);
  end loop;
  return v;
end $$;
