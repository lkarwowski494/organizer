# 0008. Zadania na spotkaniu, przepinanie, „Dodaj do kalendarza” (7.10.2026)

Ten dokument wykonuje decyzje właściciela z rejestru:
- **D13:** zadanie podpięte do wystąpienia dziedziczy jego termin i idzie za spotkaniem; na żądanie może mieć własny termin.
- **D14:** przy odwołaniu albo usunięciu wystąpienia aplikacja pyta, co zrobić z zadaniami. Do wyboru:
  - przepnij na kolejne wystąpienie;
  - przepnij na inne spotkanie;
  - odepnij;
  - usuń.
- **D7:** przycisk „Dodaj do kalendarza” z dostępem tylko do zapisu.
- **Faza 0:** podgląd skutków edycji serii połączony z przepinaniem zadań.

Właściciel wybrał tę kolejność prac 7.10.2026 („Kalendarz – reszta”).

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Podpięcie zapisujemy w zadaniu:** `tasks.event_id` + `tasks.occurrence_date`. `occurrence_date` to data wystąpienia według reguły, ten sam klucz co w `event_overrides`.
   - Dochodzi tryb terminu `event`: termin liczy telefon z wystąpienia, z uwzględnieniem przeniesienia i godziny z wyjątku.
   - Tryb `own` przy zachowanym podpięciu to własny termin z D13.
   - Odrzucone: osobna tabela powiązań, bo jedno zadanie ma najwyżej jedno spotkanie; kopia terminu w zadaniu, odrzucona już przez D13.
2. **Odwołanie na innym telefonie nie rusza zadań.** Wystąpienie odwołane albo usunięte z reguły daje zadanie bez terminu z komunikatem „Spotkanie odwołane albo zmienione” (dziś „Wydarzenie odwołane albo zmienione” — słowo „wydarzenie” w całej aplikacji, docs/glossary.md) i przyciskiem „Przepnij”. Nic nie ginie (R1).
   - Odrzucone: serwer odpina zadania przy odwołaniu. Utrudniłoby to cofnięcie odwołania.
3. **Zmiana serii pokazuje podgląd przed zapisem.**
   - Podgląd zawiera najbliższe 3 terminy po zmianie i liczbę zadań, które przejdą same.
   - Pokazuje też zadania, których termin znika. Dla nich wybór: najbliższy nowy termin albo odpięcie.
   - Przy „to i następne” zadania od dnia zmiany przechodzą do nowej serii.
   - Wszystko zapisuje się w jednej transakcji z edycją.
4. **Zadanie dodane na ekranie spotkania** trafia na listę zadań grupy (wybór, gdy list jest kilka). Gdy grupa nie ma listy zadań, aplikacja zakłada listę „Zadania”.
5. **„Dodaj do kalendarza” korzysta z expo-calendar SDK 57** (https://docs.expo.dev/versions/v57.0.0/sdk/calendar/).
   - Prosi o zgodę tylko na zapis: `requestCalendarPermissions(true)`, iOS 17+. Na iOS 16 (najniższym, D35) expo-calendar prosi wtedy o zwykły dostęp do kalendarza (`requestAccess(to: .event)` w `CalendarWriteOnlyNextPermissionsRequester.swift`) — jedno okno zgody, potem ten sam formularz (uzupełnione 9.10.2026).
   - Otwiera systemowy formularz: `getDefaultCalendarSync().addEventWithForm`. Zapis zatwierdza użytkownik.
   - Wtyczka ustawia tylko `NSCalendarsWriteOnlyAccessUsageDescription`. → Rozszerzone przez D95–D96 (ADR 0021): pełny dostęp (`writeOnlyAccess: false`) dla kalendarza w obie strony.
   - Dodaje jedno wystąpienie. Godziny przelicza z czasu warszawskiego (`localToMs`, test zgodny z Pythonem zoneinfo).
   - Bez godziny końca wydarzenie trwa 60 min (wybór projektowy).
   - Odrzucone: pełny dostęp do kalendarza, wykluczony przez D7. → Zmienione przez D95 (ADR 0021).

## Otwarte (produktowe)
- Czy „Dodaj do kalendarza” dla serii ma dodawać całą serię (reguła powtarzania w iOS), czy jak teraz jedno wystąpienie.
