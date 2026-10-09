# 0037. Wydarzenia przez kilka dni i przez północ (D199, audyt 2, 8.10.2026)

Decyzja właściciela: PW-53 wariant A (M-99) — obóz (cały dzień od A do B) i nocny dyżur (22:00–06:00) bez rozbijania
na osobne wpisy.

## Model (RFC 5545, https://www.rfc-editor.org/rfc/rfc5545)
- Całodniowe: `events.days` — liczba dni (1 = jeden dzień). §3.6.1: „The "DTEND" property for a "VEVENT" calendar
  component specifies the non-inclusive end of the event” — koniec wyłączny = dzień startu + `days` (tak zapisujemy
  w iPhonie), ostatni pokazywany dzień = start + `days` − 1. Długość, nie data końca, bo w serii każde wystąpienie trwa
  tyle samo (§3.8.5.3: „the same exact duration will apply to all the members of the generated recurrence set”);
  jeden termin może mieć inną (`event_overrides.days`, `null` = jak w serii; §3.8.5.3: „The duration of a specific
  recurrence may be modified in an exception component”). Limit `config.events.MAX_DAYS` (31) = `private.event_max_days()`.
- Z godziną: koniec nie później niż początek = następnego dnia; „8:00–8:00” = doba, koniec o północy („20:00–00:00”)
  nie wchodzi na następny dzień (koniec wyłączny). Z godziną `days` = 1 (wyzwalacz w SQL).
- Z godziną przez więcej niż jedną noc (decyzja koordynatora 8.10.2026, wyjazd pt. 18:00 – nd. 16:00): `duration_min`
  w wydarzeniu i wyjątku (migracja 20261008531000_event_duration) — §3.8.2.5 DURATION („may be used to specify a duration
  of the event, instead of an explicit end DATE-TIME”); dla dat „dur-day” (stąd `days`), dla godzin „dur-time”. `null` =
  długość z godzin, zapisana tylko, gdy dłuższa. Godzina końca zostaje w wierszu i musi pasować do początku + długości —
  zmiana godzin z buildu 21 (nie zna długości) zeruje ją, więc wydarzenie znaczy to, co build 21 pokazał. Wyjątek z tymi
  samymi godzinami co seria, ale inną długością, zapisuje długość wprost (dla serwera to nie „jak w serii”, M-95).
- Odrzucone: kolumna `end_date` (przy zmianie startu serii i przy „to i następne” trzeba by ją przesuwać); `days` także
  dla wydarzeń z godziną (zmiana godzin z buildu 21 zostawiłaby starą liczbę dni bez możliwości wykrycia).

## Zachowanie
- Formularz: pole „Kończy się” (nie „Do dnia” — tak nazywa się już koniec powtarzania serii i planu lekcji), także przy
  „O godzinie”: domyślnie ten sam dzień, a przy końcu nie później niż początek — następny („Kończy się następnego dnia.”);
  wybrany dalszy dzień daje długość od początku do godziny końca tego dnia. Przesunięcie startu przesuwa koniec; błędy:
  przed startem, bez godziny końca, koniec przed początkiem, ponad limit, powtórzenia nachodzące na siebie (plan lekcji
  i rutyny — bez zmian, koniec po początku). Szkic (D179) obejmuje nowe pole.
- Moje sprawy, Kalendarz (także kropki w siatce) i iPhone: wydarzenie w każdym swoim dniu — „dzień 2 z 5”, pierwszy dzień
  dłuższego „od 18:00”, ostatni „do 16:00” (nocnego: „22:00–06:00”, potem „do 06:00”), środkowe „cały dzień”; ekran
  wydarzenia: „od 18:00 · 46 h” i „Kończy się: …, 16:00”; to samo dla wydarzeń z iPhone'a zamiast „cd.” (M-253). Kolejny dzień jest
  dublem wpisu iPhone'a tylko z kolejnym dniem wpisu aplikacji o tej samej nazwie.
- Przypomnienie i „Czas wyjść” raz, przed startem; kolejne dni bez przypomnień i poza porannym podsumowaniem.
- Lustro i „Dodaj do kalendarza”: jedno wydarzenie przez wszystkie dni. „Dodaj do grupy” z iPhone'a przenosi ostatni dzień
  całodniowego i koniec następnego dnia (krócej niż doba).
- „To i następne” (`split_event`): długość (`days`, `duration_min`) z polecenia, bez niej (starszy telefon) — jak w
  dzielonej serii.
- Build 21 nie zna `days`: widzi wielodniowe w dniu startu, nocny dyżur jako „22:00–06:00” (z długością ujemną w wierszu);
  jego zmiana obozu na „o godzinie” nie jest odrzucana (days = 1), a formularz nie zapisze nocnego dyżuru bez zmiany godzin.
