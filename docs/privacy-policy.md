# Organizer: polityka prywatności

<!--
Notatka dla zespołu (nie trafia na stronę): treść do zatwierdzenia przez właściciela (D142 w ADR 0035). Opisuje, co
aplikacja naprawdę robi z danymi w tej wersji kodu; zmiany z uzasadnieniem i odwołaniami do kodu:
docs/privacy-policy-changes.md. Strona site/privacy/index.html powstaje z tego pliku
(node scripts/site/privacy-html.cjs --write); test kontraktowy src/config/__tests__/privacy-policy.contract.test.ts
pilnuje zgodności strony, liczb z src/config, danych administratora z config.privacy, opisu każdej tabeli z danymi
i konwencji tekstów.
-->

Wersja z 9.10.2026. Aplikacja Organizer jest w fazie testów (TestFlight).

## Kto odpowiada za Twoje dane

Administratorem Twoich danych osobowych jest Łukasz Karwowski, autor aplikacji Organizer.

Kontakt w sprawie danych: do czasu publikacji aplikacji w App Store napisz przez „Wyślij uwagę” w Ustawieniach
aplikacji albo na adres e-mail podany w TestFlight. Przed publikacją w App Store podamy tu osobny adres e-mail.

## W skrócie

- Nie ma reklam, analityki ani śledzenia. Nie sprzedajemy danych.
- Twoje wpisy widzą tylko osoby z Twoich grup (zasady niżej). Pomagają nam tylko firmy wymienione w części „Komu
  przekazujemy dane”.
- Wydarzenia z kalendarza iPhone’a i Twoje położenie zostają na telefonie — nie trafiają na serwer Organizera.
- Konto usuniesz w aplikacji: Ustawienia → Konto i dane → Usuń konto.

## Jakie dane zbieramy, po co i na jakiej podstawie

Podstawy prawne to przepisy RODO (rozporządzenie (UE) 2016/679): **umowa** — dane niezbędne, żeby aplikacja działała
tak, jak tu opisujemy (art. 6 ust. 1 lit. b); **prawnie uzasadniony interes** — nasz albo osób z Twoich grup, opisany przy
każdym punkcie (art. 6 ust. 1 lit. f). Nie opieramy się na zgodzie. Zgody systemu iOS (powiadomienia, kalendarz,
lokalizacja) decydują tylko o tym, z czego aplikacja może korzystać na Twoim iPhonie.

### Konto (umowa)
- **Logowanie przez Apple:** identyfikator konta Apple. Jeśli Apple przekaże imię i nazwisko (robi to tylko przy
  pierwszym logowaniu), zapisujemy je w koncie, a imię staje się Twoim podpisem w grupach. Aplikacja prosi Apple też
  o adres e-mail: Apple przekazuje go w danych logowania (prawdziwy adres albo, jeśli tak wybierzesz, ukryty adres
  przekierowujący Apple), a usługa logowania (Supabase Auth) może go zapisać w Twoim koncie. Aplikacja z tego adresu nie
  korzysta i nikomu go nie pokazuje.
- **Konta założone wcześniej linkiem z e-maila:** adres e-mail. W wersji testowej nowych logowań e-mailem nie ma —
  logujesz się tylko przez Apple.
- **Twoje imię:** to, które wpiszesz albo zmienisz w aplikacji. Widzą je osoby z Twoich grup. Jest też w profilu konta na
  serwerze — stąd bierze się podpis, gdy dołączasz do grupy bez wpisania imienia.

### To, co wpisujesz (umowa)
- Grupy, osoby w grupach, listy, zadania (także stałe zadania przy wydarzeniach), zakupy, wydarzenia (z miejscem, jeśli
  je wpiszesz, z osobami, których dotyczą, i zmianami pojedynczych terminów), przekazania i historia zmian. Potrzebujemy
  ich, żeby aplikacja działała na Twoich urządzeniach i u osób z Twoich grup.
- **Zrobione zakupy:** gdy ktoś oznaczy zakupy jako zrobione, zapisujemy, z której listy, na kiedy były zaplanowane, kiedy
  i kto je zrobił. Widzą to osoby, które widzą tę listę.
- **Ustawienie „W Moich sprawach”** przy grupie (co z tej grupy pokazywać w Moich sprawach): zapisujemy je w Twoim koncie,
  żeby działało na wszystkich Twoich urządzeniach. Widzisz je tylko Ty.
- **Kto co widzi:**
  - listę „Cała grupa” widzą wszyscy członkowie grupy, listę „Tylko ja” tylko Ty, a listę udostępnioną wybranym osobom
    tylko te osoby;
  - wydarzenia widzi cała grupa (także wtedy, gdy przy „Kogo dotyczy” wybierzesz konkretne osoby);
  - **odpowiedzi o obecności** („Będę / Może / Nie będę”) widzi cała grupa, razem z tym, kto odpowiedział (dorosły może
    odpowiedzieć za dziecko bez konta);
  - przekazanie widzą tylko dwie osoby, których dotyczy;
  - historia zmian pokazuje, kto i co zmienił; widzą ją osoby, które widzą daną listę albo grupę.

### Dane innych osób, które wpisujesz (prawnie uzasadniony interes osób w grupie)
- Możesz wpisać do grupy osobę bez konta, np. dziecko: jej imię, plan lekcji, odpowiedzi o obecności za nią i sprawy,
  które jej dotyczą. Te dane nie pochodzą od tej osoby, tylko od osoby z grupy, która je wpisała. Przetwarzamy je, żeby
  grupa mogła wspólnie planować sprawy rodziny albo znajomych — to prawnie uzasadniony interes osób w grupie. Widzi je cała
  grupa. Poprawić albo usunąć je może dorosły z grupy; osoba, której dotyczą (albo jej rodzic), może też napisać do nas.

### Konto dziecka (prawnie uzasadniony interes rodziców)
- Dziecko może mieć w grupie własne konto Apple. Łączy je z profilem dziecka tylko właściciel albo administrator grupy —
  daje dziecku jednorazowy kod ważny 24 godziny. To dorosły decyduje więc, czy dziecko korzysta z aplikacji na swoim
  urządzeniu.
- Dziecko z kontem widzi swoje sprawy i wydarzenia, w których uczestniczy (i te całej grupy), otwiera listy grupy,
  odhacza swoje zadania, dopisuje produkty do list zakupów i odpowiada o obecności za siebie. Nie wychodzi samo z grupy —
  wypisuje je właściciel albo administrator. Swoje konto dziecko może usunąć w Ustawieniach, jak każdy.
- Dane dziecka przetwarzamy w tym samym zakresie co dane dorosłego, tylko po to, żeby rodzina mogła planować wspólne
  sprawy. Podstawą nie jest zgoda dziecka, tylko prawnie uzasadniony interes rodziców i samego dziecka w organizowaniu
  życia rodziny; bierzemy pod uwagę, że chodzi o dziecko, dlatego aplikacja nie ma reklam, analityki ani profilowania.

### Zaproszenia do grupy (umowa; ochrona przed zgadywaniem kodów — prawnie uzasadniony interes)
- Zaproszenie (6-cyfrowy kod do ID grupy) wysyłasz zapraszanej osobie, np. w Wiadomościach. Na serwerze zapisujemy kod — żeby
  „Zaproś” mógł pokazać bieżący kod właścicielowi i administratorom grupy — a także kto i kiedy go wystawił, termin
  ważności i liczbę użyć. Kod po zbyt wielu nieudanych próbach przestaje działać.
- Przy dołączaniu kodem zapisujemy każdą nieudaną próbę (Twoje konto, ID grupy, czas), żeby utrudnić zgadywanie kodów.

### Powiadomienia (umowa)
- **Token powiadomień** tego iPhone’a (tylko jeśli zgodzisz się na powiadomienia w iOS). Używamy go, żeby powiadomić Cię,
  gdy:
  - ktoś przekaże Ci zadanie, zakupy albo wydarzenie albo odpowie na Twoje przekazanie;
  - ktoś przypisze Ci zadanie albo zakupy;
  - ktoś ustawi Cię jako osobę odpowiedzialną za wydarzenie.
- Treść powiadomienia zawiera imię osoby, która to zrobiła, i nazwę zadania, listy albo wydarzenia (przy wydarzeniu także
  dzień). Powiadomienie o zadaniu albo zakupach dostaniesz tylko wtedy, gdy widzisz tę listę.
- **Wyciszenie grupy:** jeśli wyciszysz grupę w Ustawieniach, zapisujemy na serwerze, które grupy są wyciszone. Wyciszenie
  dotyczy przypisań i osoby odpowiedzialnej; przekazania (do przyjęcia) przychodzą zawsze.
- **Dziennik wysyłki:** żeby nie wysłać tego samego powiadomienia dwa razy, serwer zapisuje, że powiadomienie o danej
  zmianie już poszło (identyfikator zmiany i czas, bez treści).
- **Przypomnienia** o Twoich sprawach planuje sam telefon. Ich treść nie przechodzi przez nasz serwer.
- **Ciche powiadomienia:** gdy ktoś zmieni coś w Twojej grupie, serwer wysyła na Twój iPhone powiadomienie bez treści
  (niewidoczne), żeby telefon pobrał zmiany i poprawił przypomnienia także wtedy, gdy nie otwierasz aplikacji. Przy tokenie
  zapisujemy tylko, kiedy poszło ostatnie takie powiadomienie i czy czeka następne (najwyżej jedno na 20 minut).

### Raporty błędów i samosprawdzenie (prawnie uzasadniony interes: wykrywanie i naprawianie błędów)
- **Błędy:** gdy aplikacja napotka błąd, wysyła jego opis techniczny: komunikat błędu, miejsce w kodzie, nazwę ekranu albo
  części aplikacji (np. „Today”, „sync”, „reminders”, „travel”, „calendar-mirror”, „selfcheck”) i wersję aplikacji.
  Aplikacja nie dołącza treści Twoich list, zadań, wydarzeń ani imion. Przy błędach przypomnień, kalendarza iPhone’a
  i czasu dojazdu wysyłamy tylko rodzaj i kod błędu oraz miejsce w kodzie — bez komunikatu, bo mógłby zawierać nazwę
  zadania, kalendarza, wydarzenia albo adres.
- **Samosprawdzenie:** raz na każdą nową wersję aplikacji telefon sprawdza, czy działa poprawnie (strefa czasowa,
  polskie litery, baza danych na telefonie), i wysyła wynik tą samą drogą co błędy: wersję bazy danych, wyniki testów
  i wersję aplikacji. Bez treści z list.
- Raporty są przypisane do Twojego konta. Zapisujemy najwyżej 50 zgłoszeń na dobę z jednego konta (kolejne serwer pomija).
  Czyta je autor aplikacji w panelu serwera; dostęp techniczny ma też dostawca serwera (Supabase).
- **Wyłączenie:** Ustawienia → Konto i dane → „Wysyłaj raporty błędów”. Raporty są włączone domyślnie; wyłączenie działa od
  razu na tym iPhonie i jest Twoim sprzeciwem wobec tego przetwarzania (art. 21 RODO).

### Uwagi (prawnie uzasadniony interes: poprawianie aplikacji)
- Tekst, który wyślesz z Ustawień („Wyślij uwagę”), razem z wersją aplikacji i nazwą ekranu, z którego wysyłasz
  (zawsze „Settings”). Uwaga jest przypisana do Twojego konta. Najwyżej 20 dziennie. Czyta je autor aplikacji w panelu
  serwera (dostęp techniczny ma też dostawca serwera, Supabase).

### Dane techniczne (umowa; bezpieczeństwo — prawnie uzasadniony interes)
- Losowy identyfikator kopii danych na Twoim telefonie (nie identyfikator urządzenia) i czas ostatniej synchronizacji,
  żeby żadna zmiana nie zginęła ani nie zapisała się dwa razy; kody odrzuconych zmian (np. „brak uprawnień”), dopóki
  telefon ich nie odbierze.
- Zapis, kiedy Twoje konto dostało albo straciło dostęp do grupy lub listy, żeby telefon wiedział, co pobrać albo usunąć.
- **Liczniki limitów:** ile razy w bieżącej minucie albo godzinie konto wysłało zmiany albo prośby o powiadomienia — żeby
  jedno konto nie przeciążyło serwera. Każdy nowy okres nadpisuje poprzedni.
- **Połączenie na żywo** (Supabase Realtime): gdy aplikacja jest otwarta, telefon utrzymuje połączenie z serwerem
  (z Twoim adresem IP i tokenem logowania). Serwer wysyła nim tylko sygnał „w grupie jest nowa wersja” (numer wersji)
  albo „zmienił się Twój dostęp” — bez treści spraw.
- **Dzienniki serwera:** każde połączenie z serwerem ujawnia mu adres IP telefonu. Dostawca serwera prowadzi dzienniki
  żądań (w naszym planie trzymane 1 dzień) i dziennik logowań (1 godzinę). Służą tylko do diagnozowania awarii
  i nadużyć.

### Kalendarz iPhone’a (tylko gdy połączysz go w aplikacji)
- **Odczyt:** aplikacja odczytuje Twoje wydarzenia (od 31 dni wstecz do 62 dni naprzód), żeby pokazać je obok
  spraw grup. Twoje wydarzenia nie są wysyłane na serwer ani pokazywane innym osobom. Aplikacja trzyma je tylko na
  ekranie, nie zapisuje ich. Na telefonie zapamiętuje tylko, których kalendarzy nie chcesz czytać.
- **Zapis (lustro):** aplikacja zapisuje wydarzenia Twoich grup, które Cię dotyczą (od 7 dni wstecz do 90 dni
  naprzód; grupy wybierasz w Ustawieniach), w osobnych kalendarzach „Organizer – nazwa grupy”: nazwę wydarzenia, osobę
  odpowiedzialną, dzień, godziny, miejsce i nazwę grupy; lekcje dziecka jednym wpisem na dzień z listą lekcji w notatce.
  Te kalendarze powstają na tym samym koncie co Twój domyślny kalendarz (zwykle iCloud), więc synchronizują się jak
  Twoje pozostałe kalendarze na tym koncie.
- Połączenie wyłączysz w Ustawieniach aplikacji (Kalendarz i dojazd; kalendarze „Organizer” zostaną wtedy usunięte
  z iPhone’a) albo w Ustawieniach iPhone’a → Organizer → Kalendarze. Wylogowanie, usunięcie konta i zalogowanie innego
  konta też usuwają z iPhone’a kalendarze „Organizer” utworzone na tym telefonie (po ponownym zalogowaniu lustro odtworzy
  je samo).
- Wpisy, które dodaje Organizer (lustro i „Dodaj do kalendarza”), mają w notatce dopisek „Dodane przez aplikację
  Organizer” — po nim aplikacja rozpoznaje je w Twoim kalendarzu i nie pokazuje drugi raz.
- Bez połączenia: tylko zapis jednego wydarzenia, gdy dotkniesz „Dodaj do kalendarza” (zapisuje dopiero systemowy
  formularz, a aplikacja nie dostaje wtedy dostępu do odczytu).

### Lokalizacja (tylko gdy włączysz „Czas dojazdu”, zgoda iOS „podczas używania aplikacji”)
- Telefon ustala Twoje położenie, żeby policzyć czas dojazdu do najbliższych wydarzeń z miejscem (do 12 godzin naprzód).
  Adres wydarzenia zamienia na współrzędne i liczy czas dojazdu przez usługi Apple (geokoder i Mapy Apple, MapKit).
  Położenie i adres celu trafiają więc do Apple.
- **Położenie nigdy nie trafia na serwer Organizera** ani do innych osób. Aplikacja nie śledzi położenia w tle.
- Na telefonie zapamiętujemy współrzędne adresów wydarzeń (najwyżej 200 adresów; adres, którego Mapy nie znalazły,
  sprawdzamy znowu po dobie), ostatni policzony czas dojazdu i wybrany środek transportu, żeby nie liczyć ich od nowa.
- „Nawiguj” otwiera Mapy Apple z adresem wydarzenia. Od tej chwili adres przetwarza Apple według swoich zasad.
- Adres wydarzenia (pole „Miejsce”) jest częścią wydarzenia i widzi go cała grupa.
- Zgodę cofniesz wyłączeniem „Czasu dojazdu” w Ustawieniach aplikacji albo w Ustawieniach iPhone’a → Organizer →
  Lokalizacja.
- **Czujniki ruchu:** aplikacja z nich nie korzysta i nigdy o nie nie pyta. Opis tej zgody jest w aplikacji tylko dlatego,
  że Apple go wymaga: biblioteka lokalizacji, z której korzysta „Czas dojazdu”, zawiera taką funkcję.

### Na Twoim telefonie
- Kopia danych konta (plik bazy konta) i jego ustawienia. Plik jest w katalogu aplikacji, który iOS dołącza do kopii
  zapasowej iPhone’a (iCloud albo komputer) — starsze kopie zapasowe mogą go zawierać także po usunięciu konta, dopóki
  ich nie usuniesz.
- W pęku kluczy iPhone’a: sesja logowania, token powiadomień, identyfikator kopii danych tego konta, identyfikatory
  kalendarzy „Organizer” utworzonych na tym telefonie, wybrany wygląd i drobne dane techniczne (np. wersja ostatniego
  samosprawdzenia). Po wylogowaniu bez internetu pęk kluczy przechowuje też starą sesję, dopóki telefon nie zamknie jej
  na serwerze. Pęk kluczy może przetrwać usunięcie aplikacji.

## Komu przekazujemy dane

- **Osoby z Twoich grup** widzą to, co opisuje „Kto co widzi”.
- **Supabase** (Supabase Pte. Ltd., Singapur) — dostawca serwera i logowania. Dane trzymamy w regionie Frankfurt (UE).
  Supabase przetwarza je tylko na nasze polecenie, na podstawie umowy powierzenia (Data Processing Addendum), która
  zobowiązuje go do ochrony danych co najmniej takiej jak w tej polityce. Supabase korzysta z podwykonawców — ich lista:
  https://supabase.com/legal/customer-resources/subprocessor-list.
- **Apple** — logowanie (Sign in with Apple), dostarczanie powiadomień (Apple Push Notification service, razem z ich
  treścią), czas dojazdu i Mapy (prosto z telefonu), a jeśli z nich korzystasz — iCloud (lustro kalendarza, kopie
  zapasowe). Apple przetwarza te dane według własnej polityki prywatności (https://www.apple.com/pl/legal/privacy/pl/);
  dla osób w Europejskim Obszarze Gospodarczym odpowiada za nie Apple Distribution International Limited (Irlandia).

### Przekazanie poza Europejski Obszar Gospodarczy
- Supabase może przetwarzać dane także tam, gdzie on albo jego podwykonawcy mają infrastrukturę, poza EOG. Takie
  przekazanie zabezpieczają standardowe klauzule umowne Komisji Europejskiej (decyzja wykonawcza (UE) 2021/914) —
  są częścią umowy powierzenia. Kopię klauzul możesz dostać, pisząc do nas.
- Apple przekazuje dane poza EOG na podstawie standardowych klauzul umownych (opisuje to jego polityka prywatności).

## Jak długo przechowujemy dane

- **Twoje wpisy:** do usunięcia przez Ciebie albo przez osobę z grupy, która może je usunąć.
- **Kosz:** usunięte listy, zadania, wydarzenia i grupy leżą w koszu 30 dni, potem znikają na zawsze razem ze swoją
  historią zmian (serwer sprząta raz na dobę, więc może to potrwać do jednego dnia dłużej). Grupę z kosza właściciel może
  przywrócić w ciągu tych 30 dni, a listę, zadanie i wydarzenie — każdy dorosły z grupy, który je widzi (Grupy → Kosz).
  Zadania podpięte do usuniętego wydarzenia zostają: po 30 dniach tracą podpięcie, a dzień tamtego terminu staje się
  ich własnym terminem.
- **Historia zmian:** 90 dni (na serwerze i na telefonach).
- **Zrobione zakupy:** 90 dni (na serwerze i na telefonach).
- **Rozstrzygnięte przekazania** (przyjęte, odrzucone, anulowane): 90 dni od decyzji.
- **Zaproszenia:** 30 dni po wygaśnięciu albo unieważnieniu.
- **Raporty błędów, wyniki samosprawdzenia i uwagi:** 90 dni.
- **Nieudane próby dołączenia kodem:** 1 dzień (sprzątanie raz na dobę, więc do 2 dni).
- **Zapis zmian dostępu do grup i list:** 30 dni.
- **Dane techniczne synchronizacji** (identyfikator kopii danych na telefonie): 180 dni od ostatniego użycia tej kopii.
- **Dzienniki serwera:** 1 dzień, dziennik logowań 1 godzinę.
- **Wyjście albo usunięcie z grupy:** Twoje listy „Tylko ja” w tej grupie trafiają do kosza na 30 dni i wracają, jeśli
  w tym czasie wrócisz do grupy. Osobę usuniętą przez kogoś właściciel albo administrator grupy może przywrócić w ciągu
  30 dni; zaproszenia, które wystawiła, przestają działać. Twoje ustawienie „W Moich sprawach” dla tej grupy znika.
- **Dziennik wysyłki powiadomień:** 7 dni.
- **Token powiadomień:** dopóki działa. Usuwamy go przy wylogowaniu (bez internetu — gdy telefon znów połączy się
  z siecią), gdy Apple zgłosi, że jest nieaktualny, i przy usunięciu konta. Gdy na tym iPhonie zaloguje się inne konto,
  token przechodzi na nie.
- **Wyciszenia grup:** dopóki ich nie wyłączysz albo nie usuniesz konta.

## Usunięcie konta

Usunięcie konta (**Ustawienia → Konto i dane → Usuń konto**) usuwa je z serwera:
- Twoja grupa osobista znika od razu, razem z zawartością.
- Twoje listy „Tylko ja” w grupach wspólnych trafiają do kosza i znikają po 30 dniach.
- Grupę wspólną, której właścicielem jest Twoje konto, przejmuje dorosły z kontem i najdłuższym stażem w grupie (najpierw
  administrator). **Jeśli w grupie nie ma innego dorosłego z kontem, grupa trafia do kosza na 30 dni, a potem jest
  usuwana razem z całą zawartością.**
- To, co dodajesz w grupach wspólnych (zadania, wydarzenia, odpowiedzi o obecności, historia zmian), zostaje dla grupy,
  ale zamiast Twojego imienia widać „Usunięty użytkownik”.
- Zaproszenia, które wystawiasz, przestają działać.
- Grupę w koszu, której właścicielem jest Twoje konto, też przejmuje taki dorosły (może ją przywrócić); grupa zostaje
  w koszu do końca tych samych 30 dni.
- Razem z kontem usuwamy: dane logowania (identyfikator Apple albo e-mail, imię i nazwisko z Apple), profil, token
  powiadomień, wyciszenia grup, ustawienia „W Moich sprawach”, Twoje raporty błędów i uwagi, nieudane próby dołączenia
  kodem, liczniki limitów i dane techniczne synchronizacji.
- Przy koncie Apple usunięcie potwierdzasz oknem Apple, a my unieważniamy token Sign in with Apple.
- Z tego iPhone’a znika kopia danych konta razem z jego ustawieniami (plik bazy konta) i identyfikator tej kopii
  w pęku kluczy. Po zwykłym wylogowaniu kopia zostaje na telefonie, żeby po ponownym zalogowaniu nie pobierać wszystkiego
  od nowa.
- W pęku kluczy iPhone’a zostają drobne dane telefonu (np. wybrany wygląd); pęk kluczy może przetrwać usunięcie
  aplikacji.

## Twoje prawa

- Masz prawo dostępu do swoich danych, ich sprostowania, usunięcia, ograniczenia przetwarzania i przeniesienia, a wobec
  przetwarzania na podstawie prawnie uzasadnionego interesu — prawo sprzeciwu.
- Część z nich wykonasz w aplikacji: imię zmienisz w Ustawieniach → Konto i dane → Twoje imię, wpisy poprawisz albo
  usuniesz tam, gdzie je widzisz, raporty błędów wyłączysz przełącznikiem, a konto usuniesz w Ustawieniach → Konto i dane
  → Usuń konto. W pozostałych sprawach napisz do nas (część „Kto odpowiada za Twoje dane”).
- Zgody systemu iOS (powiadomienia, kalendarz, lokalizacja) cofniesz w Ustawieniach iPhone’a → Organizer.
- Masz prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (ul. Stanisława Moniuszki 1A, 00-014 Warszawa),
  jeśli uważasz, że przetwarzamy Twoje dane niezgodnie z prawem.
- Podanie danych jest dobrowolne, ale bez konta Apple nie da się korzystać z aplikacji.
- Nie podejmujemy wobec Ciebie zautomatyzowanych decyzji i nie profilujemy Cię.

## Zmiany tej polityki

Gdy zmienimy tę politykę, nowa wersja pojawi się na tej stronie z nową datą.
