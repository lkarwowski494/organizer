-- Reguły powtarzania w SQL (audyt 2, M-190; migracja 20261008485000_rrule_check). Pełne porównanie z telefonem:
-- tests/db/rrule-contract.test.ts.
begin;
select plan(8);

select ok(private.rrule_ok('FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231'), '1: zwykła reguła');
select ok(private.rrule_ok(null), '2: brak reguły');
select ok(not private.rrule_ok('FREQ=DAILY;INTERVAL=0'), '3: INTERVAL=0');
select ok(not private.rrule_ok('FREQ=DAILY;INTERVAL=5;INTERVAL=7'), '4: powtórzony klucz');
select ok(not private.rrule_ok('FREQ=DAILY;UNTIL=20260230'), '5: nieistniejąca data UNTIL');
select ok(not private.rrule_ok('FREQ=DAILY;' || repeat('WKST=MO;', 30)), '6: ponad 200 znaków');
select ok(private.task_repeat_ok('AFTER=WEEKLY;INTERVAL=2') and private.task_repeat_ok('FREQ=MONTHLY;BYMONTHDAY=31'), '7: zapisy formularza zadania');
select ok(not private.task_repeat_ok('FREQ=YEARLY') and not private.task_repeat_ok('FREQ=DAILY;INTERVAL=2'), '8: reguła, której zadanie na telefonie nie odczyta');

select * from finish();
rollback;
