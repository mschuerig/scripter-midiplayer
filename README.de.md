# MIDI-Player

*[English](README.md)*

Ein Script für [Scripter in Logic Pro / MainStage](https://support.apple.com/guide/logicpro/lgce728c68f6/12.3/mac/15.6),
das einen geloopten Schlagzeug-Groove im Tempo des Hosts abspielt – ein
lebendigerer Ersatz für den Metronom-Klick – zusammen mit einem kleinen
Kommandozeilen-Werkzeug, das Grooves aus MIDI-Dateien (zum Beispiel aus Logics
Drummer) in ein fertiges Script einbäckt.

Der Player sendet **nur MIDI**: Er erzeugt selbst keinen Ton, sondern läuft durch
das Schlagzeug-Instrument, das du in den Kanalzug legst – so klingt er, wie du
möchtest. Er kommt mit einem einfachen Ein-Takt-Backbeat und funktioniert sofort.

## Wozu?

Das eingebaute Metronom von MainStage ist nur ein Klick. Zu einem nackten Klick
zu üben oder zu spielen wird ermüdend und sagt nichts über das Feeling der Musik
aus. Dies spielt stattdessen einen echten Groove – einen, der deinem Tempo folgt,
sofort auf Tempoänderungen reagiert und deine eigenen Schlagzeugklänge ansteuert.

Es gibt ein einziges Werkzeug, **midi2scripter**
([`midi2scripter.js`](midi2scripter.js)) – ein eigenständiges
Kommandozeilen-Werkzeug. Es bäckt eine MIDI-Datei (zum Beispiel aus Logics
Drummer) in ein fertiges Player-Script ein und kann einen Player wieder zurück
in MIDI umwandeln. Ein fertiger Beispiel-Player
([`examples/example-player.js`](examples/example-player.js)) liegt bei, samt einem
[Beispiel-MainStage-Concert](examples/README.de.md), sodass du gleich einen
ausprobieren kannst, ohne vorher etwas einzubacken.

## bun installieren

Das Kommandozeilen-Werkzeug läuft auf [bun](https://bun.sh), einer schnellen
JavaScript-Umgebung. Einmalig im **Terminal** installieren:

```sh
brew install oven-sh/bun/bun
```

(Kein [Homebrew](https://brew.sh)? `curl -fsSL https://bun.sh/install | bash`
geht auch – danach Terminal schließen und neu öffnen.)

Dann prüfen:

```sh
bun --version
```

bun brauchst du nur, um einen Groove *vorzubereiten* – sobald ein Player in
MainStage ist, führt MainStage ihn aus, und bun ist nicht mehr beteiligt.

## Einen Player vorbereiten

Wechsle im Terminal mit `cd` in diesen Ordner und kopiere einen fertigen Player
direkt in die Zwischenablage.

Der beiliegende Beispiel-Groove:

```sh
pbcopy < examples/example-player.js
```

Oder deinen eigenen Groove aus einer MIDI-Datei einbacken:

```sh
bun run midi2scripter.js to-script mein-groove.mid | pbcopy
```

(Das Schreiben in eine Datei mit `-o out.js` geht auch, aber das Weiterleiten an
`pbcopy` ist meist schneller.)

**Mehrere Grooves in einen Player bündeln**, indem du mehr als eine MIDI-Datei
übergibst – jede wird zu einem umschaltbaren **Part**, benannt nach ihrer Datei:

```sh
bun run midi2scripter.js to-script strophe.mid refrain.mid fill.mid | pbcopy
```

Zwischen den Parts schaltest du dann live per CC um (siehe *Parts live
umschalten* weiter unten). Umgekehrt einen Player zurück in eine MIDI-Datei
umwandeln:

```sh
bun run midi2scripter.js to-midi mein-player.js                     # ALLE Parts -> mein-player.<part>.mid
bun run midi2scripter.js to-midi mein-player.js --part refrain -o r.mid  # ein Part, nach Name
bun run midi2scripter.js to-midi mein-player.js --part 3 -o fill.mid     # ein Part, nach Nummer
```

Ohne `--part` schreibt `to-midi` **jeden** Part, je eine `.mid`, benannt
`<basis>.<part>.mid`. Mit `--part` (Name oder 1-basierte Nummer) exportierst du
nur einen. `bun run midi2scripter.js --version` zeigt die Tool-Version; jeder
gebackene Player trägt dieselbe Version, mit der er erzeugt wurde.

`mein-groove.mid` aus Logics **Drummer** erzeugen:

1. Eine Drummer-Spur anlegen und einen Groove einstellen.
2. Drummer-Region auswählen → **Ablage → Exportieren → Auswahl als MIDI-Datei…**
   (oder die Region in den Finder ziehen). Eine Drummer-Region lässt sich direkt
   als MIDI exportieren – du musst sie vorher nicht in eine MIDI-Region
   umwandeln.

## In MainStage laden

1. Wähle den Kanalzug mit deinem Schlagzeug-Instrument.
2. Klicke oben im Kanalzug auf den **MIDI-FX**-Steckplatz → **Scripter**.
3. Klicke in Scripter auf **Skript im Editor öffnen**, markiere alles, füge deinen
   Player ein und klicke **Skript ausführen**.
4. Auf Wiedergabe drücken – der Groove folgt dem Tempo von MainStage.

## Parts live umschalten

Enthält ein Player mehr als einen Part, spielt immer nur einer. Den aktiven Part
wählst du per MIDI-CC, und die Umschaltung greift auf **Zählzeit 1 des nächsten
Takts** – Parts wechseln also stets auf der Eins, nie mitten im Takt. Es gibt
mehrere Umschaltregler; sie wirken alle gleichzeitig, ordne also den zu, den
dein Controller senden kann. Jeder ist ein CC-Nummern-Parameter; auf **0**
gesetzt ist der jeweilige Regler deaktiviert.

- **Select Part CC** (Standard 20) – wählt einen Part über seinen *Wert*: Wert 1
  → Part 1, Wert 2 → Part 2 und so weiter. Ein Wert außerhalb des Bereichs
  bewirkt nichts.
- **Previous Part CC** / **Next Part CC** (Standard 22 / 23) – springen zum
  vorherigen / nächsten Part und laufen an den Enden um. Ideal für ein Paar
  Fußtaster.
- **Part N (name) CC** – jeder Part hat zusätzlich seinen eigenen CC-Parameter
  (benannt nach dem Part). Sendest du diesen CC mit einem Wert größer als 0, wird
  sein Part gewählt.
- **Rewind CC** (Standard 21) – spult den *aktuellen* Part auf der nächsten Eins
  an seinen Anfang zurück, um nach einem Tempo- oder Abschnittswechsel wieder
  sauber in den Loop einzurasten.

- **Enable CC** (Standard 24) – startet / stoppt den Groove sofort. Ein Wert
  **≥ 64** aktiviert die Ausgabe, **< 64** schaltet sie stumm (die 127/0 einer
  Rasttaste bilden also direkt Ein/Aus ab). Beim Deaktivieren verstummen
  klingende Noten sofort; beim Aktivieren setzt der Groove **phasengleich** zum
  Taktraster wieder ein, als hätte er durchgehend gespielt – der Loop bleibt über
  eine Stummschaltung hinweg taktgenau ausgerichtet.

Alle diese Regler werden vom Player geschluckt und nicht an das Instrument
weitergegeben.

**Tasten senden Wert 0?** Ein Wechsel wird bei einem CC-Wert über 0 ausgelöst.
Manche *Toggle*-Tasten senden bei einem Druck einen hohen Wert und beim nächsten
**0** – dann schaltet nur jeder zweite Druck um. Setze oben im Skript
`var TRACE = true;`, um den eingehenden CC-Strom (Nummer + Wert) und jede
Umschaltentscheidung in die Scripter-Konsole zu schreiben – so siehst du am
schnellsten, was deine Tasten senden, und kannst sie bei Bedarf auf
Momentary-/Trigger-Modus stellen.

## Wie ein Metronom starten und stoppen

Die naheliegende Idee – den Player auf MainStages **Metronom**-Kanalzug zu legen,
damit dessen Schalter den Groove steuert – funktioniert **nicht**:
Metronom-Kanalzüge geben kein MIDI an Scripter weiter. Nimm stattdessen den
**Enable CC**:

1. Lege den Player auf einen normalen Instrument-Kanalzug mit echtem Kit (z. B.
   **Drum Kit Designer**, der dem General-MIDI-Schlagzeug-Layout folgt, sodass
   Kick, Snare und Hi-Hat richtig landen).
2. Füge im Layout-Modus eine Taste hinzu und weise ihr die **Enable-CC**-Nummer
   zu (Standard 24). Mach sie zu einer **Rasttaste** (Toggle), damit sie 127 / 0
   sendet.

Diese Taste startet und stoppt den Groove nun auf Wunsch, sofort, während der
Loop taktgenau bleibt – dein freihändiges Metronom, mit echtem Kit statt Klick.
(Lieber immer an? Lass **Enable CC** einfach auf 0, um den Regler zu
deaktivieren – dann spielt der Groove, sobald MainStage läuft.)

## Auf Concert-Ebene einfügen (wichtig)

Damit der Groove in jedem Patch verfügbar ist, legst du seinen Kanalzug auf die
**Concert-Ebene**. Achte auf eine MainStage-Regel: Ein Software-Instrument auf
Concert-Ebene hat **Vorrang vor den Patch-/Set-Instrumenten in seinem
Tastaturbereich** – ein Kanalzug mit dem *vollen* Tastaturbereich schluckt also
jede Note, und deine anderen Klänge verstummen. (Das ist eine Routing-Regel am
Tastaturbereich, sie greift also selbst bei umgangenem Scripter und Instrument.)

Der Fix ist einfach, denn der Player braucht **keine Tastatureingabe** – er
erzeugt seinen Groove aus dem Host-Transport. Schieb den Bereich des Kanalzugs
also aus dem Weg:

1. Wähle den Drum-Kanalzug auf Concert-Ebene aus.
2. Öffne im **Kanalzug-Inspektor** den Tastaturbereich- / **Layer-und-Split**-
   Editor und setze den Bereich auf eine **einzelne, ungenutzte Note** (z. B. die
   tiefste Taste, die du nie spielst), statt der ganzen Tastatur.

Deine Patches bekommen ihr MIDI zurück, und der Groove spielt weiter – Scripter
sendet seine Drum-Noten *nach* dem Tastaturbereich-Filter, sie erreichen das Kit
also weiterhin. Die Umschalt-CCs sind Control Changes, keine Noten, ein
schmalerer Bereich filtert sie also nicht (prüfe mit `TRACE = true`, falls
unsicher; routet ein Controller sie seltsam, gib dem Drum-Kanalzug einen
MIDI-Eingangskanal/-Port, den deine Tastatur nicht spielt, und sende die CCs
dorthin). Gar keine globale Übersteuerung gewünscht? Leg den Kanalzug
stattdessen auf **Patch- oder Set-Ebene**, nur dort, wo du den Groove willst.

## „Block Incoming Notes“

Neben den Part-Umschaltreglern oben hat der Player ein Kontrollkästchen **Block
Incoming Notes** (eingehende Noten blockieren), standardmäßig aktiviert.

Wenn es an ist, werden MIDI-Noten, die *in den Player hineinkommen*, verschluckt,
sodass du nur den vom Player erzeugten Groove hörst. (Andere Nachrichten –
Sustain, CC, Pitch Bend – werden weiterhin durchgelassen, auch die vom Player
genutzten Umschalt-CCs.)

Schalte es aus, wenn eingehende Noten das Instrument doch erreichen sollen – zum
Beispiel, wenn du dasselbe Kit zusätzlich über ein Pad oder eine Tastatur durch
denselben Kanalzug spielst.

## Einen Groove von Hand bearbeiten

Die Grooves stehen oben im Script, zwischen den Markern
`// MIDI-PLAYER:PATTERN-START` und `// MIDI-PLAYER:PATTERN-END`, als
`PARTS`-Array. Jeder Part trägt einen `name`, seinen eigenen `cc`, die Loop-Länge
in Beats (`loopBeats`, ein 4/4-Takt = 4) und eine Liste kompakter Noten-**Tupel**:

```js
var PARTS = [
  { name: "backbeat", cc: 0, loopBeats: 4, pattern: [
    [0.0, 42, 80, 0.1],   // [offset, pitch, velocity, length], alles in Beats
    [1.0, 38, 100, 0.1]
  ] }
];
```

Jedes Tupel ist `[offset, pitch, velocity, length]`: die Beat-Position im Loop,
die MIDI-Notennummer (36 Kick, 38 Snare, 42 geschlossene Hi-Hat), die Velocity
(1–127) und die Notenlänge in Beats. Füge dort einen eingebackenen Groove ein,
ändere eine Zahl und führe das Script erneut aus. `midi2scripter` liest auch die
ältere Objektform `{ offset, pitch, velocity, length }`, sodass mit einer
früheren Version eingebackene Scripts weiterhin umgewandelt werden.

## Lizenz

Der Code in diesem Repository wurde im Wesentlichen von KI generiert und
unterliegt daher keinem Urheberrecht. Einzelheiten siehe [LICENSE](LICENSE).
