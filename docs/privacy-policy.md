# Organizer: polityka prywatności (wersja testowa, 9.10.2026)

> Szkic do zatwierdzenia przez właściciela (ADR 0016, D142 w ADR 0035). Opisuje, co aplikacja naprawdę robi z danymi
> w tej wersji kodu. Nie jest poradą prawną. Lista zmian względem wersji z 7.10.2026: `docs/privacy-policy-changes.md`.

**Kto odpowiada za dane:** autor aplikacji Organizer (kontakt: adres e-mail podany w TestFlight jako „Feedback Email”).

Nie ma reklam, analityki ani śledzenia. Nie sprzedajemy danych. Twoje wpisy widzą tylko osoby z Twoich grup (zasady niżej),
a pomagają nam w tym tylko firmy wymienione w części „Gdzie są dane”.

## Jakie dane zbieramy i po co

### Konto
- **Logowanie przez Apple:** identyfikator konta Apple. Jeśli Apple przekaże imię i nazwisko (robi to tylko przy pierwszym
  logowaniu), zapisujemy je w koncie, a imię staje się Twoim podpisem w grupach. Aplikacja prosi Apple też o adres e-mail:
  Apple przekazuje go w danych logowania (prawdziwy adres albo, jeśli tak wybierzesz, ukryty adres przekierowujący
  Apple), a usługa logowania (Supabase Auth) może go zapisać w Twoim koncie. Aplikacja z tego adresu nie korzysta
  i nikomu go nie pokazuje.
- **Konta założone wcześniej linkiem z e-maila:** adres e-mail. W wersji testowej nowych logowań e-mailem nie ma —
  logujesz się tylko przez Apple.
- **Twoje imię:** to, które wpiszesz albo zmienisz w aplikacji. Widzą je osoby z Twoich grup.

### To, co wpisujesz
- Grupy, osoby w grupach (także imiona dzieci bez kont, które dodaje dorosły), listy, zadania, zakupy, wydarzenia
  (z miejscem, jeśli je wpiszesz), przekazania i historia zmian. Potrzebujemy ich, żeby aplikacja działała na Twoich
  telefonach i u osób z Twoich grup.
- **Kto co widzi:**
  - listę „Cała grupa” widzą wszyscy członkowie grupy, listę „Tylko ja” tylko Ty, a listę udostępnioną wybranym osobom
    tylko te osoby;
  - wydarzenia widzi cała grupa (także wtedy, gdy przy „Kogo dotyczy” wybierzesz konkretne osoby);
  - **odpowiedzi o obecności** („będę / nie będę / może”) widzi cała grupa, razem z tym, kto odpowiedział
    (dorosły może odpowiedzieć za dziecko bez konta);
  - przekazanie widzą tylko dwie osoby, których dotyczy;
  - historia zmian pokazuje, kto i co zmienił; widzą ją osoby, które widzą daną listę albo grupę.

### Zaproszenia do grupy
- Zaproszenie (link albo 6-cyfrowy kod do ID grupy) wysyłasz sam, np. w Wiadomościach. Na serwerze zapisujemy skrót linku
  (nie sam link) oraz 6-cyfrowy kod — żeby „Zaproś” mógł pokazać bieżący kod właścicielowi i adminom grupy — a także kto
  i kiedy je wystawił, termin ważności i liczbę użyć. Kod po zbyt wielu nieudanych próbach przestaje działać.
- Przy dołączaniu kodem zapisujemy każdą nieudaną próbę (Twoje konto, ID grupy, czas), żeby utrudnić zgadywanie kodów.
  Próby kasujemy po 1 dniu.

### Powiadomienia
- **Token powiadomień** tego iPhone'a (tylko jeśli zgodzisz się na powiadomienia). Używamy go, żeby powiadomić Cię, gdy:
  - ktoś przekaże Ci zadanie, zakupy albo wydarzenie albo odpowie na Twoje przekazanie;
  - ktoś przypisze Ci zadanie albo zakupy;
  - ktoś ustawi Cię jako osobę odpowiedzialną za wydarzenie.
- Treść powiadomienia zawiera imię osoby, która to zrobiła, i nazwę zadania, listy albo wydarzenia (przy wydarzeniu także
  dzień). Powiadomienie o zadaniu albo zakupach dostaniesz tylko wtedy, gdy widzisz tę listę.
- **Wyciszenie grupy:** jeśli wyciszysz grupę w Ustawieniach, zapisujemy na serwerze, które grupy wyciszyłeś. Wyciszenie
  dotyczy przypisań i osoby odpowiedzialnej; przekazania (do przyjęcia) przychodzą zawsze.
- **Dziennik wysyłki:** żeby nie wysłać tego samego powiadomienia dwa razy, serwer zapisuje, że powiadomienie o danej
  zmianie już poszło (identyfikator zmiany i czas, bez treści). Te wpisy kasujemy po 7 dniach.
- **Przypomnienia** o Twoich sprawach planuje sam telefon. Ich treść nie przechodzi przez nasz serwer.
- **Ciche powiadomienia:** gdy ktoś zmieni coś w Twojej grupie, serwer wysyła na Twój iPhone powiadomienie bez treści
  (niewidoczne), żeby telefon pobrał zmiany i poprawił przypomnienia także wtedy, gdy nie otwierasz aplikacji. Przy tokenie
  zapisujemy tylko, kiedy poszło ostatnie takie powiadomienie i czy czeka następne (najwyżej jedno na 20 minut). Znika
  razem z tokenem.

### Zgłoszenia błędów i samosprawdzenie
- **Błędy:** gdy aplikacja napotka błąd, wysyła jego opis techniczny: komunikat błędu, miejsce w kodzie, nazwę ekranu albo
  funkcji (np. „render”, „travel”, „calendar-read”, „calendar-mirror”, „selfcheck”) i wersję aplikacji. Aplikacja nie dołącza treści Twoich list, zadań, wydarzeń ani imion.
  Przy błędach kalendarza iPhone'a i czasu dojazdu wysyłamy tylko rodzaj i kod błędu oraz miejsce w kodzie — bez
  komunikatu, bo mógłby zawierać nazwę kalendarza, wydarzenia albo adres.
- **Samosprawdzenie:** raz na każdą nową wersję aplikacji telefon sprawdza, czy działa poprawnie (strefa czasowa,
  polskie litery, baza danych na telefonie) i wysyła wynik tą samą drogą co błędy: wersję bazy danych, wyniki testów
  i wersję aplikacji. Bez treści z list.
- Zgłoszenia są przypisane do Twojego konta. Zapisujemy najwyżej 50 zgłoszeń na dobę z jednego konta (kolejne serwer
  pomija). Czyta je autor aplikacji w panelu serwera; dostęp techniczny ma też dostawca serwera (Supabase, „Gdzie są
  dane”).

### Uwagi
- Tekst, który sam wyślesz z Ustawień („Wyślij uwagę”), razem z wersją aplikacji i nazwą ekranu, z którego wysyłasz
  (zawsze „Settings”). Uwaga jest przypisana do Twojego konta. Najwyżej 20 dziennie. Czyta je autor aplikacji w panelu
  serwera (dostęp techniczny ma też dostawca serwera, Supabase).

### Dane techniczne synchronizacji
- Losowy identyfikator kopii danych na Twoim telefonie (nie identyfikator urządzenia) i czas ostatniej synchronizacji,
  żeby żadna zmiana nie zginęła ani nie zapisała się dwa razy.
- Zapis, kiedy dostałeś albo straciłeś dostęp do grupy lub listy, żeby telefon wiedział, co pobrać albo usunąć.
- **Połączenie na żywo** (Supabase Realtime): gdy aplikacja jest otwarta, telefon utrzymuje połączenie z serwerem
  (z Twoim adresem IP i tokenem logowania). Serwer wysyła nim tylko sygnał „w grupie jest nowa wersja” (numer wersji)
  albo „zmienił się Twój dostęp” — bez treści spraw.
- **Profil:** Twoje imię jest też w profilu konta na serwerze — stąd bierze się podpis, gdy dołączasz do grupy bez wpisania
  imienia. Imię z profilu widzą też osoby z Twoich grup; profil usuwamy z kontem.

### Kalendarz iPhone'a (tylko gdy połączysz go w aplikacji)
- **Odczyt:** aplikacja odczytuje Twoje wydarzenia (od 31 dni wstecz do 62 dni naprzód), żeby pokazać je obok
  spraw grup. Twoje wydarzenia nie są wysyłane na serwer ani pokazywane innym osobom. Aplikacja trzyma je tylko na
  ekranie, nie zapisuje ich. Na telefonie zapamiętuje tylko, których kalendarzy nie chcesz czytać.
- **Zapis (lustro):** aplikacja zapisuje wydarzenia Twoich grup, które Cię dotyczą (od 7 dni wstecz do 90 dni
  naprzód; grupy wybierasz w Ustawieniach), w osobnych kalendarzach „Organizer – nazwa grupy”: nazwę wydarzenia, osobę
  odpowiedzialną, dzień, godziny, miejsce i nazwę grupy; lekcje dziecka jednym wpisem na dzień z listą lekcji w notatce.
  Te kalendarze powstają na tym samym koncie co Twój domyślny kalendarz (zwykle iCloud), więc synchronizują się jak
  Twoje pozostałe kalendarze na tym koncie.
- Połączenie wyłączysz w Ustawieniach aplikacji (kalendarze „Organizer” zostaną wtedy usunięte z iPhone'a) albo
  w Ustawieniach iPhone'a. Wylogowanie, usunięcie konta i zalogowanie innego konta też usuwają z iPhone'a kalendarze
  „Organizer” utworzone na tym telefonie (po ponownym zalogowaniu lustro odtworzy je samo). Na telefonie (w pęku kluczy)
  zapamiętujemy identyfikatory tych kalendarzy, żeby je usunąć także po zmianie konta albo ponownej instalacji.
- Wpisy, które dodaje Organizer (lustro i „Dodaj do kalendarza”), mają w notatce dopisek „Dodane przez aplikację
  Organizer” — po nim aplikacja rozpoznaje je w Twoim kalendarzu i nie pokazuje drugi raz.
- Bez połączenia: tylko zapis jednego wydarzenia, gdy dotkniesz „Dodaj do kalendarza” (zapisuje dopiero systemowy
  formularz, a aplikacja nie dostaje wtedy dostępu do odczytu).

### Lokalizacja (tylko gdy włączysz „Czas dojazdu”, zgoda iOS „podczas używania aplikacji”)
- Telefon ustala Twoje położenie, żeby policzyć czas dojazdu do najbliższych wydarzeń z miejscem (do 12 godzin naprzód). Adres wydarzenia
  zamienia na współrzędne i liczy czas dojazdu przez usługi Apple (geokoder i Mapy Apple, MapKit). Położenie i adres
  celu trafiają więc do Apple.
- **Położenie nigdy nie trafia na serwer Organizera** ani do innych osób. Aplikacja nie śledzi położenia w tle.
- Na telefonie zapamiętujemy współrzędne adresów wydarzeń (najwyżej 200 adresów; adres, którego Mapy nie znalazły,
  sprawdzamy znowu po dobie) i wybrany środek transportu, żeby nie liczyć ich od nowa.
- „Nawiguj” otwiera wybraną aplikację map (Mapy Apple albo Mapy Google) z adresem wydarzenia, a gdy aplikacji Google Maps
  nie ma na iPhonie — stronę Map Google w przeglądarce. Od tej chwili adres przetwarza ta aplikacja albo strona według
  swoich zasad.
- Adres wydarzenia (pole „Miejsce”) jest częścią wydarzenia i widzi go cała grupa.
- **Czujniki ruchu:** aplikacja z nich nie korzysta i nigdy o nie nie pyta. Opis tej zgody jest w aplikacji tylko dlatego,
  że Apple go wymaga: biblioteka lokalizacji, z której korzysta „Czas dojazdu”, zawiera taką funkcję.

## Gdzie są dane
- Na serwerze Supabase w regionie Frankfurt (UE) i w bazie na Twoim telefonie.
- Powiadomienia przechodzą przez Apple Push Notification service (Apple), razem z ich treścią.
- Lokalizacja i adresy do czasu dojazdu idą do Apple (MapKit). Lustro kalendarza synchronizuje Twoje konto kalendarza
  (zwykle iCloud).

## Jak długo
- **Twoje wpisy:** do usunięcia przez Ciebie albo przez osobę z grupy, która może je usunąć.
- **Kosz:** usunięte listy, zadania, wydarzenia i grupy leżą w koszu 30 dni, potem znikają na zawsze razem ze swoją
  historią zmian (serwer sprząta raz na dobę, więc może to potrwać do jednego dnia dłużej). Grupę z kosza właściciel może
  przywrócić w ciągu tych 30 dni, a listę, zadanie i wydarzenie — każdy dorosły z grupy, który je widzi (Grupy → Kosz).
  Zadania przypięte do usuniętego wydarzenia zostają: po 30 dniach tracą przypięcie,
  a dzień tamtego terminu staje się ich własnym terminem.
- **Historia zmian:** 90 dni (na serwerze i na telefonach).
- **Rozstrzygnięte przekazania** (przyjęte, odrzucone, anulowane): 90 dni od decyzji.
- **Zaproszenia:** 30 dni po wygaśnięciu albo unieważnieniu.
- **Zgłoszenia błędów, wyniki samosprawdzenia i uwagi:** 90 dni.
- **Nieudane próby dołączenia kodem:** 1 dzień (sprzątanie raz na dobę, więc do 2 dni).
- **Dane techniczne synchronizacji** (licznik instalacji aplikacji): 180 dni od ostatniego użycia tej instalacji.
- **Wyjście albo usunięcie z grupy:** Twoje listy „Tylko ja” w tej grupie trafiają do kosza na 30 dni i wracają, jeśli
  w tym czasie wrócisz do grupy. Osobę usuniętą przez kogoś właściciel albo admin może przywrócić w ciągu 30 dni;
  zaproszenia, które wystawiła, przestają działać.
- **Dziennik wysyłki powiadomień:** 7 dni.
- **Token powiadomień:** dopóki działa. Usuwamy go przy wylogowaniu (gdy jest internet), gdy Apple zgłosi, że jest
  nieaktualny, i przy usunięciu konta. Gdy na tym iPhonie zaloguje się inne konto, token przechodzi na nie.
- **Wyciszenia grup:** dopóki ich nie wyłączysz albo nie usuniesz konta.

## Usunięcie konta
**Ustawienia → Usuń konto** usuwa konto z serwera:
- Twoja grupa osobista znika od razu, razem z zawartością.
- Twoje listy „Tylko ja” w grupach wspólnych trafiają do kosza i znikają po 30 dniach.
- Grupę wspólną, której byłeś właścicielem, przejmuje dorosły z kontem i najdłuższym stażem w grupie (najpierw admin).
  **Jeśli w grupie nie ma innego dorosłego z kontem, grupa trafia do kosza na 30 dni, a potem jest usuwana razem
  z całą zawartością.**
- To, co dodałeś w grupach wspólnych (zadania, wydarzenia, odpowiedzi o obecności, historia zmian), zostaje dla grupy,
  ale zamiast Twojego imienia widać „Usunięty użytkownik”.
- Linki zaproszeń, które wystawiłeś, przestają działać.
- Grupę w koszu, której byłeś właścicielem, też przejmuje taki dorosły (może ją przywrócić); grupa zostaje w koszu do
  końca tych samych 30 dni.
- Razem z kontem usuwamy: dane logowania (identyfikator Apple albo e-mail, imię i nazwisko z Apple), token powiadomień,
  wyciszenia grup, Twoje zgłoszenia błędów i uwagi, nieudane próby dołączenia kodem, dane techniczne synchronizacji.
- Przy koncie Apple usunięcie potwierdzasz oknem Apple, a my unieważniamy token Sign in with Apple.
- Z tego iPhone'a znika kopia danych konta razem z jego ustawieniami (plik bazy konta). Po zwykłym wylogowaniu kopia
  zostaje na telefonie, żeby po ponownym zalogowaniu nie pobierać wszystkiego od nowa.
- W pęku kluczy iPhone'a zostają drobne dane telefonu (np. wybrany wygląd); pęk kluczy może przetrwać usunięcie
  aplikacji.

## Twoje prawa
Możesz poprawić swoje dane w aplikacji, usunąć konto w aplikacji albo napisać na adres kontaktowy z pytaniem o swoje dane.
