# 0047. Następne podzadania z powtarzaniem, gdy zadanie nadrzędne też je dostaje (12.10.2026)

Decyzja z 12.10.2026, podjęta według reguły delegacji właściciela: wybrana opcja rekomendowana. Właściciel może ją
zawetować. Dotyczy D133 (minione „Tylko tego dnia”) i T-12 (kopia dokładana po odhaczeniu przez dziecko).

## Problem
`expiredRepeatOps` (D133) i `missingRepeatOps` (T-12) liczą operacje dla wszystkich zadań na jednym stanie danych.
Gdy podzadanie ma własne powtarzanie i jego zadanie nadrzędne w tym samym przebiegu też dostaje następne, powstawały dwa
polecenia utworzenia tego samego id (`nextId(podzadania)`):
- osobne następne podzadania, pod **starym** zadaniem nadrzędnym, z powtarzaniem;
- kopia podzadania pod następnym zadania nadrzędnego (`copyOps`, decyzja właściciela z 8.10.2026).

Wygrywało pierwsze (utworzenie istniejącego id nic nie robi, na telefonie i na serwerze). Wynik zależał więc od kolejności
wierszy w tabeli: gdy podzadanie stało przed rodzicem, jego następne wisiało pod starym zadaniem, a następne zadania
nadrzędnego nie miało tego podzadania. Test własności N-27 tego nie łapał, bo generator stawiał zawsze rodzica przed
dzieckiem.

## Decyzja: (a) podzadanie idzie razem z przodkiem
Podzadanie, którego przodek (żywy, najwyżej `config.MAX_TASK_DEPTH` poziomów wyżej) dostaje w tym samym przebiegu
następne według tej samej reguły (D133 albo T-12), nie dostaje osobnego. Jego następne powstaje tylko jako kopia
podzadania pod następnym przodka. To zasada, którą aplikacja już miała dla kopii robionych po kolei
(`withUpcomingCopies`, test „Podzadanie z własnym powtarzaniem: jego następne powstaje razem z następnym zadania
nadrzędnego — nie drugi raz”). Teraz obowiązuje w każdej kolejności wierszy.
Kod: `copiedWithAncestor` w `src/domain/views/task-repeat.ts`, używane w `expiredRepeatOps`, `missingRepeatOps`
i `withUpcomingCopies`. Gdy przodek następnego nie dostaje (przechodzi dalej, nie minął, ma już następne), podzadanie
dostaje swoje jak dotąd.

## Odrzucony wariant
**(b) Przetwarzanie od rodziców w dół** (sortowanie po głębokości, potem każde zadanie na stanie po poprzednich
operacjach). W tym przypadku daje ten sam wynik, ale go odrzuciliśmy z dwóch powodów. Zasada zostaje wtedy ukryta
w kolejności przetwarzania, zamiast stać w regule. Do tego `expiredRepeatOps` i `missingRepeatOps` musiałyby
nakładać operacje na kopię danych w trakcie liczenia, czyli przejść na inny model niż „operacje z jednego stanu”, którego
używają wszyscy wywołujący i symulator synchronizacji.

## Testy
- `task-repeat.test.ts`: „ADR 0047: minione podzadanie i minione zadanie nadrzędne…” oraz „ADR 0047: odhaczone
  podzadanie i odhaczone zadanie nadrzędne…” sprawdzają obie kolejności wierszy. Oba były czerwone przed poprawką.
- Test własności N-27 losuje teraz kolejność wierszy i sprawdza, że wynik od niej nie zależy. Generator buduje tylko
  drzewa do `MAX_TASK_DEPTH` poziomów, bo głębszych serwer nie przyjmie (`tasks_guard`, `tasks_depth_range`,
  `move_task`). Przypadki, które oblewały, są stałymi przykładami.
