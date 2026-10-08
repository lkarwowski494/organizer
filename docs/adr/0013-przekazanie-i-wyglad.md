# 0013. Przekazanie odpowiedzialności, wygląd jasny/ciemny, „osoba odpowiedzialna” (7.10.2026)

Zgłoszenie właściciela: do nowej wersji tryb jasny, nowa ikona i wyraźniejszy motyw. Lista w formie metra zostaje. Pole „Kto zawozi” ma się nazywać ogólniej („osoba odpowiedzialna”). Zadanie, które jest na mnie, ma dać się przekazać dorosłemu z grupy. Ta osoba dostaje powiadomienie i musi przekazanie potwierdzić.

## Decyzje produktowe (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D69 | Jak włączać tryb jasny | Ustawienie w aplikacji: „Jak w iPhonie” (domyślnie), „Jasny”, „Ciemny”. Wybór zapisany na telefonie. | Tylko według ustawień iPhone'a |
| D70 | Przekazanie odpowiedzialności | Zadania i wydarzenia. Powiadomienie push i w aplikacji. Odbiorca przyjmuje albo odrzuca. Odrzucone zostaje u nadawcy z informacją. | Tylko zadania; tylko w aplikacji; odrzucone wraca do puli grupy |
| — | Nazwa pola z D66 | „Osoba odpowiedzialna” — pasuje do każdego typu wydarzenia | „Kto zawozi” |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Przekazanie to osobny wiersz (`handoffs`), nie pole zadania.**
   - Do przyjęcia odpowiedzialność zostaje u nadawcy.
   - Przyjęcie przenosi ją na serwerze w tej samej transakcji: `assignee_member_id`, `events.responsible_member_id` albo wyjątek terminu.
   - Odrzucone: zmiana od razu i cofanie przy odrzuceniu. Wtedy przez chwilę zadanie byłoby „u nikogo”, a dwie osoby widziałyby różne stany.
2. **Kto może.**
   - Przekazuje tylko osoba, na której sprawa jest teraz (serwer to sprawdza).
   - Odbiorca to dorosły z kontem w grupie, który widzi listę.
   - Dzieci nie przekazują i nie przyjmują.
   - Jedno oczekujące przekazanie na zadanie, serię albo termin.
3. **Wydarzenie cykliczne:** przekazać można jeden termin albo całą serię. Całą serię tylko wtedy, gdy odpowiadam za całą serię.
4. **Wiersz widzą tylko nadawca i odbiorca (RLS).** Reszta grupy widzi już wynik, czyli nową osobę odpowiedzialną.
5. **Nadawca zamyka informację o odrzuceniu („OK”).** Wiersz zostaje jako historia; przekazań się nie usuwa.
6. **Gdzie to widać.**
   - Sekcja „Do potwierdzenia” na „Dotyczy mnie”.
   - Plakietka z liczbą na zakładce „Dziś”.
   - Na ekranie zadania lub wydarzenia: „Czeka na przyjęcie: X” z możliwością anulowania.
   - Audyt 2 (T-5): w „Do potwierdzenia” i na plakietce tylko to, co jest jeszcze do przyjęcia — bez zadań zrobionych
     (jednorazowych) i spraw w koszu. Zrobionego zadania się nie przekazuje.
   - Zadanie powtarzane przekazuje się jako obowiązek, nie jeden termin (decyzja właściciela z 8.10.2026): przyjęcie
     przenosi na odbiorcę niezrobione terminy łańcucha (przekazany i kolejne kopie), zrobione zostają w historii nadawcy;
     gdy nic niezrobionego nie zostało — „nieaktualne”, przekazanie czeka dalej (serwer: migracja
     20261008330000_handoff_obligation). „Czeka na przyjęcie” widać przy niezrobionym terminie.
7. **Powiadomienie push to osobny etap.** → zrobione w ADR 0015.
   - Wymaga tokenów urządzeń, funkcji wysyłającej przez APNs i włączenia Push Notifications w identyfikatorze aplikacji w Apple Developer.
   - Do tego czasu przekazanie widać w aplikacji po synchronizacji.
