# Audyt przed upublicznieniem repozytorium — 6.10.2026

Zakres: zgodnie z zasadą właściciela (historia git, e-maile, ustawienia workflow, logi i artefakty).
Stan repozytorium w chwili audytu: 1 commit (`7151dbc`), gałąź `main`, brak tagów.

| Obszar | Narzędzie / metoda | Wynik |
|---|---|---|
| Sekrety w całej historii | gitleaks v8 (`git --log-opts=--all`, `.gitleaks.toml` z regułami .p8 i Supabase) | brak wycieków |
| Sekrety w drzewie roboczym | gitleaks `dir` | brak wycieków |
| Drugi skaner | detect-secrets 1.5.0 | 1 trafienie: `.gitleaks.toml` linia 9 — fałszywy alarm (wzorzec reguły wykrywającej klucze, nie klucz) |
| Pliki wrażliwe w historii | `git log --all --name-only` (.p8 .p12 .pem .key .cer .mobileprovision .keystore .jks .env) | brak |
| E-maile w commitach | `git log --all --format=%ae/%ce` | wyłącznie `336954459+lkarwowski494@users.noreply.github.com` |
| Logi i artefakty przebiegów | check runs przez API | 2 przebiegi niewystartowane (blokada rozliczeń konta dla repo prywatnych), brak logów i artefaktów |
| Workflow | przegląd `.github/workflows/ci.yml` | tylko `push`/`pull_request`, bez `pull_request_target`, akcje przypięte do SHA, `permissions: contents: read`, brak sekretów |
| Ustawienia Actions i środowisk | nie do sprawdzenia przez API tej sesji | potwierdza właściciel w interfejsie GitHub |

Decyzja właściciela: upublicznić teraz (D38), bez pliku licencji — wszelkie prawa zastrzeżone (D39).

## Ponowny audyt przed przełączeniem — 6.10.2026, ok. 12:46

Od pierwszego audytu doszły 2 commity (`a207beb` plik audytu, `8f5715d` `.gitignore`). Stan: 3 commity,
gałąź `main`, brak tagów.

| Obszar | Narzędzie / metoda | Wynik |
|---|---|---|
| Sekrety w całej historii | gitleaks v8 (`git --log-opts=--all`, `.gitleaks.toml`) | 3 commity, brak wycieków |
| Sekrety w drzewie roboczym | gitleaks `dir` | brak wycieków |
| Drugi skaner | detect-secrets 1.5.0 (pliki śledzone bez `package-lock.json`) | to samo jedno trafienie: `.gitleaks.toml` linia 9 — fałszywy alarm |
| Pliki wrażliwe w historii | `git log --all --name-only` | brak |
| E-maile w commitach | `git log --all --format=%ae/%ce` | wyłącznie adres noreply |
| Ustawienia Actions | potwierdzenie właściciela (zrzuty ekranu, 13:37–13:40) | lista dozwolonych akcji: GitHub + `gitleaks/gitleaks-action@*`; wymagane przypięcie do SHA; forki bez tokenów zapisu i bez sekretów, przebiegi z forków za zgodą |

Repozytorium przełączone na publiczne przez właściciela 6.10.2026 (potwierdzone przez API bez logowania).

## Lista kontrolna kolejnych audytów (przed upublicznieniem każdego repozytorium projektu)

Ten sam zakres co wyżej, a do tego (audyt 3, 9.10.2026):
- Skan historii ze scaleniami: `gitleaks git --log-opts="--all -m"` (bez `-m` zmiany wniesione w samym scaleniu
  przechodzą — N-84); to samo robi co noc `nightly.yml` (`.github/scripts/gitleaks-range.sh --all`).
- **Ręczny przegląd identyfikatorów właściciela** (N-260): reguła `personal-email` w `.gitleaks.toml` łapie tylko pełne
  adresy z domeną, a sama część lokalna adresu, prywatne imię i nazwisko czy numer telefonu przechodzą. Listę
  identyfikatorów (część lokalna adresu, warianty imienia i nazwiska, numer telefonu) trzymaj w pliku **poza
  repozytorium** i przeszukaj nią całą historię i bieżące pliki, bez wypisywania trafień do publicznych logów:
  `git log --all -m -p | grep -i -c -F -f ~/prywatne-identyfikatory.txt` oraz `git grep -i -n -F -f ~/prywatne-identyfikatory.txt`.
  Wynik przekaż właścicielowi; listy nie dopisuj do reguł gitleaks, bo plik konfiguracji jest publiczny.
