-- Audyt 2, paczka P16, M-190 (B-21, Q-22): serwer przyjmuje dokładnie te reguły powtarzania, które telefon rozwinie.
-- Dotąd wzorzec przepuszczał np. INTERVAL=0, COUNT=0, powtórzone klucze, BYDAY=XX,, czy INTERVAL=1000000 — telefon takiej
-- reguły nie rozwinie (parseRule rzuca RuleError), więc wydarzenie albo zadanie znikało z widoków.
--  * private.rrule_ok — te same warunki co parseRule w src/domain/rrule.ts (RFC 5545, podzbiór; źródło w tamtym pliku:
--    https://www.rfc-editor.org/rfc/rfc5545#section-3.3.10): klucze FREQ, INTERVAL (1–99), BYDAY (dni z opcjonalnym
--    numerem tylko przy MONTHLY; tylko WEEKLY i MONTHLY), BYMONTHDAY (±1–31 bez zera, tylko MONTHLY bez BYDAY), COUNT
--    (1–1000), UNTIL (istniejąca data RRRRMMDD), WKST=MO; każdy klucz najwyżej raz; COUNT i UNTIL nie razem.
--  * private.task_repeat_ok — powtarzanie zadań: dokładnie zapisy, które czyta parseRepeat (src/domain/views/task-repeat.ts).
-- Zgodność pilnuje test na prawdziwym SQL (tests/db/rrule-contract.test.ts): każda reguła z korpusu RRULE, każdy zapis
-- z formularza powtarzania, reguły z szybkiego dodawania i lista reguł błędnych — SQL i telefon mówią to samo.
-- Testy SQL: supabase/tests/rrule_check.test.sql.
-- Istniejące wiersze: CHECK sprawdza nowe zapisy; zadania ograniczenie dostaje NOT VALID i walidację, jeśli dane pozwalają.

-- Istniejąca data RRRRMMDD w kalendarzu gregoriańskim (jak isValidDate w src/domain/civil-date.ts, także rok 0000 —
-- bez make_date, który roku 0 nie zna).
create function private.rrule_date_ok(s text) returns boolean language plpgsql immutable set search_path = '' as $$
declare y int; mo int; d int;
begin
  if s is null or s !~ '^[0-9]{8}$' then return false; end if;
  y := substr(s, 1, 4)::int; mo := substr(s, 5, 2)::int; d := substr(s, 7, 2)::int;
  if mo < 1 or mo > 12 or d < 1 then return false; end if;
  return d <= case when mo = 2 then case when (y % 4 = 0 and y % 100 <> 0) or y % 400 = 0 then 29 else 28 end
                   when mo in (4, 6, 9, 11) then 30 else 31 end;
end $$;

create or replace function private.rrule_ok(r text) returns boolean language plpgsql immutable set search_path = '' as $$
declare
  p text;
  kv text[];
  m jsonb := '{}';
  freq text;
  x text;
  numbered boolean := false;
begin
  if r is null then return true; end if;
  if char_length(r) > 200 then return false; end if;
  foreach p in array pg_catalog.string_to_array(r, ';') loop
    kv := pg_catalog.string_to_array(p, '=');
    if pg_catalog.cardinality(kv) <> 2 or kv[1] = '' or m ? kv[1] then return false; end if;
    if kv[1] not in ('FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'COUNT', 'UNTIL', 'WKST') then return false; end if;
    m := m || jsonb_build_object(kv[1], kv[2]);
  end loop;
  freq := m ->> 'FREQ';
  if freq is null or freq not in ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY') then return false; end if;
  if m ? 'WKST' and m ->> 'WKST' <> 'MO' then return false; end if;
  if m ? 'INTERVAL' and not (m ->> 'INTERVAL' ~ '^[0-9]+$' and (m ->> 'INTERVAL')::numeric between 1 and 99) then return false; end if;
  if m ? 'COUNT' and not (m ->> 'COUNT' ~ '^[0-9]+$' and (m ->> 'COUNT')::numeric between 1 and 1000) then return false; end if;
  if m ? 'UNTIL' and not private.rrule_date_ok(m ->> 'UNTIL') then return false; end if;
  if m ? 'COUNT' and m ? 'UNTIL' then return false; end if;
  if m ? 'BYDAY' then
    foreach x in array pg_catalog.regexp_split_to_array(m ->> 'BYDAY', ',') loop
      if x !~ '^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$' then return false; end if;
      if x ~ '^[+-]?[1-5]' then numbered := true; end if;
    end loop;
    if numbered and freq <> 'MONTHLY' then return false; end if;
    if freq not in ('WEEKLY', 'MONTHLY') then return false; end if;
  end if;
  if m ? 'BYMONTHDAY' then
    foreach x in array pg_catalog.regexp_split_to_array(m ->> 'BYMONTHDAY', ',') loop
      if x !~ '^-?[0-9]{1,2}$' or x::int = 0 or abs(x::int) > 31 then return false; end if;
    end loop;
    if freq <> 'MONTHLY' or m ? 'BYDAY' then return false; end if;
  end if;
  return true;
end $$;

create function private.task_repeat_ok(r text) returns boolean language sql immutable set search_path = '' as $$
  select r is null or r ~ ('^(AFTER=(DAILY|WEEKLY);INTERVAL=[1-9][0-9]?|FREQ=DAILY|FREQ=MONTHLY(;BYMONTHDAY=([1-9]|[12][0-9]|3[01]|-1))?'
                           || '|FREQ=WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*)$')
$$;

alter table public.tasks drop constraint tasks_repeat_check;
alter table public.tasks add constraint tasks_repeat_check check (private.task_repeat_ok(repeat)) not valid;
do $$
begin
  alter table public.tasks validate constraint tasks_repeat_check;
exception when check_violation then
  raise warning 'tasks_repeat_check: są zadania z zapisem powtarzania spoza formularza — zostają do ręcznego przejrzenia';
end $$;

grant execute on function private.rrule_ok(text), private.rrule_date_ok(text), private.task_repeat_ok(text) to authenticated;
