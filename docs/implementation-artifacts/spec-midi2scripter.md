---
title: 'MIDI ↔ Player-Script Converter (bun CLI)'
type: 'feature'
created: '2026-07-19'
status: 'done'
baseline_revision: 'NO_VCS'
final_revision: 'NO_VCS'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
---

<intent-contract>

## Intent

**Problem:** The player's `PATTERN` must be hand-authored; baking a Drummer/MuseScore MIDI groove into it is manual and error-prone, and there is no way back from a script to a MIDI file for further editing in Logic.

**Approach:** A dependency-free **bun CLI**, `midi2scripter.js`, that (1) converts a Standard MIDI File into a *complete, ready-to-load* copy of the player script with the groove baked into its `PATTERN`/`LOOP_BEATS` block, (2) refreshes the player engine in an existing script from the template while keeping that script's own pattern, and (3) converts a script back to a MIDI file. Machine-readable sentinel comments are added to the player so the block can be located, replaced, and re-parsed reliably.

## Boundaries & Constraints

**Always:**
- Dependency-free: no `package.json`, no npm packages. Hand-roll a minimal Standard MIDI File (SMF) reader/writer. Run everything under **bun**.
- `to-script` and `update` are complementary splices around the `// MIDI-PLAYER:PATTERN-START` / `// MIDI-PLAYER:PATTERN-END` sentinels: `to-script` writes a freshly-converted pattern into the template engine; `update` writes the existing script's pattern (verbatim) into a fresh template engine. The template is the single source of the engine.
- Never `eval` script text. Parse the pattern's numeric object literals with a restricted parser (regex/number parsing only).
- Any script the converter emits must load under bun (`bun run <file>` exits 0) with the player engine and its `module.exports` intact.
- Core logic (`parseSmf`, `notesToPattern`, `renderPatternBlock`, `replacePatternBlock`, `parsePatternFromScript`, `patternToSmf`) is pure and side-effect-free; file I/O and `process.argv` handling live only in the CLI wrapper. Export the core via the Node-guarded `module.exports` pattern for tests.
- Emit `PATTERN` in the player's exact style: 2-space indent, one object per line, key order `offset, pitch, velocity, length`, decimals for `offset`/`length`, integers for `pitch`/`velocity`, no trailing comma on the last element, followed by `var LOOP_BEATS = N;`.

**Block If:**
- (none anticipated — sensible documented defaults are chosen for tempo, PPQ, and loop length; if a genuinely unresolvable input class appears, HALT blocked rather than guess.)

**Never:**
- No Scripter-runtime code here — this is a build-time CLI only; the player engine (`eventsInBlock`/`ProcessMIDI`/`HandleMIDI`/`Reset`/exports) must not be modified beyond adding the two sentinel comments.
- No SMPTE-division MIDI files (reject with a clear error); no quantization or humanization (preserve timing as read); no multi-pattern/song structure, no tempo-map baking (single tempo).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `to-script` | valid PPQ-division `.mid` | complete player script written, groove in `PATTERN`, loads under bun | — |
| `update` | existing script (has markers) | player engine replaced from the template; the script's `PATTERN`/`LOOP_BEATS` kept verbatim | error + nonzero exit if markers missing or pattern malformed |
| `to-midi` | script with a parseable `PATTERN`/`LOOP_BEATS` | `.mid` with those notes at chosen tempo/PPQ/loops | error if no parseable pattern |
| running status / note-on vel 0 | compressed SMF | parsed correctly (vel-0 note-on treated as note-off) | — |
| multi-track (format 1) | several MTrk chunks | events merged on one tick timeline | — |
| SMPTE division | MThd division high bit set | clear error, nonzero exit | handled |
| no note events | header/meta only | clear error, nonzero exit | handled |
| unpaired note-on (missing off) | dangling note | closed at track end (or skipped) deterministically | handled, no crash |

</intent-contract>

## Code Map

- `midi2scripter.js` -- NEW. The bun CLI plus the pure core functions; ends with a Node-guarded `module.exports` exposing the core for tests.
- `midi2scripter.test.js` -- NEW. `bun:test` unit tests, centred on round-trips (`pattern → SMF → parse → pattern` and `template → replace → parse → pattern`) and the error/edge cases from the I/O matrix.
- `midi-player.js` -- MODIFIED. Add `// MIDI-PLAYER:PATTERN-START` immediately before `var PATTERN = [` and `// MIDI-PLAYER:PATTERN-END` immediately after `var LOOP_BEATS = ...;` (both inside the existing EDIT-THIS banner, human doc comment preserved above). No engine/logic change; `eventsInBlock` and `module.exports` untouched.
- `midi-player.test.js` -- unchanged; it depends only on `eventsInBlock`, so the sentinels do not affect it (verify it still passes).

## Tasks & Acceptance

**Execution:**
- [x] `midi-player.js` -- add the two sentinel comment lines (`// MIDI-PLAYER:PATTERN-START` / `// MIDI-PLAYER:PATTERN-END`) bracketing the `PATTERN`…`LOOP_BEATS` region. No other change.
- [x] `midi2scripter.js` -- implement the pure core and the CLI. Pure functions (all exported): `parseSmf(bytes)` → `{ ppq, timeSigNum, timeSigDen, tempoBpm, notes:[{pitch,velocity,startTick,endTick,channel}] }` (MThd/MTrk chunks, variable-length delta times, running status, note-on vel 0 = note-off paired per channel+pitch, meta set-tempo 0x51 / time-sig 0x58 / end-of-track 0x2F, skip other meta/sysex by length, merge all tracks; reject SMPTE division); `notesToPattern(parsed, opts)` → `{ pattern, loopBeats }` (beat = tick/ppq; `offset` normalized into `[0, loopBeats)`; `length` = (endTick−startTick)/ppq; `loopBeats` = `opts.loopBeats` else max end-beat rounded up to a whole bar with `beatsPerBar = timeSigNum*4/timeSigDen`, min 1; round beats to 1e-6; sort by offset); `renderPatternBlock(pattern, loopBeats)` → player-style JS string; `replacePatternBlock(scriptText, blockText)` → script with the marker region replaced (throw if markers absent/duplicated); `extractPatternBlock(scriptText)` → the verbatim text between the markers (throw if absent/duplicated); `parsePatternFromScript(scriptText)` → `{ pattern, loopBeats }` (restricted numeric parse between markers; throw if malformed); `patternToSmf(pattern, loopBeats, opts)` → `Uint8Array` (SMF format 0, one MTrk, `ppq` default 480, `tempoBpm` default 120, `loops` default 1; absolute-tick note on/off, sorted, delta-encoded, end-of-track). CLI: `to-script <in.mid> [-o out.js] [--loop-beats N] [--template path]` (default template = `midi-player.js`), `update <script.js> [--template path] [-o out.js]` (refresh engine from template, keep the script's pattern; default writes in place), `to-midi <script.js> [-o out.mid] [--tempo BPM] [--ppq N] [--loops N]`, and `--help`; clear errors + nonzero exit on bad input; guarded `module.exports` for the core.
- [x] `midi2scripter.test.js` -- `bun:test` covering: `patternToSmf`→`parseSmf`+`notesToPattern` round-trips a known pattern (pitches, offsets, lengths within 1e-6, loopBeats); `replacePatternBlock(template, renderPatternBlock(P))` then `parsePatternFromScript` returns `P`; `replacePatternBlock` throws when markers are missing; running-status/vel-0 SMF parses; SMPTE division rejected; empty-notes rejected; `renderPatternBlock` output matches the player's formatting (key order, no trailing comma).

**Acceptance Criteria:**
- Given a valid `.mid`, when `to-script` runs, then a complete player script is produced with the groove in `PATTERN`, and `bun run` on that output exits 0.
- Given an existing script with a custom pattern, when `update` runs, then the engine (everything outside the markers) matches the template and the script's `PATTERN`/`LOOP_BEATS` is unchanged.
- Given a script with a parseable pattern, when `to-midi` runs, then a `.mid` is written whose notes, re-read via `parseSmf`/`notesToPattern`, match the script's pattern within 1e-6.
- Given a SMPTE-division `.mid` or one with no notes, when any command reads it, then the CLI prints a clear error and exits nonzero.
- Given the sentinel edit to the player, when `bun test` runs, then the pre-existing player tests still pass.
- Given `bun test`, when run, then all converter tests pass.

## Spec Change Log

### 2026-07-19 — `update` semantics corrected (user feedback)
- Triggering finding: the captured intent for `update` was reversed. The spec had it swapping in a new pattern from a `.mid` while keeping the engine; the user's actual intent is to **refresh the engine from the template while keeping the script's existing pattern**.
- Amended: Intent (Approach), Boundaries, I/O matrix `update` row, the `update` task/CLI signature, its acceptance criterion, and Design Notes. Added the `extractPatternBlock` core function; `update` no longer takes a `.mid` (gains `--template`, default `midi-player.js`).
- Known-bad avoided: an `update` that clobbers a user's baked groove instead of upgrading the engine beneath it.
- KEEP: the sentinel-anchored `replacePatternBlock` primitive and the DRY single-engine-file design — both `to-script` and `update` reuse it, just in opposite directions.

### 2026-07-20 — Single-file bundle; moved to project root
- Change: the converter is now self-contained. `midi-player.js` stays a separate source in the repo (directly unit-tested), and its full text is embedded in `midi2scripter.js` as `PLAYER_TEMPLATE`, which is the default template for `to-script`/`update` (so the one file installs and runs with no sibling). A `build` command re-embeds it from the source; a test asserts the two stay in sync. `--template <file>` still overrides the bundled default.
- Dropped: no player-emit command — `to-script` already outputs a full player, and any output can just be edited.
- Structure: everything moved from `scripter/` to the project root; `scripter/` removed. `docs/` unchanged.
- KEEP: the sentinel-anchored splice primitive and the DRY single-engine-source design.

## Review Triage Log

### 2026-07-19 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 0
- reject: 3: (high 0, medium 0, low 3)
- addressed_findings:
  - `[medium]` `[patch]` `parsePatternFromScript` silently dropped notes whose object had a reordered/extra key (the empty-check only fired when *all* objects failed) — silent data loss on the documented hand-edit → `to-midi` path. Now strips comments and validates every brace-group against the strict shape, throwing on any malformed event. Tests added (reorder, extra-key, comment-with-braces tolerated).
  - `[low]` `[patch]` `patternToSmf` accepted out-of-range note values, producing a silently corrupt `.mid` (negative `offset` → ~4.29e9-tick delta; `pitch`/`velocity` > 127 masked). Added validation: `offset ≥ 0`, `length ≥ 0`, integer `pitch` 0..127, integer `velocity` 1..127 → clear error.
  - `[low]` `[patch]` `ppq > 32767` truncated / set the SMPTE bit in the 16-bit division field; now rejected (1..32767).
  - `[low]` `[patch]` `tempoBpm` below ~3.6 overflowed the 3-byte tempo meta (high byte dropped); now rejected with a clear message.
  - `[low]` `[patch]` a zero-length note emitted its note-off at the same tick (sorting before its own note-on → hung/stretched note); note-off is now forced strictly after the note-on.
  - `[low]` `[patch]` overlapping same-pitch note pairing used LIFO (`stack.pop`); switched to FIFO (`stack.shift`) — the conventional reading, so nested same-pitch durations/velocities pair correctly.

Rejected (recorded as residual risk, not defects): `replacePatternBlock` normalizes line endings *within* the rewritten region only (shipped scripts are LF; the byte-exact guarantee holds outside the markers); `to-midi` default output name uses a case-sensitive `/\.js$/` so `song.JS` → `song.JS.mid` (cosmetic; `-o` overrides); `LOOP_BEATS` is not preserved through a `to-midi`→`to-script` round-trip because the default recomputes it from the bar length (spec-sanctioned behavior, documented, `--loop-beats` overrides).

## Design Notes

**Sentinels & DRY template.** Both `to-script` and `update` are `replacePatternBlock` splices around the sentinels, in opposite directions: `to-script` puts a freshly-converted pattern block into the canonical template engine; `update` puts the existing script's pattern block (via `extractPatternBlock`, verbatim) into the canonical template engine — refreshing the engine, keeping the pattern. The engine lives in exactly one file. Anchor on the unique lines `// MIDI-PLAYER:PATTERN-START` and `// MIDI-PLAYER:PATTERN-END`; replace the text strictly between them.

**Minimal SMF.** Header `MThd` (len 6): format (0/1/2), ntrks, division. If `division & 0x8000` it's SMPTE → error. Else division = ticks per quarter note (= ppq). Each `MTrk`: `<delta varlen><event>`. Varlen = 7-bit groups, high bit = continue. Running status: a status byte < 0x80 means reuse the previous status. Note-on `0x9n` vel>0 opens; `0x8n` or `0x9n` vel 0 closes (FIFO: match the oldest open note of same channel+pitch). Meta `0xFF <type><varlen len><data>`: 0x51 tempo (3 bytes µs/quarter → bpm = 60e6/µs), 0x58 time-sig (num, den=2^data[1]), 0x2F end. Skip unknown meta and `0xF0/0xF7` sysex by their length. For format 1, decode each track to absolute ticks then merge.

**Writing SMF.** Build absolute-tick events (note-on then note-off), stable-sort by tick (offs before ons at equal tick to avoid same-tick same-pitch overlap), convert to deltas, prepend a set-tempo meta, append end-of-track; wrap in one `MTrk` with a correct 4-byte big-endian length, after an `MThd` with format 0, ntrks 1, division = ppq.

**Restricted pattern parse (reverse).** Between the markers, match each `{ offset: N, pitch: N, velocity: N, length: N }` with a number regex and `var LOOP_BEATS = N;`. No `eval`, no `Function`.

**Render example (must match player style):**
```
var PATTERN = [
  { offset: 0.0, pitch: 36, velocity: 110, length: 0.1 },
  { offset: 1.0, pitch: 38, velocity: 100, length: 0.1 }
];

var LOOP_BEATS = 4;
```

## Verification

**Commands:**
- `bun test` -- expected: all tests pass (pre-existing player tests + new converter round-trip/edge tests).
- CLI round-trip smoke (uses the shipped player as a pattern source):
  `bun run midi2scripter.js to-midi midi-player.js -o /tmp/m2s-rt.mid && bun run midi2scripter.js to-script /tmp/m2s-rt.mid -o /tmp/m2s-rt.js && bun run /tmp/m2s-rt.js; echo "loaded exit=$?"`
  -- expected: each step exits 0; the generated `/tmp/m2s-rt.js` loads (exit 0).
- `bun run midi2scripter.js --help` -- expected: usage text, exit 0.

**Manual checks:**
- `update` a copy of the player from a real Logic-exported Drummer `.mid`, then load the result in MainStage → the baked groove plays; everything outside the pattern block (params, engine) is unchanged.

## Auto Run Result

Status: done

**Summary:** Implemented `midi2scripter.js`, a dependency-free bun CLI that converts a Standard MIDI File into a complete, ready-to-load copy of the player script (`to-script`), rewrites the pattern block inside an existing script in place while preserving every other byte (`update`), and converts a script's pattern back to a MIDI file (`to-midi`). Machine-readable sentinels were added to the player so the block is reliably locatable; the hand-rolled SMF reader/writer round-trips losslessly.

**Files changed:**
- `midi2scripter.js` — NEW. Pure core (`parseSmf`, `notesToPattern`, `renderPatternBlock`, `replacePatternBlock`, `parsePatternFromScript`, `patternToSmf`) + CLI (`to-script`/`update`/`to-midi`/`--help`); Node-guarded exports, CLI runs only under `require.main === module`.
- `midi2scripter.test.js` — NEW. 22 `bun:test` cases: SMF round-trip, template replace→reparse, byte-preservation, marker errors, running-status/vel-0, tempo/time-sig meta, SMPTE/empty rejection, formatting, default-bar loopBeats, offset normalization, plus review-driven cases (malformed-reparse throws, value-range validation, ppq/tempo header overflow, FIFO pairing, zero-length note-off).
- `midi-player.js` — MODIFIED. Two sentinel comments only; engine and exports untouched (its 10 tests still pass).

**Review findings breakdown:** 6 patches applied (1 medium: silent note-drop on hand-edited reparse; 5 low: MIDI value/header validation, zero-length note-off ordering, FIFO note pairing); 0 deferred; 3 rejected (in-region CRLF normalization, case-sensitive output-name suffix, spec-sanctioned loopBeats recomputation).

**Verification:** `bun test` → 32/32 pass (10 player + 22 converter), 123 assertions. CLI round-trip smoke (`to-midi` → `to-script` → `bun run` the generated script) → each step exit 0. `update` byte-preservation confirmed (head/tail identical outside markers). `--help` exit 0.

**Follow-up review recommended:** true — six fixes on a hand-rolled binary MIDI reader/writer, including a data-integrity finding; the domain is corruption-prone enough that an independent pass adds value despite each fix being localized and test-locked.

**Residual risks:** `to-midi`→`to-script` does not preserve `LOOP_BEATS` (default recomputes from bar length; use `--loop-beats`); output-name suffix stripping is case-sensitive; SMF support is intentionally a subset (format 0/1, PPQ division, single tempo, no quantization).

**Correction (2026-07-19, post-run, per user feedback):** The `update` command's direction was reversed. It now **refreshes the player engine** in an existing script from the template (`--template`, default `midi-player.js`) while **keeping the script's own `PATTERN`/`LOOP_BEATS`** — it no longer takes a `.mid`. Added the `extractPatternBlock` core function; updated the CLI/help, spec sections, and tests (23 converter cases; 33 total). Re-verified end-to-end: engine refreshed from the template, pattern byte-identical, generated script loads (exit 0). Note-pairing was also switched to FIFO during review.
