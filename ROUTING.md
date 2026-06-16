# Stitch-Path Routing Rules

Verbindliche Regeln dafür, in welcher **Reihenfolge** die Stiche eines Musters animiert/„genäht" werden. Gilt für ALLE Muster (aktuell Tsuzuki Yamagata, aber bewusst allgemein gehalten für zukünftige). Die Geometrie (welche Kanten existieren) ist davon getrennt — siehe `tools/pattern_extractor.py` und CLAUDE.md.

Ziel: ein Stickpfad, wie ihn ein Mensch mit Nadel und Faden nähen würde — möglichst durchgehend, wenig Faden-Verschwendung.

## Regel 1 — Möglichst lange Linien / wenige Richtungswechsel
Innerhalb eines durchgehenden Strichs soll die Nadel so lange wie möglich **geradeaus** laufen und nur an echten Wendepunkten abbiegen. Die „Zacken" sollen also lang sein.

**Umsetzung:** An jedem Gitterpunkt die anliegenden Kanten nach Kollinearität **paaren** (gegenüberliegende Richtungen zusammen). Ein Strich folgt diesen Paarungen → er zieht an Kreuzungen geradeaus durch und biegt nur dort ab, wo es keine kollineare Fortsetzung gibt (Berg/Tal/Rand). Greedy „bei jeder Kreuzung abwechseln" ist FALSCH — das erzeugt maximal viele Richtungswechsel. (Bei Tsuzuki Yamagata: Richtungswechsel 144 → 50.)

Funktion: `tracePaired(edges)` in `Sashiko — Pattern Library.htm`.

## Regel 2 — Möglichst kurze Sprünge zwischen den Strichen
Wenn ein durchgehender Strich endet und der nächste beginnt, soll der „Sprung" (Nadel neu ansetzen) so kurz wie möglich sein.

**Umsetzung:** Striche per **Nächster-Nachbar** sequenzieren — nach dem Ende eines Strichs den nächsten Strich wählen, dessen näheres Ende am dichtesten liegt, und ihn ggf. umgedreht durchlaufen. Außerdem die Gesamtzahl der Striche klein halten (folgt aus Regel 1).

Funktion: `orderNN(chains)`.

## Regel 3 — Reihenfolge der Pässe
Erst die eine Familie/Richtung komplett (z. B. horizontal), dann die andere (vertikal). Innerhalb jedes Passes gelten Regel 1 + 2. Entspricht den nummerierten roten Pfeilen in den Buch-Diagrammen (1-2 = erster Pass, 3-4 = zweiter).

## Regel 4 — Farb-Zuordnung nach Translations-Klasse
Die Farbe eines Pfades kodiert seine **Translations-Äquivalenzklasse**: gleicher Farbton ⟺ der eine Pfad geht durch eine Muster-Symmetrie-Verschiebung aus (einem Teil) des anderen hervor. Reine Verschiebung links/rechts/oben/unten = identisch. Am Rand abgeschnittene Stücke = identisch zum vollen Pfad, wenn ihr ungeschnittener Teil verschoben woanders auftaucht (Test: `∃ Gittervektor t: Stück + t ⊆ voller Pfad`). Spiegelbild (Halbperioden-Versatz, kein Gittervektor) = eigene Klasse/Farbe.

NICHT nach Position/Band-Parität färben — das gibt Nicht-Translaten dieselbe Farbe (Fehler). Funktionen: `classifyTranslation`, `latContains`.

## Verifikation
Vor dem Ausliefern in Python gegenrechnen: **100 % Kantenabdeckung** (jede Kante genau einmal), Richtungswechsel und Sprung-Summe vorher/nachher vergleichen. Dann im Browser (`.claude/launch.json` + Claude_Preview MCP) auf Konsolen-Fehler prüfen.
