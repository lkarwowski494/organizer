# 0022. Formularz: zadanie albo wydarzenie, bez wyboru listy; imię zamiast adresu e-mail (8.10.2026)

Zgłoszenie właściciela (zrzut formularza „Nowe zadanie”): 1) „Lista” myli — „Balet – Róża” nie ma nic wspólnego
z zadaniem „Dzisiaj”; 2) brak czasu trwania; 3) brak wyboru, czy to zadanie, czy wydarzenie. Do tego Claude zauważył
w grupach imiona z początku adresu e-mail („lukasz.karwowski93”).

## Decyzje produktowe (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D97 | Lista w formularzu | Usunąć z formularza | Lista z podpowiedzią „ogólna”; lista tylko po rozwinięciu |
| D98 | Zadanie czy wydarzenie | Przełącznik „Rodzaj” na górze formularza | Dwa osobne przyciski dodawania; rozpoznawanie tylko z tekstu |
| D99 | Czas trwania | Tylko w wydarzeniu; zakres godzin w szybkim dodaniu tworzy wydarzenie | Czas trwania także w zadaniu |
| D100 | Imię | Pytanie o imię przy starcie + zmiana w Ustawieniach; poprawa istniejących imion z adresu | Tylko zmiana w Ustawieniach; imię z adresu bez zmian |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **Gdzie trafia zadanie bez listy (D97):** ogólna lista grupy (`generalList`).
   - Grupa osobista: pierwsza lista zadań, a gdy jej nie ma, nowa „Moje zadania” (jak dotąd).
   - Grupa wspólna: lista o nazwie „Zadania”, a gdy jej nie ma, powstaje. Wcześniej trafiało na pierwszą listę zadań grupy (np. „Balet – Róża”) — to był powód zgłoszenia.
   - „Zmień” w tej samej grupie zostawia zadanie na jego liście. Zmiana grupy daje kopię na ogólnej liście nowej grupy (jak w ADR 0019).
   - Na listę tematyczną dodaje się z ekranu tej listy (bez zmian).
   - Odrzucone: pierwsza lista grupy (powód zgłoszenia), pytanie o listę przy pierwszym dodaniu w grupie.
2. **Przełącznik (D98):** tylko przy nowym wpisie. Przejście przenosi nazwę, dzień, godzinę (początek), grupę i osobę.
   - Osoba zadania staje się odpowiedzialną za wydarzenie tylko wtedy, gdy jest dorosła w grupie wspólnej (D66).
   - Wydarzenie całodniowe → zadanie bez godziny. Zła data → bez daty (zadanie) albo dziś (wydarzenie).
3. **Zakres godzin (D99), `src/domain/time-range.ts`:**
   - Formy: „17–18”, „15:30-16:00”, „o 17.00–18.30”, „godz. 7-8”, „od 17 do 18”, „od godz. 9 do 10:30”.
   - Zegar 24-godzinny bez zgadywania rano/po południu (D43 dotyczy jednej godziny). Koniec musi być po początku.
   - Minuty po kropce tylko 00 albo > 12, jak w parserze terminów (D18), żeby „15.10–16.10” nie było godzinami.
   - Zakres jest chipem — odklikany zostaje tekstem zadania. Parser terminów i jego korpus bez zmian.
   - Pod polem napis „Zakres godzin — dodasz wydarzenie, nie zadanie.” (audyt 2, M-256: zmiana rodzaju była ukryta).
     Z nierozpoznanym dniem („w przyszły wtorek 17–18”) wydarzenia nie ma — zob. bezpiecznik dnia w ADR 0003.
   - Bez dnia: dziś, a gdy początek minął — jutro. „co tydzień” — co tydzień w dzień wydarzenia.
   - Z „@imię”: grupa tej osoby, osoba odpowiedzialna (tylko dorosła).
   - „Więcej” z zakresem otwiera od razu formularz wydarzenia. Pasek „Dodano wydarzenie: … · Zmień” otwiera wydarzenie.
   - Odrzucone: zgadywanie pory dnia dla „5–6”, wydarzenie przez północ z tekstu (ustawia się w formularzu).
4. **Imię (D100), `src/domain/views/my-name.ts`, ekran `NameScreen`:**
   - Pytanie przy starcie, gdy konto nie ma imienia w metadanych (logowanie e-mailem; Apple podaje imię). Raz na telefonie (`nameAsked`); potem wprowadzenie, jeśli go nie było.
   - Zapis: metadane konta i `profiles.display_name` (serwer; bez sieci — komunikat, nic nie zmienione), potem moje członkostwa przez kolejkę.
   - Zmieniane są tylko członkostwa z dawnym imieniem (stare imię, początek adresu, „Ja”, pusto). Imię grupowe, np. „Tata”, zostaje.
   - Długość: `config.profile.NAME_MAX_LENGTH` = 100, z ograniczeń SQL (test kontraktowy).
   - Bez migracji: RLS i GRANT na `profiles` oraz zmiana własnego `display_name` w grupie już istnieją.
   - Odrzucone: zmiana imienia we wszystkich grupach (nadpisałaby imiona grupowe), osobna funkcja serwera (niepotrzebna).
