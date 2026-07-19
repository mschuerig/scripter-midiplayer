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

Der Player hat einen einzigen Regler: ein Kontrollkästchen **Block Incoming
Notes** (eingehende Noten blockieren), standardmäßig aktiviert.

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

## Lizenz

Der Code in diesem Repository wurde im Wesentlichen von KI generiert und
unterliegt daher keinem Urheberrecht. Einzelheiten siehe [LICENSE](LICENSE).
