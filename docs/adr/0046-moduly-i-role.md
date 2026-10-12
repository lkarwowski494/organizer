# 0046. Moduły i role z „Biblioteki zasad i ról” dla Organizera (11.10.2026)

Decyzja właściciela z 11.10.2026: od tego dnia projekty właściciela stosują wspólne standardy z dokumentu „Biblioteka
zasad i ról” na jego Dysku (moduły dziedzinowe i katalog ról). Organizer włącza z niej to, co pasuje.

## Decyzja
- **Moduły:** „aplikacje (oprogramowanie)” oraz „research i treści merytoryczne”. Organizer jest aplikacją iOS
  z publicznym repozytorium, CI i TestFlightem, a reguły dziedzinowe (odmiana liczebników, święta, strefy czasowe, RRULE,
  RODO, zasady App Store, licencje) wymagają przeczytanych źródeł.
- **Role:**
  - z katalogu: Analityk produktu, Badacz merytoryczny, Programista, Tłumacz, Tester E2E, Audytor, Wydawca, Projektant UX
    (audyt przepływów);
  - nowa, dopisana do biblioteki: **Integrator**. Scala gałęzie agentów na `main` i doprowadza CI do zielonego. Zasady
    roli:
    - jedna sesja naraz, pod blokadą `flock`;
    - jedno pełne sprawdzenie na partię, push tylko na zielonym;
    - najpierw przyczyna czerwonego CI, potem poprawka, bez podnoszenia progów i wyłączania testów;
    - wdrożenie bazy tylko po zielonych `ci.yml` i `db.yml` dla tego samego SHA;
    - nigdy force-push bez zgody właściciela.
- **Nowe zasady modułu „aplikacje”, które wyszły z tego projektu** (pełna treść w bibliotece):
  - praca odporna na przerwy;
  - „zielone lokalnie” to nie to samo co „zielone w CI”;
  - podgląd przed funkcją wizualną;
  - jednolinijkowe meldunki, gdy nic się nie zmieniło, i rzadsze po 3 takich z rzędu;
  - powtarzanie testów padniętych z obciążenia maszyny.

## Odrzucone warianty
- **Moduł „projektowanie gier”:** Organizer nie jest grą. Pasujące z niego lekcje ogólne (jedno źródło prawdy,
  „udokumentowane” to nie „zaimplementowane”, przeszukanie całości przy usuwaniu mechaniki) są już w CLAUDE.md.
- **Tłumacz odrzucony do czasu drugiego języka:** propozycja Claude, właściciel zdecydował, że rola zostaje.
- **Integrator jako część roli Wydawca:** odrzucone, bo scalanie i naprawa CI powtarzały się kilkanaście razy niezależnie
  od wydań.
- **Zapis tylko w ADR i rejestrze na Dysku:** odrzucone, bo CLAUDE.md czyta każda sesja.
