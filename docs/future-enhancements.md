# Future enhancements

Ideas parked for later — not committed to, just captured so they aren't lost.

## Drum note remapping for non-GM targets

The player is a pitch passthrough, and the converter bakes whatever pitches the source produces. Logic's Drummer / Drum Kit Designer is **GM-compatible for the core kit** (kick 36, snare 38, closed hat 42, open hat 46, pedal hat 44, side stick 37, toms 41/43/45/47/48/50, crash 49, ride 51, ride bell 53, …) but **extends beyond GM for articulations** (snare center/rimshot/sidestick, hat openness, ride bell/edge/tip, ghost notes, flams).

This is fine as long as the MainStage instrument receiving the notes is GM-compatible (most Apple/AU drum instruments are). If a target uses a different layout — some Kontakt libraries, EZdrummer/Superior Drummer, Addictive Drums, BFD — then kick/snare/hat may not line up.

**If it becomes needed**, add optional pitch remapping, either:
- a `--map <table>` on `midi2scripter.js` that rewrites pitches at bake time (`to-script`), or
- a small lookup table in the player's `ProcessMIDI` that translates at play time.

Ship a couple of preset maps (GM ↔ a specific target) rather than a bespoke UI. Worth doing only once a concrete non-GM target is actually in use; for the current Drummer → GM-instrument workflow, nothing is required.
