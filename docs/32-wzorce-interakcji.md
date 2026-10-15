# 32. Wzorce interakcji — standardy interfejsu i interakcji

Dokument określa jednolite wzorce zachowania i układu interfejsu użytkownika w aplikacji Organizer. Wszystkie nowe ekrany, formularze i komponenty muszą stosować te reguły.

## 1. Okna modalne i arkusze (Modals & Sheets)
- **Przycisk rezygnacji:** ZAWSZE w lewym górnym rogu nagłówka (`headerLeft`), etykieta dosłownie: „Anuluj”. Zakaz stosowania etykiet „Zamknij”, „Wróć” ani gołej ikony „X” do rezygnacji z formularza edycji.
- **Przycisk zatwierdzenia:** ZAWSZE w prawym górnym rogu nagłówka (`headerRight`), etykieta precyzyjna: „Dodaj” (przy tworzeniu nowego obiektu) lub „Zapisz” (przy edycji istniejącego).
- **Zabezpieczenie przed utratą zmian:** Jeśli użytkownik zmodyfikował stan formularza i nacisnął „Anuluj”, aplikacja wyświetla pytanie potwierdzające: „Odrzucić zmiany?” z opcjami: `[Wróć do edycji, Odrzuć zmiany (destructive)]`.

## 2. Ekrany list i nawigacja główna
- **Przycisk dodawania:** Na każdym ekranie listy (Moje sprawy, Zadania, Zakupy, Kalendarz, Grupy) przycisk dodawania nowego elementu to stały symbol „+” umieszczony w prawym górnym rogu nagłówka (`headerRight`).
- **Etykieta dostępności (VoiceOver):** Przycisk „+” ma precyzyjną etykietę: `accessibilityLabel="Dodaj {obiekt}"` (np. „Dodaj zadanie”, „Dodaj produkt”, „Dodaj wydarzenie”, „Dodaj grupę”), a nie ogólne „Dodaj” czy „Plus”.

## 3. Edycja na szkicu vs zapis natychmiastowy
- **Edycja złożona (formularz):** Edycja na lokalnym stanie szkicu (draft). Dane trafiają do bazy SQLite dopiero po jawnym zatwierdzeniu („Zapisz” / „Dodaj”).
- **Interakcje proste (przełączniki i odznaczenia):** Odhaczenie zadania jako wykonane, skreślenie pozycji z listy zakupów czy zmiana filtru zapisują się natychmiast w lokalnej bazie SQLite w jednej transakcji z wpisem w kolejce `pending_ops`.

## 4. Usuwanie i operacje destrukcyjne
- **Kosz i natychmiastowe cofnięcie:** Usunięcie pojedynczego elementu (zadania, produktu) przenosi obiekt do kosza (`KOSZ`) lub usuwa go z natychmiastowym wyświetleniem paska na dole ekranu z przyciskiem „Cofnij” (`src/ui/undo`).
- **Operacje destrukcyjne nieodwracalne:** Usunięcie grupy, usunięcie konta/profilu czy opróżnienie kosza wymaga jawnego okna potwierdzenia z przyciskiem destrukcyjnym: `[Anuluj, Usuń {obiekt} (destructive)]`.

## 5. Komunikaty o błędach i sukcesie
- **Rutynowy sukces:** Widoczna zmiana w interfejsie (pojawienie się wpisu na liście, zamknięcie okna) — bez wyskakującego alertu blokującego uwagę.
- **Błąd operacji:** Komunikat błędu (Alert lub Banner) musi w tytule precyzować, co się nie udało, np.: „Nie udało się zapisać zadania”, „Nie udało się zsynchronizować grupy”, „Nieprawidłowy kod dołączenia”. Zakaz ogólnych nagłówków typu „Błąd” lub „Nie udało się”.
- **Dostępność komunikatów:** Informacje o błędach ogłaszane dla technologii asystujących (VoiceOver).

## 6. Puste stany (Empty states)
- Gdy lista nie zawiera elementów, ekran prezentuje dedykowany widok pustego stanu: czytelny komunikat wyjaśniający kontekst oraz przycisk akcji inicjującej dodanie pierwszego elementu (np. „Brak zadań w tej grupie” + przycisk „+ Dodaj zadanie”).

## 7. Status synchronizacji i tryb offline
- Interfejs jasno komunikuje stan połączenia i kolejki synchronizacji:
  - Brak sieci: praca offline bez zakłóceń, wskaźnik oczekujących operacji w `pending_ops`.
  - W trakcie synchronizacji: delikatny wskaźnik postępu `sync_push`.
  - Konflikt wersji: automatyczne scalanie na poziomie pól z powiadomieniem tylko w przypadku kolizji wymagającej uwagi użytkownika.

## 8. Pola wyszukiwania
- Wszystkie wyszukiwarki używają spójnego komponentu `SearchField`:
  - Przycisk czyszczenia tekstu (`clearButtonMode="while-editing"`).
  - Precyzyjny placeholder: „Szukaj zadań…”, „Szukaj na liście zakupów…”.
  - Rozsądny limit znaków i automatyczne przycinanie spacji.

## 9. Typografia, kontrast i pole dotyku
- **Pole dotyku:** Każdy element klikalny ma minimalny rozmiar pola dotykowego 44 × 44 pt (zgodnie z Apple Human Interface Guidelines).
- **Kontrast:** Wszystkie kolory tekstu i tła w motywie jasnym i ciemnym spełniają standard WCAG AAA (sprawdzane testami korpusu kontrastu).
- **Kroje pisma:** Atkinson Hyperlegible Next (teksty podstawowe i interfejs) oraz Bricolage Grotesque (nagłówki).

## 10. Słownik terminów interfejsu
| Termin | Kiedy używać | Gdzie |
|---|---|---|
| **Anuluj** | Rezygnacja z wprowadzania zmian, zamknięcie formularza lub anulowanie potwierdzenia | Lewy górny róg okien modalnych, przycisk rezygnacji w alertach |
| **Wróć** | Powrót do poprzedniego ekranu w hierarchii nawigacji stosu | Lewy górny róg ekranów stosu nawigacji (strzałka powrotu) |
| **Wróć do edycji** | Przycisk w dialogu potwierdzającym odrzucenie zmian | Dialog „Odrzucić zmiany?” |
| **Zamknij** | Zamknięcie ekranu czysto informacyjnego (np. „Co nowego”, „Licencje”) | Prawy górny róg ekranów informacyjnych |
| **Cofnij** | Natychmiastowe wycofanie ostatniej wykonanej akcji | Pasek Snackbar na dole ekranu |
| **Przywróć** | Odzyskanie elementu z kosza lub archiwum | Widok kosza / archiwum |
| **Usuń {obiekt}** | Trwałe lub odwracalne usunięcie elementu | Menu akcji, przycisk destrukcyjny w dialogu |
| **Dodaj {obiekt}** | Utworzenie nowego wpisu danego typu | Przycisk w prawym górnym rogu nagłówka, etykieta VoiceOver |
