# Examples

*[Deutsch](README.de.md)*

Ready-made examples for the [MIDI Player](../README.md). Start here to try the
player without baking a groove of your own first.

## `example-player.js`

A finished, ready-to-paste player script. It bundles four switchable grooves —
`Drummer-4-4`, `Drummer-3-4`, `Drummer-6-8`, and `Drummer-7-8` — so you can hear
part switching straight away. Copy it to the clipboard and paste it into
Scripter (see [Prepare a player](../README.md#prepare-a-player) in the top-level
README):

```sh
pbcopy < example-player.js
```

It was baked from the four source grooves in this folder — `Drummer-4-4.mid`,
`Drummer-3-4.mid`, `Drummer-6-8.mid`, and `Drummer-7-8.mid` (exported from Logic's
Drummer) — so you can re-bake or tweak it:

```sh
bun run ../midi2scripter.js to-script \
  Drummer-4-4.mid Drummer-3-4.mid Drummer-6-8.mid Drummer-7-8.mid | pbcopy
```

## `Drums-Example.concert`

A MainStage concert that wires the player up end to end, so you can see how it is
meant to be driven from a controller. Double-click it to open in MainStage.

It runs a copy of `example-player.js` with **`TRACE` enabled**, so every incoming
CC (number + value) and every switch decision is printed to Scripter's console —
open the Scripter window and watch the log while you press buttons to see exactly
what your controller sends. (This is the same `TRACE` flag described under
*Switching parts live* in the top-level README; the bundled example ships with it
off.)

The concert's **screen controls** demonstrate:

- **Controlling the player** — Enable (start / stop the groove) and Rewind
  (rewind the current part to its beginning on the next downbeat).
- **Selecting the part** — two of the three ways to pick the current part:
  Select Part (choose a part by value) and Previous / Next Part (step through the
  four parts, wrapping at the ends). The third way — each part's own dedicated CC
  — isn't shown here, as the example's parts leave their per-part CC at 0. Either
  way, switches take effect on the next downbeat, so the parts change on the beat.
- **Tempo** — a screen control mapped to MainStage's tempo changes the playback
  speed; the groove follows it instantly, just as it follows any host tempo
  change.

### The time-signature caveat

The four grooves are in different meters (4/4, 3/4, 6/8, 7/8), and switching to
one plays that meter's groove. What a screen control **cannot** do is change
MainStage's own **time signature** — MainStage exposes no screen-control target
for it, so the host bar grid and metronome stay put even as you switch to a
groove in a different meter. Set the time signature by hand in MainStage if you
need the host grid to match.
