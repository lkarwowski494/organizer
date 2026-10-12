# Strona Organizera (GitHub Pages)

Źródło: katalog `site/` w repozytorium `lkarwowski494/organizer` (ADR 0020, ADR 0044).

- **Publikacja z tego repozytorium** (decyzja właściciela 9.10.2026): workflow `.github/workflows/pages.yml` przy pushu
  na `main` ze zmianą `site/**` (i ręcznie) wgrywa cały katalog pod https://lkarwowski494.github.io/organizer/.
  Jednorazowo w repozytorium: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
- Strona zaproszeń z Universal Links potrzebuje osobno katalogu głównego domeny (`lkarwowski494.github.io`, kroki
  w `docs/join-links.md`): plik `/.well-known/apple-app-site-association` działa tylko w katalogu głównym, więc kopia
  pod `/organizer/` niczego nie otwiera. Repozytorium strony użytkownika nie zasłania stron projektów — `/organizer/`
  działa dalej.

- `/j/?g=<ID grupy>&c=<kod>` — zaproszenie do grupy; z aplikacją otwiera ją (Universal Links), bez — pokazuje ID i kod.
- `/privacy/` (opublikowana: `/organizer/privacy/` = `config.privacy.POLICY_URL`) — polityka prywatności, generowana z `docs/privacy-policy.md` (`node scripts/site/privacy-html.cjs --write`).
- `/.well-known/apple-app-site-association` — powiązanie domeny z aplikacją (Apple: „Supporting associated domains”).

Strona nie ładuje zewnętrznych skryptów i niczego nie zapisuje.
