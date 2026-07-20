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
bun run midi2scripter.js to-midi my-player.js                    # ALL parts -> my-player.<part>.mid
bun run midi2scripter.js to-midi my-player.js --part chorus -o c.mid  # one part, by name
bun run midi2scripter.js to-midi my-player.js --part 3 -o fill.mid    # one part, by number
```

With no `--part`, `to-midi` writes **every** part, one `.mid` each, named
`<base>.<part>.mid`. Add `--part` (a name or 1-based number) to export just one.
`bun run midi2scripter.js --version` prints the tool version; every baked player
records the same version it was generated with.

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
1** — so parts always change on the downbeat, never mid-bar. There are several
switch controls; they all work at once, so map whichever your controller can
send. Each is a CC number parameter; set it to **0** to disable that control.

- **Select Part CC** (default 20) — selects a part by its *value*: value 1 →
  part 1, value 2 → part 2, and so on. An out-of-range value does nothing.
- **Previous Part CC** / **Next Part CC** (defaults 22 / 23) — step to the
  previous / next part, wrapping around the ends. Great for a pair of footswitch
  buttons.
- **Part N (name) CC** — each part also has its own dedicated CC parameter
  (named after the part). Sending that CC with any value above 0 selects it.
- **Restart CC** (default 21) — restarts the *current* part from its beginning
  on the next downbeat, for snapping back into the loop after a tempo or section
  change.

- **Enable CC** (default 24) — starts / stops the groove immediately. A value
  **≥ 64** enables output, **< 64** mutes it (so a latching button's 127/0 maps
  straight onto on/off). Disabling silences ringing notes at once; enabling
  resumes **in phase** with the bar grid, as if the groove had been playing all
  along — so the loop stays measure-aligned across a mute.

All of these are consumed by the player and not passed through to the instrument.

**Buttons sending value 0?** A switch fires on a CC value above 0. Some
controllers' *toggle* buttons send a high value on one press and **0** on the
next, so only every other press switches. Set `var TRACE = true;` near the top
of the script to print the incoming CC stream (number + value) and every switch
decision to Scripter's console — the quickest way to see what your buttons send
and set them to momentary/trigger mode if needed.

## Start and stop it like a metronome

The obvious idea — putting the player on MainStage's **metronome** channel strip
so its button gates the groove — does **not** work: metronome strips don't pass
MIDI into Scripter. Use the **Enable CC** instead:

1. Put the player on a normal instrument strip with a real kit (e.g. **Drum Kit
   Designer**, which follows the General MIDI drum layout so kick, snare, and
   hi-hat land right).
2. In Layout mode, add a button and map it to the **Enable CC** number (default
   24). Make it a **latching** (toggle) button so it sends 127 / 0.

Now that button starts and stops the groove on demand, immediately, while the
loop stays locked to the bar — your hands-free metronome, with a real kit
instead of a click. (Prefer it always-on? Just leave **Enable CC** at 0 to
disable the control, and the groove plays whenever MainStage is playing.)

## "Block Incoming Notes"

Alongside the part-switching controls above, the player has a checkbox **Block
Incoming Notes**, on by default.

When it's on, MIDI notes arriving *into* the player are swallowed, so you hear
only the groove the player generates. (Other messages — sustain, CC, pitch bend
— still pass through, including the switch CCs the player consumes.)

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
