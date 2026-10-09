-- Audyt 3, PK-03, N-100 (A3-20-4): telefon po własnej wysyłce pobierał zwykle dwa razy — drugi raz z powodu własnego
-- sygnału Realtime (private.poke_groups na końcu sync_push niesie wersję grupy, a kursor telefonu rośnie dopiero po
-- pobraniu). sync_push zwraca teraz także wersje grup, które zmienił (`versions`: {id grupy: wersja po zapisie}),
-- więc telefon wie, że sygnał z tą wersją to jego własna zmiana, którą i tak pobierze zaraz po wysyłce
-- (src/sync/runtime.ts, SyncRuntime.isFresh). Zgodne wstecz: starsze telefony (build 21) pomijają nowe pole.
-- Zastępuje: public.sync_push (ostatnia definicja: 20261008484000_sync_perf.sql) — treść bez zmian poza `versions`.
-- Uprawnienia funkcji zostają (create or replace nie zmienia GRANT).

create or replace function public.sync_push(client_id uuid, schema_version int, ops jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  last bigint;
  op jsonb;
  seq bigint;
  results jsonb := '[]'::jsonb;
  touched uuid[] := '{}';
  g uuid;
  code text;
  st text;
begin
  if schema_version < private.schema_version() then raise exception 'upgrade_required' using errcode = 'P0001'; end if;
  if jsonb_typeof(ops) <> 'array' then raise exception 'invalid_batch' using errcode = 'P0001'; end if;
  if jsonb_array_length(ops) > private.push_batch_max() then raise exception 'batch_too_large' using errcode = 'P0001'; end if;
  last := private.claim_client(client_id);
  perform private.forget_rejections(client_id, (select min((x ->> 'seq')::bigint) from jsonb_array_elements(ops) x));
  -- M-192: blokady grup z paczki od razu, w stałej kolejności (po id) — dwie paczki dotykające tych samych grup
  -- w odwrotnej kolejności nie zakleszczą się. Polecenia (cmd) blokują swoje grupy same, w trakcie.
  perform private.lock_groups(array(select private.op_group(x) from jsonb_array_elements(ops) x));

  for op in select value from jsonb_array_elements(ops) loop
    seq := (op ->> 'seq')::bigint;
    if seq is null then raise exception 'invalid_batch:seq' using errcode = 'P0001'; end if;
    if seq <= last then
      -- Już przetworzona (np. odpowiedź zginęła w sieci i klient ponawia): nic nie robimy drugi raz. Odrzucenie
      -- zwracamy jeszcze raz (M-56) — inaczej zmiana znikała z telefonu bez wpisu w „Odrzuconych zmianach”.
      code := private.recall_rejection(client_id, seq, op ->> 'op_id');
      results := results || case when code is null then jsonb_build_object('seq', seq, 'status', 'duplicate')
                                 else jsonb_build_object('seq', seq, 'status', 'rejected', 'code', code) end;
      continue;
    end if;
    last := seq;
    perform set_config('organizer.op_id', coalesce(op ->> 'op_id', ''), true);
    begin
      g := private.apply_op(op);
      if g is not null then touched := touched || g; end if;
      results := results || jsonb_build_object('seq', seq, 'status', 'ok');
    exception
      -- Błędy przejściowe przerywają całe wywołanie — klient ponowi z opóźnieniem, nic nie zostało zapisane.
      when serialization_failure or deadlock_detected or lock_not_available or query_canceled
           or admin_shutdown or crash_shutdown or cannot_connect_now or too_many_connections then
        raise;
      when others then
        get stacked diagnostics st = returned_sqlstate;
        code := case
          when st = 'P0001' then sqlerrm
          when st = '42501' then 'forbidden'
          when st like '23%' then 'invalid:' || st
          when st like '22%' then 'invalid_value'
          else 'error:' || st end;
        results := results || jsonb_build_object('seq', seq, 'status', 'rejected', 'code', code);
        perform private.remember_rejection(client_id, seq, op ->> 'op_id', code);
    end;
  end loop;
  perform set_config('organizer.op_id', '', true);
  perform private.set_client_seq(client_id, last);
  perform private.poke_groups(touched);
  return jsonb_build_object('last_seq', last, 'results', results,
    'versions', (select coalesce(jsonb_object_agg(x.id, x.version), '{}'::jsonb) from public.groups x where x.id = any (touched)));
end $$;
