-- Audyt 3, paczka PK-11 (ta sama klasa co N-40, decyzja koordynatora 9.10.2026): „Cofnij” po zmianie roli administratora
-- na członka (MemberScreen, Q6b A) przywracał rolę, ale nie jego zaproszeń osobistych, które ta zmiana unieważniła
-- (link, kody profili dzieci — Q7 A, 20261010100000_invites_membership). Teraz utrata roli zapraszającego zapisuje
-- znacznik unieważnienia, a odzyskanie roli (owner/admin) cofa dokładnie to, co ma ten znacznik — kod profilu dziecka tylko,
-- gdy profil nie ma nowszego działającego kodu (jeden kod profilu, private.issue_child_code). Unieważnione wcześniej
-- albo ręcznie nie wracają. Testy: supabase/tests/role_undo_invites.test.sql.
-- Tylko „Cofnij” (decyzja koordynatora 9.10.2026): powrót roli najpóźniej private.role_undo_window_sec() po jej utracie
-- (czas serwera). Późniejsze ponowne nadanie roli to nowa decyzja — dawne linki i kody zostają unieważnione (bez
-- niespodzianki dla właściciela). Okno zamiast znacznika w operacji: „Cofnij” to zwykła zmiana roli (patch), więc
-- rozpoznanie nie wymaga zmiany protokołu ani nowego pola, które stare telefony by wysyłały inaczej. Telefon, który był
-- offline przy obu zmianach, wysyła je w jednej paczce (mieści się w oknie); „Cofnij” dostarczony po oknie zostawia
-- zaproszenia unieważnione — bezpieczny kierunek.
-- Nowe: tabela private.role_invite_marks (poza synchronizacją, bez dostępu dla klientów), private.role_undo_window_sec().
-- Zastępuje:
-- private.group_members_role_invites (20261010100000_invites_membership); wyzwalacz group_members_y_role_invites bez zmian.

create table private.role_invite_marks (
  member_id uuid primary key references public.group_members (member_id) on delete cascade,
  revoked_at timestamptz not null
);
revoke all on private.role_invite_marks from public, anon, authenticated;

-- = config.invites.ROLE_UNDO_WINDOW_SEC (test kontraktowy: pasek „Cofnij”, wysyłka i ponowienia mieszczą się w oknie).
create function private.role_undo_window_sec() returns int language sql immutable set search_path = '' as $$ select 180 $$;
revoke all on function private.role_undo_window_sec() from public, anon, authenticated;

create or replace function private.group_members_role_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v timestamptz;
begin
  if old.role in ('owner', 'admin') and new.role not in ('owner', 'admin') then
    v := clock_timestamp();
    update public.invites set revoked_at = v
      where created_by = new.member_id and revoked_at is null and (member_id is not null or kind <> 'code');
    insert into private.role_invite_marks (member_id, revoked_at) values (new.member_id, v)
      on conflict (member_id) do update set revoked_at = excluded.revoked_at;
  elsif old.role not in ('owner', 'admin') and new.role in ('owner', 'admin') and new.deleted_at is null then
    delete from private.role_invite_marks where member_id = new.member_id returning revoked_at into v;
    if v is not null and clock_timestamp() - v <= make_interval(secs => private.role_undo_window_sec()) then
      update public.invites i set revoked_at = null
        where i.created_by = new.member_id and i.revoked_at = v and (i.member_id is not null or i.kind <> 'code')
          and (i.member_id is null
               or (exists (select 1 from public.group_members c where c.member_id = i.member_id and c.deleted_at is null
                           and c.user_id is null and c.role = 'child')
                   and not exists (select 1 from public.invites j where j.member_id = i.member_id and j.revoked_at is null)));
    end if;
  end if;
  return null;
end $$;
