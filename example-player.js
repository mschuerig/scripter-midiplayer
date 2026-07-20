// midi-player.js
// Logic/MainStage Scripter (MIDI FX) — Host-Synced Multi-Part MIDI Player.
//
// Reads the host transport/tempo and plays a looping multi-lane MIDI drum
// pattern locked to the host beat grid. Emits MIDI only (no audio). Every
// note is scheduled in BEATS via sendAtBeat so host tempo changes track
// automatically, and every NoteOn is paired with a NoteOff so nothing hangs.
//
// Several grooves are bundled as switchable PARTS. CCs select the active part
// (by value, by prev/next cycling, or a dedicated CC per part) and a CC
// restarts the current part; every switch takes effect on the next bar's beat
// 1, so it stays musical and locked to the downbeat.
//
// On/off is controlled by the host: Play (and, on the metronome strip, the
// metronome toggle) gates playback. Map the plugin's bypass to a MainStage
// button for manual enable/disable.

var NeedsTimingInfo = true;

// Toolchain version. Single source of truth: midi2scripter.js reads this out of
// the embedded engine, so the converter, the bundled player, and every baked
// script all report the same version. Bump on any engine or converter change.
var VERSION = "1.0.1";

// Flip to true to print switch diagnostics to the Scripter console via Trace()
// — the raw incoming CC stream (number + value) and every switch decision.
// Handy for seeing how a controller's buttons actually send CC (e.g. a toggle
// button sends value 0 on alternate presses, which is swallowed, not a switch).
var TRACE = false;

// ===========================================================================
// ============================  EDIT THIS  ==================================
// ===========================================================================
// Replace PARTS to change the grooves. Each part is:
//   { name, cc, loopBeats, pattern }
//     name      : label shown in the "Part N (name) CC" parameter
//     cc         : default CC number for this part's dedicated select control
//     loopBeats  : loop length in beats (one 4/4 bar == 4)
//     pattern    : array of compact 4-tuples [offset, pitch, velocity, length]
//                    offset   : beat position within the loop (0 == start)
//                    pitch    : MIDI note (drum map: 36 kick, 38 snare, 42 hat)
//                    velocity : 1..127
//                    length   : note duration in beats (offBeat = onBeat + length)
//
// Switch parts live with CCs (see the plugin parameters; all coexist, a CC of 0
// disables that control; switches land on the next bar's beat 1):
//   "Enable CC"         : value >= 64 enables output, < 64 mutes it (immediate;
//                         re-enabling resumes in phase with the bar grid). At 0
//                         the control is off and playback is always on.
//   "Select Part CC"    : value n selects part n (1-based).
//   "Previous/Next Part CC" : cycle to the prev/next part (wraps).
//   "Part N (name) CC"  : a dedicated CC per part selects it directly.
//   "Restart CC"        : restarts the current part on the next downbeat.
// Set TRACE = true (above) to log the incoming CC stream + switch decisions.
//
// To drop in a baked Drummer/MuseScore groove, paste its note tuples here in
// the same [offset, pitch, velocity, length] shape and set loopBeats.
//
// Default: one part "backbeat", a one-bar 4/4 backbeat.
//   kick  (36) on beats 0 and 2
//   snare (38) on beats 1 and 3 (the "2 & 4" backbeat)
//   hat   (42) on every eighth note (0, 0.5, 1, ... 3.5)
// ===========================================================================
// MIDI-PLAYER:PATTERN-START
var PARTS = [
  { name: "backbeat", cc: 0, loopBeats: 4, pattern: [
    // Closed hi-hat on the eighths.
    [0.0, 42, 80, 0.1],
    [0.5, 42, 64, 0.1],
    [1.0, 42, 80, 0.1],
    [1.5, 42, 64, 0.1],
    [2.0, 42, 80, 0.1],
    [2.5, 42, 64, 0.1],
    [3.0, 42, 80, 0.1],
    [3.5, 42, 64, 0.1],
    // Kick on 1 and 3.
    [0.0, 36, 110, 0.1],
    [2.0, 36, 110, 0.1],
    // Snare backbeat on 2 and 4.
    [1.0, 38, 100, 0.1],
    [3.0, 38, 100, 0.1]
  ] }
];
// MIDI-PLAYER:PATTERN-END

// ===========================================================================
// =========================  END EDIT THIS  =================================
// ===========================================================================

// Pure helpers — no Scripter globals, no side effects. This is the one place
// the hard beat math lives, so it is unit-testable under bun/Node while
// ProcessMIDI/HandleMIDI/Reset stay thin adapters.

// eventsInBlock(pattern, loopBeats, originBeat, blockStartBeat, blockEndBeat)
//
// Returns every pattern event whose ABSOLUTE on-beat falls in the half-open
// range [blockStartBeat, blockEndBeat). A part's loop origin is an absolute
// host beat `originBeat`; the absolute beat of a tuple with `offset` in loop
// iteration k is `originBeat + k * loopBeats + offset`.
//
// Each event is a compact 4-tuple [offset, pitch, velocity, length]. Result:
// array of { pitch, velocity, onBeat, offBeat } with offBeat == onBeat +
// length, ordered by ascending absolute onBeat (monotonic across the loop
// boundary).
function eventsInBlock(pattern, loopBeats, originBeat, blockStartBeat, blockEndBeat) {
  var out = [];
  // Guard: a non-positive loop length has no well-defined iteration.
  if (!(loopBeats > 0)) {
    return out;
  }
  // Empty or inverted range yields nothing.
  if (!(blockEndBeat > blockStartBeat)) {
    return out;
  }

  // Work in origin-relative coordinates so the loop grid starts at the part's
  // origin. Scan from the loop containing the block start up to and including
  // the loop containing the block end.
  var relStart = blockStartBeat - originBeat;
  var relEnd = blockEndBeat - originBeat;
  var firstLoop = Math.floor(relStart / loopBeats);
  var lastLoop = Math.floor(relEnd / loopBeats);

  for (var k = firstLoop; k <= lastLoop; k++) {
    var base = k * loopBeats;
    for (var i = 0; i < pattern.length; i++) {
      var ev = pattern[i];
      // Normalize offset into [0, loopBeats) so an out-of-range offset — e.g.
      // pasting a 2-bar groove but leaving loopBeats at 4 — can never silently
      // drop a note. For a well-formed offset in [0, loopBeats) this is identity.
      var offset = ((ev[0] % loopBeats) + loopBeats) % loopBeats;
      var onBeat = originBeat + base + offset;
      if (onBeat >= blockStartBeat && onBeat < blockEndBeat) {
        out.push({
          pitch: ev[1],
          velocity: ev[2],
          onBeat: onBeat,
          offBeat: onBeat + ev[3]
        });
      }
    }
  }

  // Sort by absolute onBeat so results are monotonic even when a single loop
  // iteration lists lanes out of time order (as the default pattern does).
  out.sort(function (a, b) {
    return a.onBeat - b.onBeat;
  });

  return out;
}

// nextBarBoundary(beat, barBeats) -> the smallest whole multiple of barBeats
// STRICTLY greater than `beat`. A CC on a downbeat therefore targets the NEXT
// bar (predictable ≤1-bar latency), never retriggering the current bar.
function nextBarBoundary(beat, barBeats) {
  return (Math.floor(beat / barBeats) + 1) * barBeats;
}

// planBlock(state, parts, barBeats, blockStartBeat, blockEndBeat)
//   state = { activePart, partOrigin, pending }   // pending: null | {part, atBeat}
//   -> { segments: [{ part, origin, segStart, segEnd }], next }
//
// The one place the switch/restart beat math lives. Splits the block at a
// pending switch's bar boundary so the old part plays up to the boundary and
// the new part plays from it. Each segment schedules its own note-offs, so a
// note started just before a switch still completes cleanly.
function planBlock(state, parts, barBeats, blockStartBeat, blockEndBeat) {
  var activePart = state.activePart;
  var partOrigin = state.partOrigin;
  var pending = state.pending;

  // No pending change, or it lands at/after this block's end: one whole-block
  // segment on the active part; carry the pending forward unchanged.
  if (!pending || pending.atBeat >= blockEndBeat) {
    return {
      segments: [
        { part: activePart, origin: partOrigin, segStart: blockStartBeat, segEnd: blockEndBeat }
      ],
      next: { activePart: activePart, partOrigin: partOrigin, pending: pending || null }
    };
  }

  // Pending already reached (its boundary is at or before this block's start):
  // the whole block plays the pending part from its fresh bar-aligned origin.
  if (pending.atBeat <= blockStartBeat) {
    return {
      segments: [
        { part: pending.part, origin: pending.atBeat, segStart: blockStartBeat, segEnd: blockEndBeat }
      ],
      next: { activePart: pending.part, partOrigin: pending.atBeat, pending: null }
    };
  }

  // Boundary falls inside this block: split at pending.atBeat.
  return {
    segments: [
      { part: activePart, origin: partOrigin, segStart: blockStartBeat, segEnd: pending.atBeat },
      { part: pending.part, origin: pending.atBeat, segStart: pending.atBeat, segEnd: blockEndBeat }
    ],
    next: { activePart: pending.part, partOrigin: pending.atBeat, pending: null }
  };
}

// ===========================================================================
// Scripter adapters (thin; all beat math is in the pure helpers above)
// ===========================================================================

// Module state: which part is active, its bar-aligned loop origin, and any
// pending (switch/restart) waiting for the next bar boundary. `reanchor` asks
// ProcessMIDI to re-anchor the origin to the current downbeat on the next block
// (set at load and on Reset).
var STATE = { activePart: 0, partOrigin: 0, pending: null };
var reanchor = true;

// Output gate (the "Enable CC" mute). The part-switch state machine keeps
// running while disabled — only note output is silenced — so the loop stays
// locked to the bar grid and re-enabling resumes exactly in phase (as if it had
// been playing all along), maintaining measure alignment.
var enabled = true;

function barBeatsOf(info) {
  var barBeats = (info.meterNumerator * 4) / info.meterDenominator;
  if (!(barBeats > 0)) {
    barBeats = 4;
  }
  return barBeats;
}

// Per-block callback: schedule the events overlapping this block, honoring any
// pending part switch / restart at its bar boundary.
function ProcessMIDI() {
  var info = GetTimingInfo();
  if (!info.playing) {
    return;
  }

  // A hand-edited empty PARTS has nothing to schedule; bail before indexing.
  if (!PARTS.length) {
    return;
  }

  // The Enable-CC mute only applies while that control is assigned. With it
  // disabled (Enable CC == 0) playback is always on, and any stale mute left
  // over from a previous assignment is cleared.
  if (!(GetParameter("Enable CC") > 0)) {
    enabled = true;
  }

  var barBeats = barBeatsOf(info);

  // Anchor the active part's loop origin to the bar boundary at or below the
  // current block start so the loop begins on a downbeat.
  if (reanchor) {
    STATE.partOrigin = Math.floor(info.blockStartBeat / barBeats) * barBeats;
    reanchor = false;
  }

  // Advance the switch state machine every block, even when muted, so pending
  // switches still resolve on the bar grid and the loop phase keeps counting —
  // this is what lets a re-enable resume in measure alignment.
  var plan = planBlock(STATE, PARTS, barBeats, info.blockStartBeat, info.blockEndBeat);
  if (enabled) {
    for (var s = 0; s < plan.segments.length; s++) {
      var seg = plan.segments[s];
      var part = PARTS[seg.part];
      var evs = eventsInBlock(part.pattern, part.loopBeats, seg.origin, seg.segStart, seg.segEnd);
      for (var i = 0; i < evs.length; i++) {
        var e = evs[i];

        var on = new NoteOn();
        on.pitch = e.pitch;
        on.velocity = e.velocity;
        on.sendAtBeat(e.onBeat);

        var off = new NoteOff();
        off.pitch = e.pitch;
        off.sendAtBeat(e.offBeat);
      }
    }
  }

  STATE = plan.next;
}

// Print a diagnostic line to the Scripter console when TRACE is on. Trace() is
// a Scripter global; guarded so `bun run` (where it is undefined) stays quiet.
function trace(msg) {
  if (TRACE && typeof Trace !== "undefined") {
    Trace(msg);
  }
}

// The exact PluginParameters name for a part's CC control. Shared by the
// parameter builder and the per-part matcher so the two strings never drift.
function partCcParamName(index0, name) {
  return "Part " + (index0 + 1) + " (" + name + ") CC";
}

// Wrap `current` by `delta` steps over `count` parts (Next = +1, Prev = -1),
// so cycling past the last part lands on the first and vice versa. Pure.
function cyclePart(current, delta, count) {
  if (!(count > 0)) {
    return 0;
  }
  return (((current + delta) % count) + count) % count;
}

// Schedule a pending part switch / restart at the next bar boundary. Every
// switch control is independent and live whenever its CC number is > 0 (a CC of
// 0 means "disabled", so Bank Select — CC 0 — is never hijacked). Returns true
// if the CC matched a configured control (and was consumed), false otherwise.
function handleControlCC(event) {
  // Enable / disable the player's output immediately (the metronome-style mute,
  // since a metronome channel strip does not pass MIDI into Scripter). A value
  // >= 64 enables, < 64 disables (the MIDI switch convention; a toggle button's
  // 127/0 maps straight onto on/off). Disabling cuts ringing notes at once;
  // enabling resumes in phase with the bar grid (see `enabled`).
  var enableCc = GetParameter("Enable CC");
  if (enableCc > 0 && event.number === enableCc) {
    var nowEnabled = event.value >= 64;
    if (enabled && !nowEnabled) {
      allNotesOff();
    }
    enabled = nowEnabled;
    trace("Enable CC " + event.number + " v" + event.value + " -> " + (enabled ? "enabled" : "disabled"));
    return true;
  }

  var info = GetTimingInfo();
  var barBeats = barBeatsOf(info);
  var atBeat = nextBarBoundary(info.blockStartBeat, barBeats);
  // A relative move (prev/next) is measured from a queued pending target if one
  // is already waiting for the bar line, else the active part — so repeated
  // presses within a bar accumulate instead of collapsing to a single step.
  var refPart = STATE.pending ? STATE.pending.part : STATE.activePart;

  // Restart the current part on the next downbeat. A matching Restart CC is
  // always consumed — value 0 (e.g. a footswitch's release) is swallowed with
  // no restart, so the release never leaks to the instrument downstream.
  var restartCc = GetParameter("Restart CC");
  if (restartCc > 0 && event.number === restartCc) {
    if (event.value > 0) {
      STATE.pending = { part: STATE.activePart, atBeat: atBeat };
      trace("Restart CC " + event.number + " v" + event.value + " -> restart part " + STATE.activePart + " @beat " + atBeat);
    }
    return true;
  }

  // Select by value: the CC value is the 1-based part number.
  var selectCc = GetParameter("Select Part CC");
  if (selectCc > 0 && event.number === selectCc) {
    var idx = event.value - 1;
    if (idx >= 0 && idx < PARTS.length) {
      STATE.pending = { part: idx, atBeat: atBeat };
      trace("Select Part CC " + event.number + " v" + event.value + " -> part " + idx + " @beat " + atBeat);
    } else {
      trace("Select Part CC " + event.number + " v" + event.value + " -> out of range, ignored");
    }
    return true;
  }

  // Cycle to the previous part (wraps).
  var prevCc = GetParameter("Previous Part CC");
  if (prevCc > 0 && event.number === prevCc) {
    if (event.value > 0 && PARTS.length > 0) {
      var p = cyclePart(refPart, -1, PARTS.length);
      STATE.pending = { part: p, atBeat: atBeat };
      trace("Previous Part CC " + event.number + " v" + event.value + " -> part " + p + " @beat " + atBeat);
    }
    return true;
  }

  // Cycle to the next part (wraps).
  var nextCc = GetParameter("Next Part CC");
  if (nextCc > 0 && event.number === nextCc) {
    if (event.value > 0 && PARTS.length > 0) {
      var n = cyclePart(refPart, 1, PARTS.length);
      STATE.pending = { part: n, atBeat: atBeat };
      trace("Next Part CC " + event.number + " v" + event.value + " -> part " + n + " @beat " + atBeat);
    }
    return true;
  }

  // A dedicated CC per part — live-adjustable via its "Part N (name) CC" UI
  // parameter (default = the baked value) — selects that part directly. A CC of
  // 0 means the part is unassigned, so it is skipped and CC 0 passes through.
  for (var i = 0; i < PARTS.length; i++) {
    var partCc = GetParameter(partCcParamName(i, PARTS[i].name));
    if (partCc > 0 && partCc === event.number) {
      if (event.value > 0) {
        STATE.pending = { part: i, atBeat: atBeat };
        trace("Part CC " + event.number + " v" + event.value + " -> part " + i + " @beat " + atBeat);
      }
      // value 0: swallowed but no switch.
      return true;
    }
  }

  return false;
}

// Per-incoming-event callback. A CC matching a configured switch control
// schedules the switch and is swallowed. With "Block Incoming Notes" on
// (default), incoming Notes (e.g. metronome clicks) are swallowed; everything
// else passes through untouched.
function HandleMIDI(event) {
  if (event instanceof ControlChange) {
    trace("CC in: number=" + event.number + " value=" + event.value);
    if (handleControlCC(event)) {
      return;
    }
  }
  if (GetParameter("Block Incoming Notes") && event instanceof Note) {
    return;
  }
  event.send();
}

// Panic: All Notes Off (CC 123) on all 16 channels so nothing hangs. Shared by
// Reset (transport stop) and the immediate Enable-CC mute.
function allNotesOff() {
  for (var ch = 1; ch <= 16; ch++) {
    var cc = new ControlChange();
    cc.number = 123;
    cc.value = 0;
    cc.channel = ch;
    cc.send();
  }
}

// Called on stop/reset: panic All Notes Off so nothing hangs when the transport
// stops mid-pattern, clear any pending switch, and re-anchor the loop origin on
// the next play. Leaves the Enable-CC mute state untouched.
function Reset() {
  allNotesOff();
  STATE.pending = null;
  reanchor = true;
}

// PluginParameters is assembled at load time. All switch controls are
// independent and coexist — assign whichever a controller can send. A CC of 0
// disables that control. Order: Block Incoming Notes, Enable CC, Restart CC,
// Select Part CC, Previous/Next Part CC, then one "Part N (name) CC" per part.
var PluginParameters = [];
(function buildPluginParameters() {
  function ccParam(name, defaultValue) {
    return {
      name: name,
      type: "lin",
      minValue: 0,
      maxValue: 127,
      numberOfSteps: 127,
      defaultValue: defaultValue
    };
  }
  PluginParameters.push({ name: "Block Incoming Notes", type: "checkbox", defaultValue: 1 });
  PluginParameters.push(ccParam("Enable CC", 24));
  PluginParameters.push(ccParam("Restart CC", 21));
  PluginParameters.push(ccParam("Select Part CC", 20));
  PluginParameters.push(ccParam("Previous Part CC", 22));
  PluginParameters.push(ccParam("Next Part CC", 23));
  for (var i = 0; i < PARTS.length; i++) {
    PluginParameters.push(ccParam(partCcParamName(i, PARTS[i].name), PARTS[i].cc));
  }
})();

// Node-guarded export so bun/Node tests can require the pure helpers. Scripter
// has no `module`, so this branch never runs inside Logic/MainStage.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    eventsInBlock: eventsInBlock,
    nextBarBoundary: nextBarBoundary,
    planBlock: planBlock,
    partCcParamName: partCcParamName,
    cyclePart: cyclePart
  };
}
