-- Audyt 3, paczka PK-11: usunięcie osoby i „Cofnij”. Testy: supabase/tests/member_restore.test.sql.
--  * N-40 (A3-08-3): „Cofnij” po „Usuń z grupy” (i przywrócenie z kosza osób, D165) przywraca osobę w całości. Dotąd
--    wracała rola i listy „Tylko ja”, a oczekujące przekazania (w obie strony) zostawały anulowane, dostęp do list
--    „Wybrane osoby” odebrany, zaproszenia osobiste unieważnione, a zakres Moich spraw skasowany — po cichu.
--    Usunięcie znakuje wszystko, co zabiera, znacznikiem usunięcia osoby (group_members.deleted_at, serwer:
--    clock_timestamp() w apply_op), a przywrócenie przez owner/admin cofa dokładnie to, co ma ten znacznik:
--      - przekazania wracają do „czeka”, jeśli nadal mają sens (ta sama reguła co przy tworzeniu: rzecz nadal u nadawcy,
--        druga osoba w grupie, odbiorca dorosły z kontem i widzi listę, brak innego oczekującego przekazania tej rzeczy);
--      - dostęp do list „Wybrane osoby” (object_members);
--      - zaproszenia osobiste (link, kod profilu dziecka — ten tylko, gdy profil nie ma już nowszego kodu: jeden działający
--        kod profilu, jak w private.issue_child_code).
--    Powrót zaproszeniem (osoba sama wyszła albo wraca po czasie) przywraca jak dotąd tylko rzeczy samej osoby: listy
--    „Tylko ja” i (nowe) zakres Moich spraw; dostęp i przekazania nadają ponownie inni (decyzja z 20261008280000).
--    Przywrócenie od powrotu odróżnia flaga organizer.invite_hash, którą ustawia wyłącznie private.accept_invite.
--  * N-87 (A3-05-2) / N-40: zakres Moich spraw przy odejściu trafia do kosza (deleted_at), a nie znika — telefon tej osoby
--    dostaje nagrobek, a powrót przywraca ten sam wiersz (wcześniej telefon zostawał ze starym wierszem i każda zmiana
--    dostawała not_found).
-- Zastępuje: private.group_members_departure (20261010100000_invites_membership — wersja PK-10 z Q7 A, zmiany tylko
-- w znaczniku i w gałęzi powrotu), private.member_scope_cleanup i wyzwalacz group_members_z_scope_cleanup
-- (20261008570000_my_scopes_trips), private.my_day_scopes_guard (20261008570000_my_scopes_trips).
-- private.group_members_leave_scopes (20261008280000) bez zmian — usuwa dostęp; przywraca go teraz departure, przed
-- przekazaniami (wyzwalacz y_departure biegnie przed y_leave_scopes, a przekazanie na liście „Wybrane osoby” wymaga
-- dostępu odbiorcy). create or replace zachowuje uprawnienia.

create or replace function private.group_members_departure() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    perform set_config('organizer.member_cleanup', new.group_id::text, true);
    -- Znacznik = chwila usunięcia osoby: „Cofnij” przywraca tylko to, co zabrało to usunięcie (N-40).
    update public.handoffs set status = 'cancelled', decided_at = new.deleted_at
      where group_id = new.group_id and status = 'pending' and (from_member = new.member_id or to_member = new.member_id);
    update public.lists set deleted_at = new.deleted_at
      where group_id = new.group_id and owner_member_id = new.member_id and visibility = 'private' and deleted_at is null;
    perform set_config('organizer.member_cleanup', '', true);
    -- Q7 A: przy każdym odejściu (wyjście albo usunięcie przez kogoś innego) tylko zaproszenia osobiste.
    update public.invites set revoked_at = new.deleted_at
      where created_by = new.member_id and revoked_at is null and (member_id is not null or kind <> 'code');
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform set_config('organizer.member_cleanup', new.group_id::text, true);
    -- Listy prywatne zmienia tylko ich właściciel, a po wyjściu nikt ich nie widzi: wszystko, co trafiło do kosza od chwili
    -- wyjścia, trafiło tam z powodu wyjścia (wcześniej usunięte przez tę osobę zostają w koszu).
    update public.lists set deleted_at = null
      where group_id = new.group_id and owner_member_id = new.member_id and visibility = 'private' and deleted_at >= old.deleted_at;
    -- N-40: przywrócenie przez owner/admin („Cofnij”, kosz osób), nie powrót zaproszeniem.
    if coalesce(current_setting('organizer.invite_hash', true), '') = '' then
      update public.object_members set deleted_at = null
        where member_id = new.member_id and deleted_at = old.deleted_at;
      update public.handoffs h set status = 'pending', decided_at = null
        where h.group_id = new.group_id and h.status = 'cancelled' and h.decided_at = old.deleted_at
          and (h.from_member = new.member_id or h.to_member = new.member_id)
          and exists (select 1 from public.group_members f where f.member_id = h.from_member and f.deleted_at is null)
          and exists (select 1 from public.group_members t where t.member_id = h.to_member and t.deleted_at is null
                      and t.role <> 'child' and t.user_id is not null)
          and not exists (select 1 from public.handoffs p where p.entity = h.entity and p.entity_id = h.entity_id
                          and p.occurrence_date is not distinct from h.occurrence_date and p.status = 'pending')
          and case h.entity
            when 'tasks' then exists (select 1 from public.tasks x where x.id = h.entity_id and x.deleted_at is null
                                      and x.assignee_member_id = h.from_member and private.member_can_see_list(h.to_member, x.list_id))
            when 'lists' then exists (select 1 from public.lists x where x.id = h.entity_id and x.deleted_at is null
                                      and x.responsible_member_id = h.from_member and private.member_can_see_list(h.to_member, x.id))
            else exists (select 1 from public.events x where x.id = h.entity_id and x.deleted_at is null
                         and private.occurrence_responsible(x, h.occurrence_date) = h.from_member)
          end;
      update public.invites i set revoked_at = null
        where i.created_by = new.member_id and i.revoked_at = old.deleted_at and (i.member_id is not null or i.kind <> 'code')
          and (i.member_id is null
               or (exists (select 1 from public.group_members c where c.member_id = i.member_id and c.deleted_at is null
                           and c.user_id is null and c.role = 'child')
                   and not exists (select 1 from public.invites j where j.member_id = i.member_id and j.revoked_at is null)));
    end if;
    perform set_config('organizer.member_cleanup', '', true);
  end if;
  return null;
end $$;

-- Strażnik zakresu: sprzątanie po odejściu i powrocie (flaga organizer.member_cleanup) zmienia wiersz innej osoby.
-- Reszta bez zmian względem 20261008570000_my_scopes_trips.
create or replace function private.my_day_scopes_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'UPDATE' and new.member_id is distinct from old.member_id then
    raise exception 'immutable_column:member_id' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and current_setting('organizer.member_cleanup', true) = new.group_id::text then return new; end if;
  if new.member_id is distinct from private.my_member_id(new.group_id) then raise exception 'forbidden:not_self' using errcode = 'P0001'; end if;
  if tg_op = 'INSERT' and new.id <> private.uuid_v5('2432a5f3-a3c4-5bf6-92f5-7d368b14c8e9'::uuid, new.member_id::text) then
    raise exception 'invalid_id' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Odejście i zmiana konta przy członkostwie: zakres do kosza (nagrobek dla telefonu, N-87), ze znacznikiem odejścia.
-- Każdy powrót tej samej osoby (to samo konto) przywraca zakres usunięty razem z odejściem — to jej ustawienie, jak listy
-- „Tylko ja”. Nagrobki zostają (najwyżej jeden wiersz na członkostwo), nocne sprzątanie ich nie rusza.
create or replace function private.member_scope_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('organizer.member_cleanup', new.group_id::text, true);
  if old.deleted_at is not null and new.deleted_at is null and new.user_id is not distinct from old.user_id then
    update public.my_day_scopes set deleted_at = null where member_id = new.member_id and deleted_at = old.deleted_at;
  else
    update public.my_day_scopes set deleted_at = coalesce(new.deleted_at, clock_timestamp())
      where member_id = new.member_id and deleted_at is null;
  end if;
  perform set_config('organizer.member_cleanup', '', true);
  return null;
end $$;

drop trigger group_members_z_scope_cleanup on public.group_members;
create trigger group_members_z_scope_cleanup after update of deleted_at, user_id on public.group_members
  for each row when (new.deleted_at is not null or new.user_id is distinct from old.user_id
                     or (old.deleted_at is not null and new.deleted_at is null))
  execute function private.member_scope_cleanup();
