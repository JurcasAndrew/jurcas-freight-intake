# Lekcja 02 — dlaczego regex pomylil 18 z 22 paletami?

## Problem wykryty przez stress test

Watek zawieral **nowe zlecenie (18 palet, Kaunas, Hamburg + Bremen)** i
**stara wiadomosc (22 palety, Vilnius + Hamburg)**. Stary ekstraktor
wybieral pierwsze pasujace wzorce z calego maila, zamiast pracowac
na aktualnej wiadomosci i honorowac `Total:`.

## Naprawa w v0.2

1. `splitConversation()` rozdziela najnowsza wiadomosc od oznaczonej historii.
2. `parseStops()` rozpoznaje numerowane rozladunki.
3. `parsePallets()` nadaje pierwszenstwo `Total:`; jesli go brak, sumuje
   palety z kazdego kompletnego punktu dostawy.
4. `cargoData()` oznacza status ADR jako niepotwierdzony i wyciaga warunki.
5. `warnings` zapisuje ryzyka wraz z JSON/CSV.

## Co robic w GitHubie?

- Zrob osobna galaz `feature/thread-aware-parser`.
- Podmien pliki i zapisz commit: `Handle revised multistop freight enquiries`.
- Otworz Pull Request, sprawdz `npm test`, a dopiero potem scal.

## Test

W Space kliknij **Stress test**. Oczekiwane: Kaunas, Hamburg + Bremen,
16 Oct 2026, 19 / 20 Oct, 18 palet, 14200 kg, tautliner; ADR: NIEPOTWIERDZONY.

## Ograniczenia

To nadal **parser oparty na regulach**, a nie model rozumiejacy wszystkie
wielojezyczne maile. Scenariusze spoza testow moga generowac bledne dane.
Nie synchronizuj automatycznie do Bitrix24 i nie uzywaj rzeczywistych danych
klientow bez weryfikacji bezpieczenstwa i uprawnien.
