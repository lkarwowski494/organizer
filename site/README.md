# lkarwowski494.github.io

Strona zaproszeń aplikacji Organizer (GitHub Pages). Źródło: katalog `site/` w repozytorium `lkarwowski494/organizer`
(ADR 0020) — zmieniaj tam, nie tutaj.

- `/j/?g=<ID grupy>&c=<kod>` — zaproszenie do grupy; z aplikacją otwiera ją (Universal Links), bez — pokazuje ID i kod.
- `/privacy/` — polityka prywatności, generowana z `docs/privacy-policy.md` (`node scripts/site/privacy-html.cjs --write`).
- `/.well-known/apple-app-site-association` — powiązanie domeny z aplikacją (Apple: „Supporting associated domains”).

Strona nie ładuje zewnętrznych skryptów i niczego nie zapisuje.
