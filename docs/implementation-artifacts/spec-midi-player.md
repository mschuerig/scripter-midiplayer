---
title: 'Scripter Host-Synced MIDI Player'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'NO_VCS'
final_revision: 'NO_VCS'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** MainStage's built-in metronome is a bare click; Michael wants a more engaging, host-synced rhythmic accompaniment that plays into his existing virtual drum/percussion instruments. Logic's Drummer cannot run in realtime inside MainStage, so a live-synced player is the pragmatic substitute.

**Approach:** A single Logic/MainStage **Scripter** (MIDI FX) script that reads the host tempo/transport and plays a looping multi-lane MIDI drum pattern locked to the host beat grid, emitting MIDI only (no audio). Pattern data is embedded as an easily-replaceable note array so a baked Drummer/MuseScore groove can be pasted in later.

## Boundaries & Constraints

**Always:**
- Declare `var NeedsTimingInfo = true;` so `GetTimingInfo()` returns valid transport data.
- Schedule every note event in **beats** via `sendAtBeat`, never in seconds, so host tempo changes track automatically.
- Emit MIDI only; never synthesize audio.
- Pair every generated NoteOn with a NoteOff; no note may hang across a loop wrap, block boundary, or transport stop.
- Keep pattern data in one clearly-marked constant — per event `{beat offset, pitch, velocity, length-in-beats}` plus a `LOOP_BEATS` loop length — so it is trivially replaceable.

**Block If:**
- Scripter's timing/scheduling API cannot express beat-accurate looping without drift (would force a fundamentally different design).

**Never:**
- No native AU / Swift / `truce` port in this spec — separate future work.
- No runtime MIDI-file loading (Scripter has no file I/O) and no MIDI-file→array converter here — separate tool.
- No self-managed transport or play/stop state; host Play (and, on the metronome strip, the metronome toggle) gates playback. On/off is done by mapping the plugin's bypass to a MainStage button — no dedicated Enable parameter.
- No custom GUI beyond `PluginParameters`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Transport playing | `GetTimingInfo().playing == true` | Pattern events overlapping the current block scheduled at their absolute beats | No error expected |
| Transport stopped | `playing == false` | Emit nothing; leave no notes on | Reset sends All Notes Off |
| Tempo change mid-play | host tempo changes | Groove follows within one block, no drift | Beat scheduling makes this inherent |
| Loop wrap | block spans a loop boundary | Events on both sides scheduled; note-offs still fire | Pair offs by absolute beat |
| Incoming notes, block on | upstream NoteOn/NoteOff, checkbox on (default) | Swallowed | — |
| Incoming CC / other, block on | upstream CC / pitch bend / sustain | Passed through untouched | — |
| Incoming notes, block off | checkbox off | Passed through | — |

</intent-contract>

## Code Map

- `scripter/midi-player.js` -- NEW. The entire runtime deliverable: a self-contained Scripter MIDI FX script. Loads verbatim into Logic/MainStage's Scripter; must contain no module system, no imports, no build step. Holds the pure helper `eventsInBlock(...)`, the `PATTERN`/`LOOP_BEATS` data, `ProcessMIDI`, `HandleMIDI`, `Reset`, and `PluginParameters`. Ends with a Node-guarded `module.exports` so tests can import the pure helper; Scripter's engine ignores that block.
- `scripter/midi-player.test.js` -- NEW. `bun:test` unit tests for the pure `eventsInBlock` helper, covering the I/O matrix's timing edge cases (loop wrap, block boundaries, empty blocks). Never loaded by Scripter.
- `docs/implementation-artifacts/spec-midi-player.md` -- this spec; single source of truth for behavior.

## Tasks & Acceptance

**Execution:**
- [x] `scripter/midi-player.js` -- create the self-contained Scripter script. Include: `var NeedsTimingInfo = true;`; a replaceable `PATTERN` (array of `{offset, pitch, velocity, length}` in beats) and `LOOP_BEATS`; a **pure function** `eventsInBlock(pattern, loopBeats, blockStartBeat, blockEndBeat)` returning the note events (`{pitch, velocity, onBeat, offBeat}`) whose on-beat falls in `[blockStartBeat, blockEndBeat)`, correctly handling loop wrap and block boundaries; `ProcessMIDI` which returns early when `!playing`, calls `eventsInBlock`, and schedules each via `NoteOn.sendAtBeat(onBeat)` + `NoteOff.sendAtBeat(offBeat)`; `HandleMIDI` implementing the block-incoming-notes filter (`GetParameter("Block Incoming Notes") && e instanceof Note` → swallow, else `e.send()`); `Reset` sending All Notes Off (MIDI CC 123, all 16 channels) as a panic; `PluginParameters` with at least a `"Block Incoming Notes"` checkbox defaulting on. Provide a musical default `PATTERN` (e.g. a one-bar backbeat: kick 36, snare 38 on 2 & 4, closed hat 42 on eighths). End with `if (typeof module !== "undefined" && module.exports) { module.exports = { eventsInBlock: eventsInBlock }; }`.
- [x] `scripter/midi-player.test.js` -- create `bun:test` unit tests (`import { test, expect } from "bun:test";` and `const { eventsInBlock } = require("./midi-player.js");`) for `eventsInBlock` covering: a mid-loop block returns the events in range; a block spanning the loop boundary returns events from both the tail of one loop and the head of the next with monotonic absolute beats; an empty region returns `[]`; each returned event's `offBeat == onBeat + length`.

**Acceptance Criteria:**
- Given the script in a MIDI FX slot on an instrument strip and Play enabled, when the transport runs, then the embedded pattern plays locked to the host beat and audibly in time.
- Given the groove playing, when the host tempo changes, then the groove follows within one block with no drift and no stuck notes.
- Given "Block Incoming Notes" is on (default), the script on the metronome strip, and the metronome enabled, when the metronome click notes arrive, then they are swallowed and only the groove is heard, while CC and other messages still pass.
- Given the transport stops mid-note, when `Reset` runs, then All Notes Off is sent on all channels and nothing hangs.
- Given `bun run scripter/midi-player.js`, when run, then it exits 0 (the script loads and parses; no Scripter globals are invoked at top level).
- Given `bun test scripter/`, when run, then all `eventsInBlock` tests pass.

## Spec Change Log

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - `[low]` `[patch]` `eventsInBlock` silently dropped any pattern event with `offset` outside `[0, LOOP_BEATS)` (e.g. pasting a 2-bar groove while leaving `LOOP_BEATS=4`) — a footgun for the documented paste-a-baked-groove workflow. Normalized `offset` modulo `loopBeats` in the pure helper (identity for well-formed input) and added a `bun:test` covering out-of-range and negative offsets. Re-verified: `bun run` exit 0, `bun test` 10/10 pass.

Rejected (noise / by-design / out of this spec's scope; recorded as residual risk, not defects in the shipped artifact): hung notes across an arbitrary Logic **cycle** locator (host-transport territory the spec cedes to the host; not triggered by the default short-note pattern); same-pitch note overlap on future long-note edits (drums are one-shots; NoteOff often ignored); loop length decoupled from meter (spec fixes `LOOP_BEATS` by design); pattern playing during negative-beat count-in (ambiguous, low); `ProcessMIDI`/`HandleMIDI`/`Reset` untested (require the Scripter host — the reason the pure helper was isolated); tempo-relative `length: 0.1`; `Reset` panicking all 16 channels (safe/desirable); block-filter passing CC/pitch-bend (per intent); per-block alloc/sort on the RT thread (12 events, negligible); plus two artifacts of the condensed review diff (prose-stub test, "undocumented" magic numbers — the real file is commented and its tests pass).

## Design Notes

Scripter API essentials — the dev agent MUST NOT invent API; use these:
- Callbacks: `ProcessMIDI()` (per block — schedule here), `HandleMIDI(event)` (per incoming event; if defined, the script owns passthrough — call `event.send()` to pass, `return` to swallow), `ParameterChanged(index, value)`, `Reset()` (called on stop/reset — send All Notes Off here), `Idle()` (optional).
- Timing: `GetTimingInfo()` returns `{ playing, blockStartBeat, blockEndBeat, blockLength, tempo, meterNumerator, meterDenominator, ... }`. Requires the global `var NeedsTimingInfo = true;`.
- Events: `Note` is the base class of `NoteOn` and `NoteOff`, so `event instanceof Note` matches both. Set `.pitch`, `.velocity`, `.channel`. Send with `.send()`, `.sendAtBeat(beat)`, or `.sendAfterBeats(n)`. All Notes Off: send a `ControlChange` with `.number = 123`, `.value = 0` on each channel 1–16.
- Params: `var PluginParameters = [{ name, type:"checkbox"|"menu"|"lin", defaultValue, ... }]`; read with `GetParameter("Name")`.

Why the pure `eventsInBlock` helper: Scripter runs inside Logic/MainStage and cannot be unit-tested from bun/Node (its globals `NoteOn`, `GetTimingInfo`, etc. don't exist there). Isolating the beat math — the one place bugs hide, at loop wrap and block edges — into a pure function makes it testable under `bun test` while `ProcessMIDI` stays a thin adapter that turns the returned events into `sendAtBeat` calls. The guarded `module.exports` lets bun/Node `require` it; Scripter never evaluates that branch.

Scheduler sketch (absolute beat of a pattern event in loop iteration `k` is `k * LOOP_BEATS + offset`; iterate the `k` values whose events can land in the block):
```
var evs = eventsInBlock(PATTERN, LOOP_BEATS, info.blockStartBeat, info.blockEndBeat);
for (var i = 0; i < evs.length; i++) {
  var on = new NoteOn();  on.pitch = evs[i].pitch; on.velocity = evs[i].velocity; on.sendAtBeat(evs[i].onBeat);
  var off = new NoteOff(); off.pitch = evs[i].pitch;                                 off.sendAtBeat(evs[i].offBeat);
}
```

Block-incoming-notes filter (default on):
```
function HandleMIDI(e) {
  if (GetParameter("Block Incoming Notes") && e instanceof Note) return;
  e.send();
}
```

## Verification

**Commands:**
- `bun run scripter/midi-player.js` -- expected: exit 0. Loads and parses the script; no Scripter globals are invoked at top level, so it returns cleanly under bun.
- `bun test scripter/` -- expected: all tests pass; exercises the `eventsInBlock` edge cases from the I/O matrix.

**Manual checks (Scripter only runs inside MainStage/Logic):**
- Insert in a MIDI FX slot above a drum instrument on a normal instrument strip; enable Play → groove plays in time.
- Change the host tempo → groove tracks immediately, no drift.
- Move to the metronome strip, enable the metronome, "Block Incoming Notes" on → metronome click silenced, groove still plays.
- Stop the transport mid-pattern → no hung notes.

## Auto Run Result

Status: done

**Summary:** Implemented the self-contained Logic/MainStage Scripter MIDI FX player — a host-synced, MIDI-only looping drum pattern with beat-accurate scheduling, paired note-offs, an All-Notes-Off panic on stop, and a "Block Incoming Notes" filter. The trickiest logic (loop-wrap/block-edge beat math) is isolated in a pure, unit-tested helper.

**Files changed:**
- `scripter/midi-player.js` — the Scripter script: `NeedsTimingInfo`, replaceable `PATTERN`/`LOOP_BEATS` (default one-bar 4/4 backbeat) behind an "EDIT THIS" banner, pure `eventsInBlock` scheduler (offset now normalized modulo the loop length), `ProcessMIDI` adapter, `HandleMIDI` block-notes filter, `Reset` panic, `PluginParameters`, and a Node-guarded `module.exports`.
- `scripter/midi-player.test.js` — 10 `bun:test` unit tests for `eventsInBlock` (mid-loop, half-open range, loop-boundary span, multi-loop span, empty/zero-width blocks, `offBeat === onBeat + length`, non-positive `loopBeats`, fractional edges, out-of-range/negative offset normalization).

**Review findings breakdown:** 1 patch applied (low — silent note-drop on out-of-range offset, now normalized); 0 deferred; 12 rejected (out-of-scope host-cycle behavior, latent future-edit hardening, design choices per spec, and two artifacts of the condensed review diff). See Review Triage Log.

**Verification:** `bun run scripter/midi-player.js` → exit 0; `bun test scripter/` → 10/10 pass, 59 assertions. Manual in-MainStage checks (host sync, tempo tracking, metronome-strip block-notes, no hung notes on stop) remain for Michael at the keyboard — Scripter cannot run outside Logic/MainStage.

**Residual risks (not defects in the shipped artifact):** notes can hang if a Logic **cycle** locator is placed between a note's on and off (host-transport edge the spec cedes to the host; `Reset` clears it on stop); future pattern edits with long, overlapping same-pitch notes could truncate (drums are typically one-shots); loop length is fixed at `LOOP_BEATS` and not meter-aware by design.

**Follow-up review recommended:** false — a single localized, low-consequence, test-locked patch.
