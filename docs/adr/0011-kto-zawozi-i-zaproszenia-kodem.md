# 0011. Kto zawozi, reguła „Dotyczy mnie” dla zadań, zaproszenia kodem (7.10.2026)

Zgłoszenie właściciela: zadanie albo wydarzenie grupy (np. logopeda z dzieckiem) ma być widoczne dla wszystkich, ale na liście „do zrobienia” tylko u osoby, która za nie odpowiada. Do tego linki zaproszeń nie działały.

## Decyzje produktowe (właściciel, 7.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| O-035 | Zadanie grupy z terminem, bez przypisanej osoby | Widać je w „Dotyczy mnie” u wszystkich, jak dotąd. Przypisane jest widoczne tylko u przypisanej osoby. | Tylko lista i kalendarz; sekcja „Do wzięcia” z „Biorę to” |
| D66 | Wydarzenie z dzieckiem | Pole „Kto zawozi / odpowiada” (dorosły z grupy). Gdy jest wybrane, wydarzenie widzi w „Dotyczy mnie” tylko ta osoba i dorośli wskazani imiennie jako uczestnicy. Gdy nie, działa reguła D58. W jednym terminie serii można wskazać inną osobę („tylko to”). | Wydarzenie bez wybranej osoby u nikogo; bez nowego pola |
| D67 | Zaproszenia | Kod w wiadomości z instrukcją („Grupy → Dołącz kodem zaproszenia → wklej”). Wklejona cała wiadomość też działa. → zastąpione przez D92–D94 (ADR 0020: ID grupy + kod, link https na GitHub Pages). | Strona https na GitHub Pages; Universal Links |

## Decyzje wykonawcze (Claude; właściciel może zawetować)
1. **„Kto zawozi” przy wydarzeniu całej grupy** też zawęża widok do tej osoby. Właściciel chce, żeby obowiązek był widoczny u odpowiedzialnego.
   - Odrzucone: przy „cała grupa” ignorować osobę odpowiedzialną.
2. **W wyjątku jednego terminu** pusta osoba znaczy „jak w serii”. W jednym terminie nie da się więc wyłączyć osoby odpowiedzialnej, tak samo jak godziny w ADR 0007.
3. **Odpowiadać może tylko aktywny dorosły tej samej grupy**, co pilnuje strażnik w bazie. W grupie osobistej nie ma wyboru.
4. **Wklejona wiadomość z zaproszenia:** kod jest rozpoznawany, gdy stoi w osobnym wierszu i jest dokładnie jeden. Dwa kody albo kod w środku zdania nie są odczytywane, bo nie zgadujemy.
5. **Zaproszenie zadziała tylko u osoby, która ma aplikację.** Dziś to testerzy TestFlight (grupa „Bliscy”). Nowe osoby trzeba najpierw dodać jako testerów w App Store Connect. → szerzej: publiczny link TestFlight (O-048, ADR 0016).
