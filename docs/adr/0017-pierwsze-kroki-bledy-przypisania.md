# 0017. Pierwsze kroki, zgłaszanie błędów i uwag, powiadomienia o przypisaniu (7.10.2026)

Prośba właściciela: przed szerokimi testami aplikacja ma mieć sensowny zestaw funkcji.
Wybrał trzy rzeczy z czterech zaproponowanych. Stałe zakupy i podpowiedzi zostały w backlogu (O-054).

## Decyzje produktowe (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D79 | Pierwsze kroki | Trzy ekrany wprowadzenia, potem start: grupa rodzinna, kod zaproszenia albo na razie samemu. Lepsze puste ekrany. | (inne funkcje w tej turze: stałe zakupy) |
| D80 | Zgłaszanie błędów i uwag | Aplikacja sama zapisuje błędy, bez treści z list. W Ustawieniach jest „Wyślij uwagę”. | — |
| D81 | Powiadomienia o przypisaniu | Push, gdy ktoś przypisze mi zadanie albo zakupy, z wyciszaniem per grupa w Ustawieniach. | — |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Wprowadzenie** pokazuje się raz na telefonie (zapamiętane w pęku kluczy). Można do niego wrócić z Ustawień. „Utwórz grupę rodzinną” podpowiada nazwę „Rodzina”.
2. **Błędy:**
   - Wysyłany jest tylko komunikat, stos, nazwa ekranu i wersja aplikacji. Nigdy treść z tabel.
   - Źródła: granica błędów (ekran „Coś poszło nie tak” z „Spróbuj ponownie”) i globalny handler wyjątków. Poprzedni handler wołamy dalej.
   - Limit: 50 błędów i 20 uwag dziennie na osobę. Ponad limit błędy są pomijane bez komunikatu, żeby pętla błędów nie zalała bazy.
   - Retencja 90 dni. Sprzątanie odbywa się przy zapisie, bez pg_cron. → Uzupełnione przez D82 (ADR 0018): sprząta też codzienny pg_cron.
   - Odczyt tylko w panelu Supabase. Liczby są w `config.feedback` (test kontraktowy z SQL).
3. **Przypisania** idą przez kanał aktywności.
   - Wpis aktywności z nową osobą przy `assignee_member_id` albo `responsible_member_id` powstaje na serwerze.
   - Telefon autora, gdy ten wpis zobaczy, woła funkcję `notify-handoff` z id wpisu.
   - Baza sprawdza, czy wołający jest autorem, czy odbiorca ma konto i nie jest autorem, czy wpis nie jest starszy niż 24 h, czy grupa nie jest wyciszona. Powiadamia najwyżej raz (`private.push_log`).
   - Odrzucone: wyzwalacz w bazie z `pg_net`. Powód jak w ADR 0015 (sekret i adres funkcji w bazie).
   - Audyt 2 (M-28): utworzenie, które tylko przenosi osobę z poprzedniego stanu sprawy, nie jest przypisaniem — kopia zadania powtarzanego i kopie jego podzadań (id = `nextId` źródła, w SQL `private.next_task_id`) oraz nowa seria albo wyjątek z „to i następne”, gdy osoba się nie zmieniła (znacznik `private.event_split_source`, do podłączenia przez paczkę P3). Telefon pomija kopie już u siebie, serwer sprawdza jeszcze raz. Dotknięcie otwiera sprawę (PWD-16).
4. **Wyciszenie** dotyczy przypisań. Przekazania (D70) czekają na decyzję, więc przychodzą zawsze. Wyciszenia są zapisane na serwerze (`push_mutes`), bo serwer decyduje o wysyłce. Sekcja w Ustawieniach nazywa się „Powiadomienia o przypisaniach” z dopiskiem, że przypomnienia i przekazania przychodzą zawsze (PWD-18, decyzja właściciela 8.10.2026).
5. **Wydarzenia z osobą odpowiedzialną** (D66) na razie nie wysyłają powiadomienia o przypisaniu. Do decyzji właściciela, jeśli potrzebne. → zastąpione przez D88 (ADR 0018).
