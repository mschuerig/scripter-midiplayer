# MIDI Player

*[Deutsch](README.de.md)*

A [Logic Pro / MainStage Scripter](https://support.apple.com/guide/logicpro/lgce728c68f6/12.3/mac/15.6)
script that plays a looping drum groove locked to the host tempo — a livelier
stand-in for the metronome click — together with a small command-line helper
that bakes grooves from MIDI files (for example from Logic's Drummer) into a
ready-to-paste script.

The player sends **MIDI only**: it makes no sound itself and instead plays
through whatever drum instrument you put on the channel strip, so it sounds
however you want. It ships with a simple one-bar backbeat and works out of the
box.

## Why?

MainStage's built-in metronome is just a click. Practising or performing to a
bare click gets tiring, and it tells you nothing about the feel of the music.
This plays a real groove in its place — one that follows your tempo, reacts
instantly to tempo changes, and drives your own drum sounds.

There's a single tool, **midi2scripter** ([`midi2scripter.js`](midi2scripter.js))
— a self-contained command-line helper. It bakes a MIDI file (for example from
Logic's Drummer) into a ready-to-paste player script, and can convert a player
back to MIDI. A ready-made example player
([`example-player.js`](example-player.js)) is included, so you can try one out
without baking anything first.

## Install bun

The command-line helper runs on [bun](https://bun.sh), a fast JavaScript
runtime. Install it once, in **Terminal**:

```sh
brew install oven-sh/bun/bun
```

(No [Homebrew](https://brew.sh)? `curl -fsSL https://bun.sh/install | bash` works
too — then quit and reopen Terminal.)

Check it worked:

```sh
bun --version
```

You only need bun to *prepare* a groove — once a player is in MainStage,
MainStage runs it and bun is not involved.

## Prepare a player

In Terminal, `cd` into this folder, then copy a finished player straight to the
clipboard.

The included example groove:

```sh
pbcopy < example-player.js
```

Or bake your own groove from a MIDI file:

```sh
bun run midi2scripter.js to-script my-groove.mid | pbcopy
```

(Writing to a file with `-o out.js` works too, but piping into `pbcopy` is
usually quicker.)

**Bundle several grooves into one player** by passing more than one MIDI file —
each becomes a switchable **part**, named after its file:

```sh
bun run midi2scripter.js to-script verse.mid chorus.mid fill.mid | pbcopy
```

You then switch between the parts live with a CC (see *Switching parts live*
below). Baking a player back to a MIDI file works the other way round:

```sh
bun run midi2scripter.js to-midi my-player.js -o groove.mid          # first part
bun run midi2scripter.js to-midi my-player.js --part chorus -o c.mid # by name
bun run midi2scripter.js to-midi my-player.js --part 3 -o fill.mid   # by number
```

To make `my-groove.mid` from Logic's **Drummer**:

1. Create a Drummer track and dial in a groove.
2. Select the Drummer region → **File → Export → Selection as MIDI File…** (or
   drag it to the Finder). A Drummer region exports straight to MIDI — no need to
   convert it to a MIDI region first.

## Load it into MainStage

1. Select the channel strip with your drum instrument.
2. At the top of the strip, click the **MIDI FX** slot → **Scripter**.
3. In Scripter, click **Open Script in Editor**, select all, paste your player,
   and click **Run Script**.
4. Press play — the groove follows MainStage's tempo.

## Switching parts live

When a player holds more than one part, only one plays at a time. You pick the
active part with a MIDI CC, and the switch takes effect on the **next bar's beat
1** — so parts always change on the downbeat, never mid-bar. There are two ways
to map the CCs, chosen with the **Switch Mode** parameter:

- **Single CC (value = part)** — one CC (**Select CC**, default 20) selects a
  part by its number: value 1 → part 1, value 2 → part 2, and so on. An
  out-of-range value does nothing.
- **Per-Part CC** — each part has its own CC (the **Part 1 CC**, **Part 2 CC**,
  … parameters, named after each part). Sending that CC with any value above 0
  selects its part.

A separate **Restart CC** (default 21) restarts the *current* part from its
beginning on the next downbeat — handy for snapping back into the loop after a
tempo or section change. All three controls are consumed by the player and are
not passed through to the instrument.

## Use it as the metronome

For a groove that starts and stops with MainStage's metronome button, put the
player on the **metronome** channel strip and give it a real kit:

1. On the metronome strip, click the instrument slot showing **Klopfgeist** (the
   click) and choose **Drum Kit Designer** instead. Drum Kit Designer follows the
   General MIDI drum layout, so the player's kick, snare, and hi-hat land on the
   right sounds.
2. Insert **Scripter** in that strip's MIDI FX slot and paste your player.
3. Turn **Block Incoming Notes** on (see below).

Now the metronome button switches your groove on and off, and you hear a kit
instead of a click. (Prefer to keep it simple? Just leave the player on your drum
instrument's own strip — then it plays whenever MainStage is playing.)

## "Block Incoming Notes"

Alongside the part-switching controls above, the player has a checkbox **Block
Incoming Notes**, on by default.

When it's on, MIDI notes arriving *into* the player are swallowed, so you hear
only the groove the player generates. (Other messages — sustain, CC, pitch bend
— still pass through.)

This is what makes the metronome-strip setup clean: MainStage's metronome keeps
sending its own click notes to the instrument, and blocking them lets the
metronome button gate your groove *without* the click sounding underneath.

Turn it off if you want incoming notes to reach the instrument after all — for
example when you also play that same kit from a pad or keyboard through the same
strip.

## Editing a groove by hand

The grooves live near the top of the script, between the
`// MIDI-PLAYER:PATTERN-START` and `// MIDI-PLAYER:PATTERN-END` markers, as a
`PARTS` array. Each part carries a `name`, its per-part `cc`, the loop length in
beats (`loopBeats`, one 4/4 bar = 4), and a list of compact note **tuples**:

```js
var PARTS = [
  { name: "backbeat", cc: 0, loopBeats: 4, pattern: [
    [0.0, 42, 80, 0.1],   // [offset, pitch, velocity, length], all in beats
    [1.0, 38, 100, 0.1]
  ] }
];
```

Each tuple is `[offset, pitch, velocity, length]`: the beat position within the
loop, the MIDI note number (36 kick, 38 snare, 42 closed hat), the velocity
(1–127), and the note length in beats. Paste a baked groove there, tweak a
number, and re-run the script. `midi2scripter` reads the older
`{ offset, pitch, velocity, length }` object form too, so scripts baked with an
earlier version still convert.

## License

The code in this repository was substantially generated by AI and is therefore
not subject to copyright. See [LICENSE](LICENSE) for details.
