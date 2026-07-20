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
([`example-player.js`](example-player.js)) liegt bei, sodass du gleich einen
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
pbcopy < example-player.js
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
bun run midi2scripter.js to-midi mein-player.js -o groove.mid            # erster Part
bun run midi2scripter.js to-midi mein-player.js --part refrain -o r.mid  # nach Name
bun run midi2scripter.js to-midi mein-player.js --part 3 -o fill.mid     # nach Nummer
```

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
zwei Wege, die CCs zuzuordnen, gewählt über den Parameter **Switch Mode**:

- **Single CC (value = part)** – ein CC (**Select CC**, Standard 20) wählt einen
  Part über seine Nummer: Wert 1 → Part 1, Wert 2 → Part 2 und so weiter. Ein
  Wert außerhalb des Bereichs bewirkt nichts.
- **Per-Part CC** – jeder Part hat seinen eigenen CC (die Parameter **Part 1
  CC**, **Part 2 CC**, …, benannt nach dem jeweiligen Part). Sendest du diesen CC
  mit einem Wert größer als 0, wird sein Part gewählt.

Ein eigener **Restart CC** (Standard 21) startet den *aktuellen* Part auf der
nächsten Eins von vorn – praktisch, um nach einem Tempo- oder Abschnittswechsel
wieder sauber in den Loop einzurasten. Alle drei Regler werden vom Player
geschluckt und nicht an das Instrument weitergegeben.

## Als Metronom verwenden

Für einen Groove, der mit MainStages Metronom-Schalter startet und stoppt, legst
du den Player auf den **Metronom**-Kanalzug und gibst ihm ein echtes Kit:

1. Klicke im Metronom-Kanalzug auf den Instrument-Steckplatz mit **Klopfgeist**
   (dem Klick) und wähle stattdessen **Drum Kit Designer**. Drum Kit Designer
   folgt dem General-MIDI-Schlagzeug-Layout, sodass Kick, Snare und Hi-Hat des
   Players auf den richtigen Klängen landen.
2. Füge **Scripter** in den MIDI-FX-Steckplatz dieses Kanalzugs ein und den Player
   wie oben.
3. Schalte **Block Incoming Notes** ein (siehe unten).

Jetzt schaltet der Metronom-Schalter deinen Groove ein und aus, und du hörst ein
Kit statt eines Klicks. (Lieber einfach halten? Lass den Player auf dem eigenen
Kanalzug deines Schlagzeug-Instruments – dann spielt er immer, wenn MainStage
läuft.)

## „Block Incoming Notes“

Neben den Part-Umschaltreglern oben hat der Player ein Kontrollkästchen **Block
Incoming Notes** (eingehende Noten blockieren), standardmäßig aktiviert.

Wenn es an ist, werden MIDI-Noten, die *in den Player hineinkommen*, verschluckt,
sodass du nur den vom Player erzeugten Groove hörst. (Andere Nachrichten –
Sustain, CC, Pitch Bend – werden weiterhin durchgelassen.)

Genau das macht den Metronom-Kanalzug sauber: MainStages Metronom sendet weiterhin
seine eigenen Klick-Noten an das Instrument, und sie zu blockieren lässt den
Metronom-Schalter deinen Groove schalten, *ohne* dass der Klick darunter
mitklingt.

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
