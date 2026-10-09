-- Audyt 3, PK-01, N-2 (decyzja Q12 część 3 A): dołączenie poprawnym kodem do pełnej grupy (limit:group_rows albo
-- limit:group_size z 20261010011000_write_limits — nowy członek to też wiersz grupy) kończy się tym kodem i komunikatem
-- na telefonie (groups.error.groupFull), a nie „Nieprawidłowe ID grupy albo kod”, i nie liczy się jako nieudana próba
-- kodu — tak jak limit grup na konto (limit:groups, M-70). Jedyna zmiana: warunek `err like 'limit:%'`.
-- Zastępuje: private.join_group (20261008486000_join_handoff_fixes). Testy: supabase/tests/server_limits.test.sql.

create or replace function private.join_group(p_join_id text, p_code text, p_display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  jid text := regexp_replace(coalesce(p_join_id, ''), '\D', '', 'g');
  code text := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  res jsonb;
  err text;
begin
  if me is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('organizer.join_user'), hashtext(me::text));
  perform pg_advisory_xact_lock(hashtext('organizer.join_id'), hashtext(jid));
  if (select count(*) from private.join_attempts where user_id = me and at > now() - interval '1 hour') >= private.join_fails_per_user() then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  -- Tylko bieżące ID grupy (po zmianie ID stare nie prowadzi nigdzie).
  if not exists (select 1 from public.groups where join_id = jid and deleted_at is null) then
    err := 'invite_invalid';
  else
    begin
      perform set_config('organizer.join_code', '1', true);
      res := private.accept_invite(jid || ':' || code, p_display_name);
      perform set_config('organizer.join_code', '', true);
    exception when sqlstate 'P0001' then
      err := sqlerrm;
    end;
  end if;
  if err is null then return res; end if;
  -- Limit grup na konto (M-70) i pełna grupa (audyt 3, N-2): poprawny kod, więc to nie jest nieudana próba.
  if err like 'limit:%' then return jsonb_build_object('error', err); end if;
  insert into private.join_attempts (user_id, join_id) values (me, jid);
  -- Kody tej grupy, które od utworzenia zebrały limit nieudanych prób, przestają działać. Próby starsze niż doba czyści
  -- daily_maintenance, a kod żyje 24 h (join_code_ttl_hours), więc liczą się wszystkie z jego życia.
  update public.invites i set revoked_at = now()
    from public.groups g
    where g.join_id = jid and i.group_id = g.id and i.kind = 'code' and i.revoked_at is null and i.expires_at > now()
      and (select count(*) from private.join_attempts a where a.join_id = jid and a.at >= i.created_at) >= private.join_fails_per_code();
  -- Na zewnątrz: nieznane ID grupy i zły kod dają ten sam błąd invite_invalid (nie zdradzamy, czy grupa o tym ID istnieje).
  -- Szczegółowe kody (wygasł, unieważniony, wykorzystany, usunięto Cię) dostaje tylko ktoś, kto trafił w prawdziwy kod
  -- tej grupy — wie wtedy, że grupa istnieje albo istniała; to akceptowane, bo kod daje i tak więcej (audyt 2, M-182, B-13).
  return jsonb_build_object('error', case when err in ('invite_expired', 'invite_revoked', 'invite_used_up', 'invite_removed', 'invite_child_account') then err else 'invite_invalid' end);
end $$;
