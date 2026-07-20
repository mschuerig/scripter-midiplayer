---
title: 'Multi-Part Player: CC part switching, beat-aware restart, compact pattern format'
type: 'feature'
created: '2026-07-20'
status: 'done'
baseline_revision: '0b15bca523cb79f97bd58ab36194a154d889095d'
final_revision: 'PENDING_COMMIT'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['multiple-goals', 'oversized']
---

<intent-contract>

## Intent

**Problem:** The player holds exactly one groove (`PATTERN`/`LOOP_BEATS`) in a wordy `{offset,pitch,velocity,length}` object-per-line form. Michael wants (1) several source grooves bundled into one script as switchable **parts**, selectable live by CC; (2) a CC that **restarts** the current part cleanly on a downbeat; (3) a **compact** pattern representation.

**Approach:** Evolve the single-part data block into a `PARTS` array (each part carries `name`, `cc`, `loopBeats`, and a compact tuple `pattern`), keeping the sentinel-anchored, hand-editable data block. Add a beat-locked scheduling planner so part switches and restarts take effect at the next bar boundary (beat 1). Extend the converter to bundle multiple `.mid` files into one script and to emit/parse the tuple format (tolerant of the legacy format on read).

## Boundaries & Constraints

**Always:**
- Preserve the existing architecture: the hard beat math lives in **pure, exported, bun-testable functions**; `ProcessMIDI`/`HandleMIDI`/`Reset` stay thin Scripter adapters that invent no Scripter API beyond what Design Notes lists.
- Schedule every note in **beats** via `sendAtBeat`; pair every NoteOn with a NoteOff (schedule both when the NoteOn falls in a block) so nothing hangs across a loop wrap, part switch, restart, or stop.
- Part switches and restarts are **bar-aligned**: they take effect at the next bar boundary (a whole multiple of `barBeats = meterNumerator*4/meterDenominator`) strictly after the current transport beat, so a restarted/switched part begins on beat 1.
- The player data between `// MIDI-PLAYER:PATTERN-START` / `// MIDI-PLAYER:PATTERN-END` stays a single clearly-marked, hand-editable literal — now `var PARTS = [...]`. The engine outside the markers stays the single source embedded as `PLAYER_TEMPLATE`; `example-player.js` and `PLAYER_TEMPLATE` are regenerated from `src/midi-player.js` by `build` and guarded by the sync tests.
- Compact pattern form is a **4-tuple `[offset, pitch, velocity, length]`** (same field order as the old object). On read, the converter also accepts the legacy object form and a legacy single `PATTERN`/`LOOP_BEATS` script (treated as one part) so existing scripts still convert.
- Converter core stays pure/dependency-free (hand-rolled SMF, no npm); only the CLI wrapper touches fs/argv.

**Block If:**
- (none anticipated — the compression trade-off, switch-timing, and default CC assignments have documented defaults below. If a genuinely unresolvable input class appears, HALT blocked rather than guess.)

**Never:**
- No opaque binary/base64 pattern compression: it would destroy the paste-a-groove / hand-edit workflow and force a decompressor into the Scripter runtime. The tuple form is the "more efficient representation" delivered; real compression is evaluated and declined (see Design Notes).
- No self-managed transport/play state; host Play still gates playback. No per-part audio; MIDI only.
- No native AU/Swift port. No runtime MIDI-file loading in Scripter (bundling happens at bake time in the converter).
- Do not force All-Notes-Off on a part switch (would cut ringing one-shots); `Reset` still panics on stop.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Play, one active part | `playing`, `activePart` set | that part loops from its bar-aligned origin, scheduled per block | — |
| Single-CC select | Switch Mode = Single CC, `Select CC` arrives value `v` | `v` in `1..PARTS.length` schedules switch to part `v-1` at next bar; `v==0` or `v>length` ignored | out-of-range = no-op |
| Per-Part CC select | Switch Mode = Per-Part CC, a part's CC arrives value `>0` | schedule switch to the first part whose `cc` matches, at next bar; value `0` ignored | unmatched CC passes through |
| Restart CC | `Restart CC` arrives value `>0` | schedule a switch to the **current** part with a fresh bar-aligned origin (restart on beat 1) | value `0` ignored |
| Switch boundary inside a block | pending `atBeat` in `[blockStart, blockEnd)` | schedule old part up to `atBeat`, new part from `atBeat`; no missed downbeat, no hang | — |
| Consumed control CC | a CC matching Select/Restart/a part CC | swallowed (not forwarded downstream) | — |
| Other CC / pitch bend | any non-control message | passed through untouched | — |
| Transport stop mid-part | `playing` → false | `Reset`: All Notes Off all channels, clear pending, re-anchor on next play | no hang |
| `to-script` multiple `.mid` | `a.mid b.mid c.mid` | one script with 3 parts (names from basenames, per-file `loopBeats`, default CCs) | error+nonzero if any file invalid/empty |
| `to-midi --part` | script with `PARTS`, `--part <name|index>` | `.mid` for the named/indexed part (default part 1) | error if part not found |
| Legacy script read | old object `PATTERN`/`LOOP_BEATS` script | parsed as a single part; `update`/`to-midi` still work | throw on truly malformed |

</intent-contract>

## Code Map

- `src/midi-player.js` -- the Scripter engine + data. Data block becomes `var PARTS`; add generalized `eventsInBlock(pattern, loopBeats, originBeat, blockStartBeat, blockEndBeat)`, pure `nextBarBoundary(beat, barBeats)` and `planBlock(state, parts, barBeats, blockStartBeat, blockEndBeat)`; multi-part `ProcessMIDI`/`HandleMIDI`/`Reset`; dynamically-built `PluginParameters`; expand the Node-guarded export. The one file whose text is the runtime deliverable.
- `src/midi-player.test.js` -- `bun:test` for the pure helpers; update `eventsInBlock` calls to the origin signature; add `nextBarBoundary` and `planBlock` cases.
- `midi2scripter.js` -- converter. Rebuild `PLAYER_TEMPLATE` from the new engine (`build`); add `renderPartsBlock(parts)` and `parsePartsFromScript(scriptText)`; `to-script` bundles multiple `.mid`; `to-midi` gains `--part`; update `--help`.
- `midi2scripter.test.js` -- update format/round-trip tests to `PARTS`/tuples; add multi-file bundle, legacy-tolerance, and `to-midi --part` cases; keep SMF and sync tests.
- `example-player.js` -- regenerated by `build` from `src/midi-player.js` (a multi-part example). Not hand-edited.
- `README.md`, `README.de.md` -- document multi-part bundling, switch modes/params, Restart CC, and the tuple format.

## Tasks & Acceptance

**Execution:**
- [x] `src/midi-player.js` -- Replace the single-groove data with `var PARTS = [ { name, cc, loopBeats, pattern: [[offset,pitch,velocity,length], ...] }, ... ]` between the sentinels (default: one part `"backbeat"`, `cc:0`, `loopBeats:4`, the current backbeat as tuples). Generalize `eventsInBlock` to take `originBeat` (event abs beat = `originBeat + k*loopBeats + offset`; reads tuple indices `[0..3]`; still returns `{pitch,velocity,onBeat,offBeat}` sorted by `onBeat`). Add pure `nextBarBoundary(beat, barBeats)` = smallest multiple of `barBeats` strictly `> beat`. Add pure `planBlock(state, parts, barBeats, blockStartBeat, blockEndBeat)` returning `{segments:[{part,origin,segStart,segEnd}], next}` implementing the pending-change/split-at-boundary logic (see Design Notes). Module state `STATE={activePart:0, partOrigin:0, pending:null}` + `reanchor` flag. `ProcessMIDI`: return if `!playing`; compute `barBeats`; if `reanchor` set `partOrigin` to the bar boundary at/below `blockStartBeat` and clear it; call `planBlock`, then for each segment call `eventsInBlock(parts[seg.part].pattern, parts[seg.part].loopBeats, seg.origin, seg.segStart, seg.segEnd)` and schedule; store `plan.next`. `HandleMIDI`: if a `ControlChange` matches a configured control (Single-CC `Select CC`; Per-Part CC; `Restart CC`) per current params, set `STATE.pending` via `nextBarBoundary(GetTimingInfo().blockStartBeat, barBeats)` and swallow it; else keep the existing Block-Incoming-Notes filter and pass-through. `Reset`: All-Notes-Off (CC123 ch1..16), `STATE.pending=null`, `reanchor=true`. Build `PluginParameters` at load: `Block Incoming Notes` (checkbox, 1), `Switch Mode` (menu `["Single CC (value = part)","Per-Part CC"]`, default 0), `Select CC` (lin 0..127, default from data or 20), `Restart CC` (lin 0..127, default 21), then a loop pushing `"Part i CC (name)"` (lin 0..127, default `PARTS[i].cc`). Export `{eventsInBlock, nextBarBoundary, planBlock}` under the Node guard.
- [x] `src/midi-player.test.js` -- Update existing `eventsInBlock` calls to pass `originBeat` (0 preserves current expectations); add an origin-shifted case. Add `nextBarBoundary` cases (mid-bar, exactly on a boundary → next boundary, non-4 `barBeats`). Add `planBlock` cases: no pending → one whole-block segment; pending switch with `atBeat` inside the block → two segments with correct origins and `next.activePart`; pending already reached (`atBeat <= blockStart`) → applied for whole block; restart (pending part == active) yields a fresh origin.
- [x] `midi2scripter.js` -- Run `build` to refresh `PLAYER_TEMPLATE` + `example-player.js` after editing the engine. Add `renderPartsBlock(parts)` emitting `var PARTS = [ ... ]` with one `{ name, cc, loopBeats, pattern }` per part, `pattern` as `[offset, pitch, velocity, length]` tuples (offset/length via `formatBeat`, integer pitch/velocity, no trailing comma). Add `parsePartsFromScript(scriptText)` → `{parts}` that parses the marker region and accepts, in order: new tuple `PARTS`; legacy object `PARTS`; a legacy single `PATTERN`/`LOOP_BEATS` (→ one part `{name:"part1",cc:0,...}`); throw on a malformed event (reordered/extra fields) as today. `to-script`: accept multiple positional `.mid` paths → one part each (`name`=sanitized basename, `loopBeats` per file via `notesToPattern`, `cc` default 0), render with `renderPartsBlock`, splice into the template; `--loop-beats` still overrides all. `to-midi`: use `parsePartsFromScript`, add `--part <name|1-based index>` (default 1), feed the chosen part's `pattern`/`loopBeats` to `patternToSmf`; clear error if the part is not found. `update`: validate via `parsePartsFromScript`, splice the verbatim block as today. Update `printHelp`.
- [x] `midi2scripter.test.js` -- Replace/extend format tests for `renderPartsBlock` (tuple formatting, key/element order, no trailing comma) and the round-trip `renderPartsBlock → replacePatternBlock(template) → parsePartsFromScript`. Add: multi-`.mid` `to-script` builds N parts (drive the pure path, e.g. two `patternToSmf` fixtures → parse → assemble parts → render → reparse); `parsePartsFromScript` reads a legacy object `PARTS` and a legacy `PATTERN`/`LOOP_BEATS` script; `to-midi --part` selects the right part. Keep the SMF, marker-error, and `PLAYER_TEMPLATE`/`example-player.js` sync tests green.
- [x] `README.md`, `README.de.md` -- Document: bundling multiple `.mid` into one script (`to-script a.mid b.mid ...`); the two switch modes and their params (`Switch Mode`, `Select CC`, per-part CC); `Restart CC` (bar-aligned restart); `to-midi --part`; and the compact tuple pattern format.

**Acceptance Criteria:**
- Given a bundled multi-part script in a MIDI FX slot with Play running, when the transport plays, then the active part loops in time locked to the host beat; when the host tempo changes, the groove follows within a block with no drift or stuck notes.
- Given Switch Mode = Single CC and a `Select CC` message of value `n`, when `n` is a valid 1-based part number, then playback switches to that part beginning on the next bar's beat 1; an out-of-range value changes nothing.
- Given Switch Mode = Per-Part CC, when a part's configured CC arrives with value > 0, then playback switches to that part on the next bar.
- Given the `Restart CC` arrives mid-part, when the next bar boundary is reached, then the current part restarts from its beginning on beat 1, with no hung notes.
- Given `bun run midi2scripter.js to-script a.mid b.mid -o out.js`, when run on two valid `.mid` files, then `out.js` contains two parts and `bun run out.js` exits 0.
- Given a legacy object-format script, when `to-midi`/`update` run, then they still succeed (legacy read is tolerated).
- Given `bun test`, when run, then all tests pass, including the `PLAYER_TEMPLATE` and `example-player.js` sync guards.

## Spec Change Log

## Review Triage Log

### 2026-07-20 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 1, medium 2, low 5)
- defer: 1
- reject: 4
- addressed_findings:
  - `[high]` `[patch]` Per-Part CC mode was non-functional and hijacked Bank Select: `handleControlCC` matched the static baked `PARTS[i].cc` (all `0` on converter-baked bundles) instead of the live "Part i CC" UI parameter, so setting a CC in the plugin did nothing and any incoming CC 0 (Bank Select) was swallowed and forced part 0. Now reads the parameter via a shared `partCcParamName(i, name)` helper (unit-tested for exact-string coupling) and treats CC 0 as "unassigned" for all control CCs (Select/Restart/per-part), so Bank Select passes through.
  - `[medium]` `[patch]` Restart CC value 0 (e.g. a footswitch release) leaked downstream to the instrument, contradicting the "consumed control CC is swallowed" contract row. A matching Restart CC is now always consumed; only value > 0 triggers the restart.
  - `[medium]` `[patch]` `update` on a legacy object-form `PARTS` script spliced object literals verbatim onto the tuple-indexing engine, yielding a script that loads but plays nothing. `update` now re-renders any non-tuple block (legacy object `PARTS` or single `PATTERN`/`LOOP_BEATS`) into canonical tuple form; only a genuine tuple block is spliced verbatim.
  - `[low]` `[patch]` `to-midi --part` treated any all-digit `--part` value as a 1-based index, making a part literally named "2" unreachable. `selectPart` now matches an exact name first, then falls back to index.
  - `[low]` `[patch]` A hand-edited pattern body mixing tuple and object events silently dropped the tuples. `parsePatternBody` now throws on a mixed body.
  - `[low]` `[patch]` `to-script` on files with the same basename produced duplicate part names, so `--part <name>` only reached the first. Names are now de-duplicated at bake time (`foo`, `foo-2`, …).
  - `[low]` `[patch]` Single-quoted part names in a hand-edited script failed to parse. The header parser now accepts single or double quotes.
  - `[low]` `[patch]` A hand-edited empty `var PARTS = []` crashed `ProcessMIDI` every block (index into `undefined`). Added an early-return guard.

Rejected (residual risk, not defects): negative-offset round-trip asymmetry (the player normalizes offsets while `patternToSmf` deliberately rejects negatives — a pre-existing, review-added safety against corrupt `.mid`); Per-Part CC that collides with the Restart/Select CC number (documented precedence, misconfiguration only); the generated `example-player.js` header reading `// midi-player.js` (it is a verbatim sync-copy of the engine source — cosmetic); `--part` passed with no following value silently defaulting to part 1 (the pre-existing `parseArgs` behavior shared by every value flag, not specific to this change).

## Design Notes

**Compression decision.** The ask is "at least array/tuple; consider real compression." Tuples cut the format ~60% while staying diff-friendly and hand-editable — the property every prior spec protects (paste a baked groove, tweak by hand). Byte/base64 compression would need a Scripter-side decompressor and kill hand-editing, so it is declined; the tuple form is the delivered efficiency win.

**Phase model.** A part's loop origin is an absolute host beat `origin` (always bar-aligned). Event abs beat in loop `k` = `origin + k*loopBeats + offset`. `eventsInBlock(pattern, loopBeats, origin, bs, be)` = the generalization of today's helper (today == `origin 0`); it returns absolute `{onBeat,offBeat}` in `[bs,be)`, tuple-indexed.

**planBlock contract** (pure; the one place switch/restart beat math lives):
```
state = { activePart, partOrigin, pending }   // pending: null | { part, atBeat }
planBlock(state, parts, barBeats, bs, be) -> { segments, next }
// pending.atBeat in [bs,be): 2 segments — {activePart,partOrigin,bs,atBeat} then
//   {pending.part, atBeat, atBeat, be}; next = {activePart:pending.part, partOrigin:atBeat, pending:null}
// pending.atBeat <= bs (already reached): 1 segment on pending.part, origin=atBeat, [bs,be); next applies it
// no pending / atBeat >= be: 1 segment on activePart/partOrigin, [bs,be); pending carried in next
```
`ProcessMIDI` loops the segments calling `eventsInBlock`; a NoteOn in a segment always schedules its NoteOff too, so a note started just before a switch completes cleanly. `HandleMIDI` sets `pending={part, atBeat: nextBarBoundary(now, barBeats)}` (restart uses `part = activePart`). `nextBarBoundary(beat,barBeats) = (floor(beat/barBeats)+1)*barBeats` — strictly next bar, so a CC on a downbeat doesn't retrigger the current bar (predictable ≤1-bar latency; chosen for musicality over immediacy).

**Tuple render example** (between the markers):
```
var PARTS = [
  { name: "backbeat", cc: 0, loopBeats: 4, pattern: [
    [0.0, 42, 80, 0.1],
    [1.0, 38, 100, 0.1]
  ] }
];
```

**Scripter API (do not invent beyond this):** callbacks `ProcessMIDI`/`HandleMIDI(event)`/`Reset`; `GetTimingInfo()` → `{playing, blockStartBeat, blockEndBeat, tempo, meterNumerator, meterDenominator}` (needs `var NeedsTimingInfo = true;`); `Note`/`NoteOn`/`NoteOff` with `.pitch/.velocity/.channel` and `.sendAtBeat(beat)`; `ControlChange` with `.number/.value/.channel`; `event instanceof ControlChange`/`Note`; All-Notes-Off = CC 123 on ch 1..16; `PluginParameters` array of `{name,type:"checkbox"|"menu"|"lin",...}` (menu uses `valueStrings`; lin uses `minValue/maxValue/numberOfSteps/defaultValue`) read with `GetParameter("Name")`. `PluginParameters` may be assembled by a load-time loop.

## Verification

**Commands:**
- `bun run midi2scripter.js build` -- regenerates `PLAYER_TEMPLATE` + `example-player.js`; run after any `src/midi-player.js` edit.
- `bun run src/midi-player.js` -- expected exit 0 (loads/parses; no Scripter globals at top level).
- `bun run example-player.js` -- expected exit 0.
- `bun test` -- expected: all pass, including the two sync guards.
- Multi-file round-trip smoke:
  `bun run midi2scripter.js to-midi src/midi-player.js -o /tmp/p1.mid && bun run midi2scripter.js to-script /tmp/p1.mid /tmp/p1.mid -o /tmp/two.js && bun run /tmp/two.js; echo exit=$?`
  -- expected: each step exit 0; `/tmp/two.js` has two parts and loads.
- `bun run midi2scripter.js --help` -- expected: usage lists multi-file `to-script`, `to-midi --part`; exit 0.

**Manual checks (Scripter only runs inside MainStage/Logic):**
- Load a bundled script; with Play running, send the `Select CC` values / per-part CCs → parts switch on the next bar; send `Restart CC` → current part restarts on beat 1; stop mid-part → no hung notes.

## Auto Run Result

Status: done

**Summary:** Evolved the single-groove player into a multi-part player. The data block between the sentinels is now `var PARTS = [{ name, cc, loopBeats, pattern }]` with a compact 4-tuple `[offset, pitch, velocity, length]` pattern format (~60% terser than the old object-per-line form, still hand-editable). Parts switch live by CC in two UI-configurable modes (a single selector CC whose value picks the 1-based part, or a per-part CC), and a Restart CC restarts the current part — all bar-aligned so they land on the next downbeat (beat 1). The hard beat math stays in pure, bun-tested helpers (`eventsInBlock` generalized with an `originBeat`, plus new `nextBarBoundary` and `planBlock`); `ProcessMIDI`/`HandleMIDI`/`Reset` stay thin Scripter adapters. The converter now bundles multiple `.mid` files into one script (one part per file), emits tuples, reads the tuple/legacy-object/legacy-`PATTERN` forms tolerantly, and gained `to-midi --part`.

**Files changed:**
- `src/midi-player.js` — multi-part engine: `PARTS` data (tuples), generalized `eventsInBlock`, pure `nextBarBoundary`/`planBlock`, module state + bar-aligned pending switch/restart, `reanchor` on (re)play, dynamically-built `PluginParameters` (Block Incoming Notes, Switch Mode, Select CC, Restart CC, per-part CCs), shared `partCcParamName`, expanded exports.
- `src/midi-player.test.js` — origin-signature updates + origin-shift, `nextBarBoundary`, `planBlock`, and `partCcParamName` cases.
- `midi2scripter.js` — `renderPartsBlock`, tolerant `parsePartsFromScript`, multi-`.mid` `to-script` (with name de-dup), `to-midi --part` (name-first select), legacy-aware `update` migration, updated `--help`; `PLAYER_TEMPLATE` + `example-player.js` regenerated via `build`.
- `midi2scripter.test.js` — tuple round-trip, multi-file bundle, legacy single/object tolerance, mixed-body throw, single-quote names, `selectPart`, `to-midi --part`, and legacy-`update` migration; SMF/marker/sync guards kept.
- `example-player.js` — regenerated multi-part example (via `build`, not hand-edited).
- `README.md`, `README.de.md` — multi-part bundling, switch modes/params, Restart CC, `to-midi --part`, tuple format.

**Review findings breakdown:** 8 patches applied (1 high: Per-Part CC mode non-functional + Bank Select hijack; 2 medium: Restart CC value-0 leak, legacy object-form `update` silent no-play; 5 low: `--part` name/index ambiguity, mixed-body silent drop, duplicate part names, single-quote names, empty-`PARTS` crash guard); 1 deferred (meter-change mid-play origin drift → `deferred-work.md`); 4 rejected (see Review Triage Log). No intent gaps and no spec defects — the intent contract held; all findings were localized implementation patches.

**Verification:** `bun test` → 61/61 pass (219 assertions), including the `PLAYER_TEMPLATE` and `example-player.js` sync guards. `bun run midi2scripter.js build` → exit 0; `bun run src/midi-player.js` and `bun run example-player.js` → exit 0. Multi-file round-trip smoke (`to-midi` → `to-script a.mid a.mid` → run) → each step exit 0, output has two parts and loads. `to-midi --part 2` exit 0; `--part <bad>` clear error, exit 1. De-dupe confirmed (`x`, `x-2`). Legacy single-`PATTERN` and object-form `PARTS` `update` both migrate to tuple form and load; modern tuple `update` stays verbatim and loads. `--help` lists multi-file `to-script` and `to-midi --part`, exit 0. In-MainStage manual checks (audible switching on the bar, Restart-on-beat-1, no hung notes on stop, per-part CC assignment via the plugin UI) remain for Michael at the keyboard — Scripter cannot run outside Logic/MainStage.

**Follow-up review recommended:** true — the final pass fixed a high-severity behavioral defect on the CC control surface (a headline feature that was non-functional out of the box) plus two medium data/behavior fixes, across both the engine and the converter. The CC-handling adapter cannot be unit-tested outside Scripter (its globals don't exist under bun), so the highest-severity fix rests on manual verification plus the `partCcParamName` coupling test; the volume (8 patches) and breadth make an independent follow-up worthwhile.

**Residual risks (not defects in the shipped artifact):** the CC-decision logic in `HandleMIDI` runs only inside Scripter and is not bun-tested (by design — the pure beat math is isolated and tested instead); a live meter change without a transport stop leaves the loop origin on the old bar grid until the next stop (deferred); per-part CCs that collide with the Select/Restart CC are shadowed by documented precedence; `to-midi`→`to-script` still recomputes `loopBeats` per the prior converter spec.
