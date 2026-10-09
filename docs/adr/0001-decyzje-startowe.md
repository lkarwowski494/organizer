# ADR 0001 — decyzje startowe (5–6.10.2026)

Status: przyjęte przez właściciela. Pełne uzasadnienia, odrzucone warianty i źródła:
[Rejestr decyzji](https://docs.google.com/document/d/1ta-8A-_mhrFnvrv3GJY0QAKwOF0USgl9MZu5CglBYyk/edit)
i raporty researchu w folderze „Organizer grup” (dokumenty projektu właściciela).

## Wymagania
- **R1 Offline i online** — każda zmiana najpierw lokalnie, nic nie ginie, synchronizacja sama startuje po
  powrocie sieci, widoczny stan synchronizacji. Natychmiastowość tylko na pierwszym planie; w tle iOS daje
  „najlepszy wysiłek” (ciche pushe 2–3/h wg Apple). → Stan 9.10.2026: ciche powiadomienia budzą telefon tylko po to, żeby pobrał zmiany i przeplanował przypomnienia (D159, ADR 0016); ogólnej synchronizacji w tle (wysyłki kolejki bez otwierania aplikacji) nie ma.
- **R2 Spotkania i zadania** — wydarzenia jednorazowe i cykliczne (RRULE, RFC 5545); zadania przy jednym
  wystąpieniu, dziedziczenie terminu z możliwością własnego; dialog przepinania przy odwołaniu.
- **R3 Identyfikatory** — UUIDv7 nadawany na telefonie, zmiany per pole, operacje idempotentne.

## Decyzje
| ID | Temat | Decyzja |
|---|---|---|
| D0.1 | Platforma | tylko iOS; inne platformy i web później |
| D0.2 | Moduły MVP | zadania z podzadaniami, listy zakupów, kalendarz |
| D1 | Backend | Supabase Free, Frankfurt |
| D2 | Offline | własna kolejka operacji na expo-sqlite |
| D3 | Współdzielenie | grupa jako kontener + widoczność group/restricted/private |
| D4 | Podzadania | do 2 poziomów (`config.MAX_TASK_DEPTH`) |
| D5 | Logowanie | Sign in with Apple + magic link; usuwanie konta w aplikacji → w becie tylko Apple, logowania linkiem z e-maila nie ma (D177, ADR 0035) |
| D6 | Push | bezpośrednio APNs z Edge Function (potwierdzone spike'iem S1, ADR 0002) |
| D7 | Kalendarz iPhone | „Dodaj do kalendarza” (zapis); ICS po MVP. → rozszerzone przez D95–D96 (ADR 0021): odczyt i lustro grup |
| D8/D24 | SDK | nowy projekt, Expo SDK 57; 58 po Etapie 1 |
| D9 | Buildy | GitHub Actions + fastlane, repo publiczne po audycie → publiczne od 6.10.2026 (docs/audits/2026-10-06-przed-upublicznieniem.md) |
| D10/D19/D34 | Dzieci | profile bez kont, pochwała zamiast punktów, tryb dziecka → D19 (pochwała) niezrobione — w kodzie nie ma pochwały, licznik serii D114 (ADR 0028) „nie ocenia ani nie nagradza”; konto dziecka przez połączenie profilu (D155, ADR 0035) |
| D11/D22 | Model biznesowy | całkiem za darmo, bez reklam |
| D12 | Usypianie Supabase | ruch rodziny + monitor dostępności → nocny skrypt limitów z podtrzymaniem projektu (D185, ADR 0041), wdrożony 9.10.2026; działa po dodaniu sekretu `SUPABASE_MONITOR_TOKEN` w środowisku `monitor` (docs/limits.md), bez niego niczego nie mierzy ani nie podtrzymuje |
| D13–D16 | Terminy | dziedziczenie z wydarzenia (idzie za nim), pytanie przy odwołaniu, podzadania dziedziczą, bez terminu = przypięte na górze |
| D17 | Widżet | Faza 1; w MVP app group + SQLite w kontenerze grupy → niezrobione: uprawnienie app group jest w app.json, ale baza konta leży w domyślnym katalogu aplikacji (`openDatabaseSync` bez katalogu kontenera); przy widżecie trzeba przenieść plik bazy |
| D18 | Szybkie dodawanie | regułowy polski parser dat z etykietą do odklikania |
| D20 | Import ze zdjęcia | później, bez ustalonej fazy |
| D21 | Po Fazie 1 | rodzina + sloty „biorę to” + kolizje między grupami |
| D23 | Powtarzanie zadań | wg kalendarza lub od wykonania |
| D25 | ORM | Drizzle 0.45, migracje SQL źródłem prawdy. → zastąpione: zwykły SQL przez `src/data/db` (`DbAdapter`, migracje w `migrations.ts`), Drizzle nie został użyty (8.10.2026) |
| D26 | Nawigacja | React Navigation |
| D27 | Testy | Jest (domain + app), fast-check, Stryker |
| D28 | Certyfikaty | fastlane match w prywatnym `organizer-certs` |
| D29 | TestFlight | testerzy wewnętrzni, rola Marketing |
| D30 | Teksty | `strings.pl.ts` + `plural()` |
| D31 | Awarie | raporty Apple + własny reporter do `client_errors` |
| D32 | Kursor | wersja per grupa |
| D33 | Przypomnienia | lokalne na telefonie przypisanej osoby |
| D38–D39 | Repozytorium | publiczne po audycie; bez pliku licencji → publiczne od 6.10.2026 |
| D42–D45 | Szybkie dodawanie | reguły rozstrzygania parsera (ADR 0003) |
| D40 | Linki głębokie | schemat `io.github.lkarwowski494.organizer://` (`config.URL_SCHEME`) |
| D35–D37 | Identyfikacja | iOS 16.4+ (od 9.10.2026 jawnie `ios.deploymentTarget` w app.json = `config.IOS_MIN`, minimum Expo SDK 57; test kontraktowy); bundle `io.github.lkarwowski494.organizer`; nazwa robocza „Organizer” |

## Otwarte (do decyzji właściciela) — rozstrzygnięte
- Licencja kodu przed upublicznieniem repozytorium (szablon Expo zawierał licencję MIT 650 Industries —
  usunięta, bo dotyczyła szablonu; brak licencji = wszelkie prawa zastrzeżone). → Rozstrzygnięte przez D39: bez pliku licencji.
- `supportsTablet` (domyślnie `true` z szablonu): przy publikacji wymaga zrzutów ekranu iPada. → Rozstrzygnięte
  8.10.2026 (D200, drobna decyzja PWD-25): iPad wspierany od razu, z ograniczoną szerokością treści; zrzuty iPada przy publikacji.
