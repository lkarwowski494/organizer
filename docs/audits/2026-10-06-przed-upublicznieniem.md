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
