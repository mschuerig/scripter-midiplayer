# midiplayer

*A groove instead of a click.* — **English below · [Deutsch weiter unten](#deutsch)**

---

## English

MainStage's built-in metronome is just a click. **midiplayer** turns it into a real
drum groove you can play along to. The groove follows your tempo (and reacts instantly
to tempo changes), and it sends **MIDI only** — so it plays through whatever drum
instrument you choose and sounds however you want. You can even bake a groove made with
Logic's **Drummer** into it.

There are two pieces:

- **The player** (`midi-player.js`) — a small script you paste into MainStage's
  **Scripter** (a MIDI FX plugin). It plays a looping groove locked to MainStage's tempo.
  It makes no sound on its own; the drum instrument on the channel strip does.
- **midi2scripter** (`midi2scripter.js`) — a little command-line helper that bakes a MIDI
  file (e.g. a Drummer groove) into a ready-to-paste player. One self-contained file.

The player ships with a simple one-bar backbeat (kick, snare, hi-hats) so it works out of
the box.

### 1. Install bun (one time)

The command-line helper runs on **bun**, a fast JavaScript runtime. Open **Terminal** and:

```sh
curl -fsSL https://bun.sh/install | bash
```

Then quit and reopen Terminal, and check it worked:

```sh
bun --version
```

(If you use Homebrew, `brew install oven-sh/bun/bun` works too.)

You only need bun to *prepare* a groove. Once a player is pasted into MainStage,
MainStage runs it — bun is not involved while you play.

### 2. Get a player onto your clipboard

First `cd` into this project's folder in Terminal. Then:

**Just the built-in groove:**

```sh
pbcopy < midi-player.js
```

**Your own groove, baked from a MIDI file:**

```sh
bun run midi2scripter.js to-script my-groove.mid | pbcopy
```

Either way the finished player is now on your clipboard, ready to paste. (Writing to a
file with `-o out.js` also works, but piping into `pbcopy` is usually quicker.)

**Making `my-groove.mid` from Logic's Drummer:**
1. Create a **Drummer** track and dial in a groove.
2. Control-click the Drummer region → **Convert** → **Convert to MIDI Region**.
3. Select that region → **File → Export → Selection as MIDI File…** (or drag the region
   to the Finder).

### 3. Paste it into MainStage

1. Select the channel strip with your drum instrument.
2. At the top of the channel strip, click the **MIDI FX** slot → **Scripter**.
3. In Scripter's window, open the code editor, select all, paste your player, and click
   **Run Script**.
4. Press play — the groove follows MainStage's tempo.

### Replacing the metronome sound with a real kit

MainStage's metronome plays through an instrument called **Klopfgeist** (the click). To
hear a proper drum kit instead:

1. On the **metronome** channel strip, click the instrument slot showing **Klopfgeist**
   and choose **Drum Kit Designer** instead. (Drum Kit Designer follows the General MIDI
   drum layout, so the player's kick/snare/hi-hat land on the right sounds.)
2. Insert **Scripter** in that strip's MIDI FX slot and paste your player (as above).
3. Turn **Block Incoming Notes** on (see below).

Now MainStage's **metronome button becomes your groove on/off**, and you hear a drum kit
instead of a click. (If you'd rather keep it simple, just put the player on your drum
instrument's own channel strip instead — then the groove plays whenever MainStage is
playing.)

### What "Block Incoming Notes" does

The player has one control: a checkbox **Block Incoming Notes**, on by default.

When it's **on**, any MIDI notes *coming into* the player are swallowed, so you hear only
the groove the player generates. (Other messages like sustain, CC and pitch bend still
pass through.)

Why this matters: if you put the player on the **metronome strip** and use the metronome
button as a handy on/off, MainStage's metronome is still sending its own click notes to
the instrument. Blocking them means the metronome button turns your groove on and off
*without* the click sounding underneath it.

Turn it **off** if you actually want incoming notes to reach the instrument — for
example if you're also playing that same drum kit from a pad or keyboard through the
same channel strip.

---

<a name="deutsch"></a>

## Deutsch

Das eingebaute Metronom von MainStage ist nur ein Klick. **midiplayer** macht daraus
einen echten Schlagzeug-Groove, zu dem du spielen kannst. Der Groove folgt deinem Tempo
(und reagiert sofort auf Tempoänderungen) und sendet **nur MIDI** — er läuft also durch
das Schlagzeug-Instrument deiner Wahl und klingt so, wie du möchtest. Du kannst sogar
einen mit Logics **Drummer** erstellten Groove einbacken.

Es gibt zwei Teile:

- **Der Player** (`midi-player.js`) — ein kleines Skript, das du in MainStages
  **Scripter** (ein MIDI-FX-Plugin) einfügst. Es spielt einen geloopten Groove, der fest
  an MainStages Tempo gekoppelt ist. Er erzeugt selbst keinen Ton; das tut das
  Schlagzeug-Instrument im Kanalzug.
- **midi2scripter** (`midi2scripter.js`) — ein kleines Kommandozeilen-Werkzeug, das eine
  MIDI-Datei (z. B. einen Drummer-Groove) in einen fertigen Player einbäckt. Eine einzige
  eigenständige Datei.

Der Player kommt mit einem einfachen Ein-Takt-Backbeat (Kick, Snare, Hi-Hats) und
funktioniert damit sofort.

### 1. bun installieren (einmalig)

Das Kommandozeilen-Werkzeug läuft auf **bun**, einer schnellen JavaScript-Laufzeit. Öffne
das **Terminal** und gib ein:

```sh
curl -fsSL https://bun.sh/install | bash
```

Danach das Terminal schließen und neu öffnen, dann prüfen:

```sh
bun --version
```

(Mit Homebrew geht auch `brew install oven-sh/bun/bun`.)

bun brauchst du nur, um einen Groove *vorzubereiten*. Sobald ein Player in MainStage
eingefügt ist, führt MainStage ihn aus — bun ist beim Spielen nicht beteiligt.

### 2. Einen Player in die Zwischenablage holen

Wechsle im Terminal zuerst in den Ordner dieses Projekts (`cd`). Dann:

**Nur der eingebaute Groove:**

```sh
pbcopy < midi-player.js
```

**Dein eigener Groove, aus einer MIDI-Datei eingebacken:**

```sh
bun run midi2scripter.js to-script mein-groove.mid | pbcopy
```

So oder so liegt der fertige Player jetzt in der Zwischenablage, bereit zum Einfügen.
(Das Schreiben in eine Datei mit `-o out.js` geht auch, aber das Weiterleiten an `pbcopy`
ist meist schneller.)

**`mein-groove.mid` aus Logics Drummer erzeugen:**
1. Eine **Drummer**-Spur anlegen und einen Groove einstellen.
2. Control-Klick auf die Drummer-Region → **Umwandeln** → **In MIDI-Region umwandeln**.
3. Region auswählen → **Ablage → Exportieren → Auswahl als MIDI-Datei…** (oder die Region
   in den Finder ziehen).

### 3. In MainStage einfügen

1. Wähle den Kanalzug mit deinem Schlagzeug-Instrument.
2. Klicke oben im Kanalzug auf den **MIDI-FX**-Steckplatz → **Scripter**.
3. Öffne im Scripter-Fenster den Code-Editor, markiere alles, füge deinen Player ein und
   klicke **Run Script**.
4. Auf Wiedergabe drücken — der Groove folgt MainStages Tempo.

### Den Metronom-Klang durch ein echtes Kit ersetzen

MainStages Metronom läuft durch ein Instrument namens **Klopfgeist** (den Klick). Um
stattdessen ein richtiges Schlagzeug zu hören:

1. Klicke im **Metronom**-Kanalzug auf den Instrument-Steckplatz mit **Klopfgeist** und
   wähle stattdessen **Drum Kit Designer**. (Drum Kit Designer folgt dem General-MIDI-
   Schlagzeug-Layout, sodass Kick/Snare/Hi-Hat des Players auf den richtigen Klängen
   landen.)
2. Füge **Scripter** in den MIDI-FX-Steckplatz dieses Kanalzugs ein und den Player wie
   oben beschrieben.
3. Schalte **Block Incoming Notes** ein (siehe unten).

Jetzt wird MainStages **Metronom-Schalter zum Ein/Aus deines Grooves**, und du hörst ein
Schlagzeug statt eines Klicks. (Wenn du es einfach halten willst, setze den Player
stattdessen auf den eigenen Kanalzug deines Schlagzeug-Instruments — dann spielt der
Groove immer, wenn MainStage läuft.)

### Wozu „Block Incoming Notes“ dient

Der Player hat einen einzigen Regler: ein Kontrollkästchen **Block Incoming Notes**
(eingehende Noten blockieren), standardmäßig aktiviert.

Wenn es **an** ist, werden alle MIDI-Noten, die *in den Player hineinkommen*,
verschluckt, sodass du nur den vom Player erzeugten Groove hörst. (Andere Nachrichten wie
Sustain, CC und Pitch Bend werden weiterhin durchgelassen.)

Warum das wichtig ist: Wenn du den Player auf den **Metronom-Kanalzug** setzt und den
Metronom-Schalter als praktisches Ein/Aus nutzt, sendet MainStages Metronom weiterhin
seine eigenen Klick-Noten an das Instrument. Sie zu blockieren bedeutet, dass der
Metronom-Schalter deinen Groove ein- und ausschaltet, *ohne* dass der Klick darunter
mitklingt.

Schalte es **aus**, wenn eingehende Noten das Instrument tatsächlich erreichen sollen —
zum Beispiel, wenn du dasselbe Schlagzeug zusätzlich über ein Pad oder eine Tastatur
durch denselben Kanalzug spielst.
