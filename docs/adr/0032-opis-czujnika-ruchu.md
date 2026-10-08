# 0032. Opis czujnika ruchu w Info.plist (8.10.2026)

App Store Connect odrzucił build 19: „ITMS-90683: Missing purpose string in Info.plist … should contain a
NSMotionUsageDescription key … If you're using external libraries or SDKs, they may reference APIs that require a
purpose string. While your app might not use these APIs, a purpose string is still required” (e-mail Apple do
właściciela, 8.10.2026). Przyczyna: expo-location zawiera `CMMotionActivityManager`
(node_modules/expo-location/ios/Providers/MotionActivityStreamer.swift), a w ADR 0029 opis ruchu był wyłączony.

## Decyzja (właściciel, 8.10.2026)
| ID | Pytanie | Decyzja | Odrzucone |
|---|---|---|---|
| D123 | Jak naprawić | Dopisać uczciwy opis: „Organizer nie korzysta z czujników ruchu. Ten opis wymaga Apple, bo biblioteka lokalizacji (czas dojazdu) zawiera taką funkcję.” | Własny moduł Swift zamiast expo-location (więcej kodu natywnego); opis teraz + moduł przed publikacją |

## Uwagi
- Aplikacja nie pyta o zgodę na ruch, więc opisu nikt nie zobaczy. Test kontraktowy pilnuje treści.
- Build 20 (54749ec) miał ten sam błąd — zastąpiony buildem 21.
- Przy publikacji w App Store recenzent może dopytać o klucz; wtedy wracamy do wariantu z własnym modułem.
