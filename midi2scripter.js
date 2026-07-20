#!/usr/bin/env bun
// midi2scripter.js
// MIDI <-> Player-Script Converter (dependency-free, single-file bun CLI).
//
// Self-contained: the player is embedded as PLAYER_TEMPLATE (generated from
// src/midi-player.js), so this one file installs and runs with no sibling file.
//
// Operations, all reducible to one primitive — rewrite the region between
// `// MIDI-PLAYER:PATTERN-START` and `// MIDI-PLAYER:PATTERN-END` in a script:
//
//   to-script <in.mid>...: bake one or more SMF grooves into a fresh copy of the
//                          player, one switchable PART per file.
//   update <script.js>  : refresh a script's player engine from the bundled
//                         player, keeping the script's own PARTS.
//   to-midi <script.js> : turn one of a script's PARTS back into a .mid file
//                         (choose it with --part).
//   build               : regenerate PLAYER_TEMPLATE + example-player.js from
//                         src/midi-player.js.
//
// The core functions (parseSmf, notesToPattern, renderPartsBlock,
// replacePatternBlock, parsePartsFromScript, patternToSmf) are pure and
// side-effect free; only the CLI wrapper touches the filesystem / argv. The
// SMF reader/writer is hand-rolled -- no npm packages, no package.json.

// ===========================================================================
// Markers
// ===========================================================================

var MARKER_START = "// MIDI-PLAYER:PATTERN-START";
var MARKER_END = "// MIDI-PLAYER:PATTERN-END";

// ===========================================================================
// Bundled player
// ===========================================================================
//
// PLAYER_TEMPLATE is the full src/midi-player.js source, embedded so this file
// is a single, self-contained install (no sibling file needed at runtime). It
// is GENERATED from src/midi-player.js by `bun run midi2scripter.js build`, and
// a test asserts the two stay in sync. Do not hand-edit the literal below —
// edit src/midi-player.js and rebuild.
//
// >>> PLAYER_TEMPLATE-START
var PLAYER_TEMPLATE = `// midi-player.js
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
// host beat \`originBeat\`; the absolute beat of a tuple with \`offset\` in loop
// iteration k is \`originBeat + k * loopBeats + offset\`.
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
// STRICTLY greater than \`beat\`. A CC on a downbeat therefore targets the NEXT
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
// pending (switch/restart) waiting for the next bar boundary. \`reanchor\` asks
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
// a Scripter global; guarded so \`bun run\` (where it is undefined) stays quiet.
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

// Wrap \`current\` by \`delta\` steps over \`count\` parts (Next = +1, Prev = -1),
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
  // enabling resumes in phase with the bar grid (see \`enabled\`).
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
// has no \`module\`, so this branch never runs inside Logic/MainStage.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    eventsInBlock: eventsInBlock,
    nextBarBoundary: nextBarBoundary,
    planBlock: planBlock,
    partCcParamName: partCcParamName,
    cyclePart: cyclePart
  };
}
`;
// <<< PLAYER_TEMPLATE-END

// Toolchain version — read out of the embedded engine so the converter, the
// bundled player, and every baked script always report the same number. The
// single source of truth is `var VERSION` in src/midi-player.js.
var VERSION = (function () {
  var m = /var VERSION = "([^"]+)"/.exec(PLAYER_TEMPLATE);
  return m ? m[1] : "unknown";
})();

// ===========================================================================
// Numeric formatting helpers
// ===========================================================================

// Kill float noise from tick/ppq divisions.
function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

// Beat values (offset/length) always carry a decimal point: 0 -> "0.0".
function formatBeat(n) {
  var r = round6(n);
  if (Number.isInteger(r)) {
    return r.toFixed(1);
  }
  return String(r);
}

// LOOP_BEATS is an integer when whole, otherwise a plain decimal.
function formatLoop(n) {
  return String(round6(n));
}

// ===========================================================================
// SMF (Standard MIDI File) reader
// ===========================================================================

// parseSmf(bytes: Uint8Array) ->
//   { ppq, timeSigNum, timeSigDen, tempoBpm,
//     notes: [{ pitch, velocity, startTick, endTick, channel }] }
//
// Merges all tracks onto one absolute-tick timeline. Handles variable-length
// delta times, running status, note-on velocity 0 == note-off, and the meta
// events set-tempo (0x51), time-signature (0x58) and end-of-track (0x2F).
// Other meta events and sysex are skipped by their declared length. SMPTE
// division is rejected.
function parseSmf(bytes) {
  if (!bytes || bytes.length < 14) {
    throw new Error("parseSmf: file too small to be a MIDI file");
  }
  var pos = 0;

  function u8() {
    return bytes[pos++];
  }
  function u16() {
    var v = (bytes[pos] << 8) | bytes[pos + 1];
    pos += 2;
    return v;
  }
  function u32() {
    var v =
      (bytes[pos] << 24) |
      (bytes[pos + 1] << 16) |
      (bytes[pos + 2] << 8) |
      bytes[pos + 3];
    pos += 4;
    return v >>> 0;
  }
  function readVarLen() {
    var value = 0;
    var b;
    do {
      b = bytes[pos++];
      value = (value << 7) | (b & 0x7f);
    } while (b & 0x80);
    return value >>> 0;
  }
  function fourcc(at) {
    return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  }

  if (fourcc(0) !== "MThd") {
    throw new Error("parseSmf: not a MIDI file (missing MThd header)");
  }
  pos = 4;
  var headerLen = u32();
  /* format */ u16();
  var ntrks = u16();
  var division = u16();
  // Skip any trailing header bytes beyond the standard 6.
  pos = 8 + headerLen;

  if (division & 0x8000) {
    throw new Error("parseSmf: SMPTE division is not supported (PPQ division required)");
  }
  var ppq = division;
  if (!(ppq > 0)) {
    throw new Error("parseSmf: invalid PPQ division (0)");
  }

  var tempoBpm = 120;
  var timeSigNum = 4;
  var timeSigDen = 4;
  var notes = [];

  for (var t = 0; t < ntrks; t++) {
    // Locate the next MTrk chunk (skip anything unexpected between chunks).
    while (pos + 8 <= bytes.length && fourcc(pos) !== "MTrk") {
      pos += 4;
      var skipLen = u32();
      pos += skipLen;
    }
    if (pos + 8 > bytes.length) {
      break;
    }
    pos += 4; // "MTrk"
    var trackLen = u32();
    var trackEnd = pos + trackLen;

    var absTick = 0;
    var runningStatus = 0;
    // Per channel+pitch stack of open note-ons: key -> [{ startTick, velocity }]
    var open = {};

    function closeNote(channel, pitch, tick) {
      var key = channel * 128 + pitch;
      var stack = open[key];
      if (stack && stack.length > 0) {
        // FIFO: the oldest open note-on of this channel+pitch is closed first,
        // the conventional reading for overlapping same-pitch notes.
        var onEv = stack.shift();
        notes.push({
          pitch: pitch,
          velocity: onEv.velocity,
          startTick: onEv.startTick,
          endTick: tick,
          channel: channel
        });
      }
    }

    while (pos < trackEnd) {
      var delta = readVarLen();
      absTick += delta;

      var status;
      var b = bytes[pos];
      if (b & 0x80) {
        status = b;
        pos++;
      } else {
        status = runningStatus;
      }

      if (status === 0xff) {
        // Meta event.
        var metaType = u8();
        var metaLen = readVarLen();
        if (metaType === 0x51 && metaLen === 3) {
          var us = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2];
          if (us > 0) {
            tempoBpm = 60000000 / us;
          }
        } else if (metaType === 0x58 && metaLen >= 2) {
          timeSigNum = bytes[pos];
          timeSigDen = Math.pow(2, bytes[pos + 1]);
        }
        // 0x2F end-of-track and everything else: skip payload.
        pos += metaLen;
        runningStatus = 0; // meta cancels running status
        if (metaType === 0x2f) {
          break;
        }
      } else if (status === 0xf0 || status === 0xf7) {
        // Sysex: skip by declared length.
        var sysLen = readVarLen();
        pos += sysLen;
        runningStatus = 0;
      } else {
        // Channel voice/mode message.
        runningStatus = status;
        var type = status & 0xf0;
        var channel = status & 0x0f;
        if (type === 0x90) {
          var pOn = bytes[pos++];
          var vOn = bytes[pos++];
          if (vOn === 0) {
            closeNote(channel, pOn, absTick);
          } else {
            var key = channel * 128 + pOn;
            if (!open[key]) {
              open[key] = [];
            }
            open[key].push({ startTick: absTick, velocity: vOn });
          }
        } else if (type === 0x80) {
          var pOff = bytes[pos++];
          pos++; // release velocity, unused
          closeNote(channel, pOff, absTick);
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
          pos += 2; // two data bytes
        } else if (type === 0xc0 || type === 0xd0) {
          pos += 1; // one data byte
        } else {
          // Unknown status with no length info: bail out of this track.
          pos = trackEnd;
        }
      }
    }

    // Close any dangling note-ons deterministically at the track end tick.
    for (var k in open) {
      if (Object.prototype.hasOwnProperty.call(open, k)) {
        var stk = open[k];
        var ch = Math.floor(Number(k) / 128);
        var pit = Number(k) % 128;
        while (stk.length > 0) {
          var ev = stk.shift();
          notes.push({
            pitch: pit,
            velocity: ev.velocity,
            startTick: ev.startTick,
            endTick: absTick,
            channel: ch
          });
        }
      }
    }

    pos = trackEnd;
  }

  return {
    ppq: ppq,
    timeSigNum: timeSigNum,
    timeSigDen: timeSigDen,
    tempoBpm: tempoBpm,
    notes: notes
  };
}

// ===========================================================================
// notes -> PATTERN
// ===========================================================================

// notesToPattern(parsed, opts) -> { pattern, loopBeats }
//   beat = tick / ppq
//   offset normalized into [0, loopBeats)
//   length = (endTick - startTick) / ppq
//   loopBeats = opts.loopBeats, else max end-beat rounded UP to a whole bar
//   (beatsPerBar = timeSigNum * 4 / timeSigDen, default 4/4 -> 4, min 1 bar)
//   beats rounded to 1e-6; pattern sorted by offset.
function notesToPattern(parsed, opts) {
  opts = opts || {};
  var notes = parsed.notes;
  if (!notes || notes.length === 0) {
    throw new Error("notesToPattern: no note events found in MIDI file");
  }
  var ppq = parsed.ppq;

  var beatsPerBar = (parsed.timeSigNum * 4) / parsed.timeSigDen;
  if (!(beatsPerBar > 0)) {
    beatsPerBar = 4;
  }

  var loopBeats;
  if (opts.loopBeats != null && !isNaN(opts.loopBeats)) {
    loopBeats = opts.loopBeats;
  } else {
    var maxEndBeat = 0;
    for (var i = 0; i < notes.length; i++) {
      var eb = notes[i].endTick / ppq;
      if (eb > maxEndBeat) {
        maxEndBeat = eb;
      }
    }
    var bars = Math.ceil(round6(maxEndBeat / beatsPerBar));
    if (bars < 1) {
      bars = 1;
    }
    loopBeats = bars * beatsPerBar;
  }
  loopBeats = round6(loopBeats);
  if (!(loopBeats > 0)) {
    throw new Error("notesToPattern: loopBeats must be positive");
  }

  var pattern = notes.map(function (n) {
    var startBeat = n.startTick / ppq;
    var offset = ((startBeat % loopBeats) + loopBeats) % loopBeats;
    var length = (n.endTick - n.startTick) / ppq;
    return {
      offset: round6(offset),
      pitch: n.pitch,
      velocity: n.velocity,
      length: round6(length)
    };
  });

  pattern.sort(function (a, b) {
    return a.offset - b.offset;
  });

  return { pattern: pattern, loopBeats: loopBeats };
}

// ===========================================================================
// PATTERN -> player-style JS text
// ===========================================================================

// renderPatternBlock(pattern, loopBeats) -> string in the player's exact style:
//   2-space indent, one object per line, key order offset/pitch/velocity/length,
//   decimals for offset/length, integers for pitch/velocity, no trailing comma
//   on the last element, then a blank line, then `var LOOP_BEATS = N;`.
function renderPatternBlock(pattern, loopBeats) {
  var lines = pattern.map(function (ev, i) {
    var comma = i === pattern.length - 1 ? "" : ",";
    return (
      "  { offset: " +
      formatBeat(ev.offset) +
      ", pitch: " +
      ev.pitch +
      ", velocity: " +
      ev.velocity +
      ", length: " +
      formatBeat(ev.length) +
      " }" +
      comma
    );
  });
  return (
    "var PATTERN = [\n" +
    lines.join("\n") +
    "\n];\n\nvar LOOP_BEATS = " +
    formatLoop(loopBeats) +
    ";"
  );
}

// renderPartsBlock(parts) -> string in the multi-part player's exact style:
//   `var PARTS = [` then one `{ name, cc, loopBeats, pattern }` per part, each
//   pattern a list of compact `[offset, pitch, velocity, length]` tuples at
//   4-space indent (offset/length via formatBeat, integer pitch/velocity), no
//   trailing comma on the last tuple or the last part.
//
// Each part is { name (string), cc (int), loopBeats (number), pattern (array of
// 4-tuples) }.
function renderPartsBlock(parts) {
  var partBlocks = parts.map(function (part, pi) {
    var tupleLines = part.pattern.map(function (ev, i) {
      var comma = i === part.pattern.length - 1 ? "" : ",";
      return (
        "    [" +
        formatBeat(ev[0]) +
        ", " +
        ev[1] +
        ", " +
        ev[2] +
        ", " +
        formatBeat(ev[3]) +
        "]" +
        comma
      );
    });
    var partComma = pi === parts.length - 1 ? "" : ",";
    return (
      "  { name: " +
      JSON.stringify(part.name) +
      ", cc: " +
      part.cc +
      ", loopBeats: " +
      formatLoop(part.loopBeats) +
      ", pattern: [\n" +
      tupleLines.join("\n") +
      "\n  ] }" +
      partComma
    );
  });
  return "var PARTS = [\n" + partBlocks.join("\n") + "\n];";
}

// sanitizePartName(filePath) -> a part name from a file path: strip the
// directory and a trailing .mid/.midi extension, keep [A-Za-z0-9 _-], collapse
// other runs to a single space, trim. Falls back to "part" if nothing remains.
function sanitizePartName(filePath) {
  var base = String(filePath).replace(/\\/g, "/").split("/").pop();
  base = base.replace(/\.midi?$/i, "");
  base = base.replace(/[^A-Za-z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim();
  return base.length > 0 ? base : "part";
}

// ===========================================================================
// Marker-anchored block replacement
// ===========================================================================

function findMarkers(scriptText) {
  var lines = scriptText.split("\n");
  var starts = [];
  var ends = [];
  for (var i = 0; i < lines.length; i++) {
    var trimmed = lines[i].trim();
    if (trimmed === MARKER_START) {
      starts.push(i);
    }
    if (trimmed === MARKER_END) {
      ends.push(i);
    }
  }
  if (starts.length === 0) {
    throw new Error("marker not found: " + MARKER_START);
  }
  if (starts.length > 1) {
    throw new Error("marker appears more than once: " + MARKER_START);
  }
  if (ends.length === 0) {
    throw new Error("marker not found: " + MARKER_END);
  }
  if (ends.length > 1) {
    throw new Error("marker appears more than once: " + MARKER_END);
  }
  if (ends[0] < starts[0]) {
    throw new Error("markers out of order: " + MARKER_END + " precedes " + MARKER_START);
  }
  return { lines: lines, start: starts[0], end: ends[0] };
}

// replacePatternBlock(scriptText, blockText) -> scriptText with everything
// strictly between the two marker lines replaced by blockText. Throws if either
// marker is missing or duplicated.
function replacePatternBlock(scriptText, blockText) {
  var m = findMarkers(scriptText);
  var before = m.lines.slice(0, m.start + 1); // up to & including START marker
  var after = m.lines.slice(m.end); // from END marker onward
  var blockLines = blockText.split("\n");
  return before.concat(blockLines, after).join("\n");
}

// extractPatternBlock(scriptText) -> the raw text strictly between the two
// markers (verbatim: comments and formatting preserved). Throws if the markers
// are missing or duplicated. Used by `update` to carry an existing script's
// pattern across onto a fresh engine template.
function extractPatternBlock(scriptText) {
  var m = findMarkers(scriptText);
  return m.lines.slice(m.start + 1, m.end).join("\n");
}

// ===========================================================================
// script -> PATTERN (restricted numeric parse; never eval/Function)
// ===========================================================================

// parsePatternFromScript(scriptText) -> { pattern, loopBeats }
// Parses ONLY the text between the markers, with number regexes.
function parsePatternFromScript(scriptText) {
  var m = findMarkers(scriptText);
  var region = m.lines.slice(m.start + 1, m.end).join("\n");
  // Strip comments first so braces inside a comment don't trip the validator.
  var code = region.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  var num = "(-?[0-9]*\\.?[0-9]+)";
  var objBody =
    "offset\\s*:\\s*" + num +
    "\\s*,\\s*pitch\\s*:\\s*" + num +
    "\\s*,\\s*velocity\\s*:\\s*" + num +
    "\\s*,\\s*length\\s*:\\s*" + num;
  var objRe = new RegExp("\\{\\s*" + objBody + "\\s*\\}", "g");

  // Every brace-group in the region must be a well-formed event. Otherwise a
  // reordered key or an extra field would be silently skipped and its note
  // lost; fail loudly instead (the spec requires throwing on malformed input).
  var strictObj = new RegExp("^\\{\\s*" + objBody + "\\s*\\}$");
  var candRe = /\{[^{}]*\}/g;
  var cand;
  while ((cand = candRe.exec(code)) !== null) {
    if (!strictObj.test(cand[0].trim())) {
      throw new Error("parsePatternFromScript: malformed PATTERN event: " + cand[0].trim());
    }
  }

  var pattern = [];
  var match;
  while ((match = objRe.exec(code)) !== null) {
    pattern.push({
      offset: parseFloat(match[1]),
      pitch: parseInt(match[2], 10),
      velocity: parseInt(match[3], 10),
      length: parseFloat(match[4])
    });
  }

  if (pattern.length === 0) {
    throw new Error("parsePatternFromScript: no PATTERN events found between markers");
  }

  var loopMatch = /var\s+LOOP_BEATS\s*=\s*(-?[0-9]*\.?[0-9]+)\s*;/.exec(code);
  if (!loopMatch) {
    throw new Error("parsePatternFromScript: LOOP_BEATS not found between markers");
  }
  var loopBeats = parseFloat(loopMatch[1]);
  if (!(loopBeats > 0)) {
    throw new Error("parsePatternFromScript: LOOP_BEATS must be positive");
  }

  return { pattern: pattern, loopBeats: loopBeats };
}

// ===========================================================================
// script -> PARTS (tolerant read; never eval/Function)
// ===========================================================================

var NUM = "(-?[0-9]*\\.?[0-9]+)";

// Scan from the `[`/`{` at openIdx to its matching close bracket/brace of the
// same kind, tracking nesting so a pattern's inner tuples/objects don't fool
// the match. Returns the index of the closing character.
function matchDelim(code, openIdx, open, close) {
  var depth = 0;
  for (var i = openIdx; i < code.length; i++) {
    var c = code[i];
    if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error("parsePartsFromScript: unbalanced '" + open + close + "' in region");
}

// Parse a pattern body (the text inside `pattern: [ ... ]`) into an array of
// [offset, pitch, velocity, length] tuples. Accepts compact tuples or the
// legacy `{ offset, pitch, velocity, length }` objects; throws on a malformed
// event (reordered key / extra field) instead of silently dropping a note.
function parsePatternBody(body) {
  var pattern = [];
  var match;

  if (/\{/.test(body)) {
    // Legacy object events. A body mixing object and tuple forms would parse
    // only the objects and silently drop the tuples — fail loudly instead.
    if (/\[\s*-?[0-9]/.test(body)) {
      throw new Error("parsePartsFromScript: mixed tuple and object pattern events");
    }
    var objBody =
      "offset\\s*:\\s*" + NUM +
      "\\s*,\\s*pitch\\s*:\\s*" + NUM +
      "\\s*,\\s*velocity\\s*:\\s*" + NUM +
      "\\s*,\\s*length\\s*:\\s*" + NUM;
    var strictObj = new RegExp("^\\{\\s*" + objBody + "\\s*\\}$");
    var objCandRe = /\{[^{}]*\}/g;
    var objCand;
    while ((objCand = objCandRe.exec(body)) !== null) {
      if (!strictObj.test(objCand[0].trim())) {
        throw new Error("parsePartsFromScript: malformed pattern event: " + objCand[0].trim());
      }
    }
    var objRe = new RegExp("\\{\\s*" + objBody + "\\s*\\}", "g");
    while ((match = objRe.exec(body)) !== null) {
      pattern.push([parseFloat(match[1]), parseInt(match[2], 10), parseInt(match[3], 10), parseFloat(match[4])]);
    }
  } else {
    // Compact tuple events.
    var tupleBody = NUM + "\\s*,\\s*" + NUM + "\\s*,\\s*" + NUM + "\\s*,\\s*" + NUM;
    var strictTuple = new RegExp("^\\[\\s*" + tupleBody + "\\s*\\]$");
    var tupCandRe = /\[[^\[\]]*\]/g;
    var tupCand;
    while ((tupCand = tupCandRe.exec(body)) !== null) {
      if (!strictTuple.test(tupCand[0].trim())) {
        throw new Error("parsePartsFromScript: malformed pattern tuple: " + tupCand[0].trim());
      }
    }
    var tupRe = new RegExp("\\[\\s*" + tupleBody + "\\s*\\]", "g");
    while ((match = tupRe.exec(body)) !== null) {
      pattern.push([parseFloat(match[1]), parseInt(match[2], 10), parseInt(match[3], 10), parseFloat(match[4])]);
    }
  }

  if (pattern.length === 0) {
    throw new Error("parsePartsFromScript: no pattern events found");
  }
  return pattern;
}

// parsePartsFromScript(scriptText) -> { parts: [{ name, cc, loopBeats, pattern }] }
//
// Parses ONLY the text between the markers, tolerating three shapes, in order:
//   1. new tuple  `var PARTS = [ { name, cc, loopBeats, pattern: [[..],..] } ]`
//   2. legacy obj `var PARTS = [ { ..., pattern: [ { offset, ... }, .. ] } ]`
//   3. legacy single `var PATTERN` / `var LOOP_BEATS` (read as one part)
// Number-regex only (never eval); throws on a malformed event as today.
function parsePartsFromScript(scriptText) {
  var m = findMarkers(scriptText);
  var region = m.lines.slice(m.start + 1, m.end).join("\n");
  // Strip comments first so braces/brackets inside a comment don't trip parsing.
  var code = region.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  var parts = [];

  var partsOpen = /var\s+PARTS\s*=\s*\[/.exec(code);
  if (partsOpen) {
    // Multi-part form. Each part header carries name/cc/loopBeats and opens a
    // `pattern: [ ... ]` whose matching `]` bounds the pattern body.
    var headerRe = new RegExp(
      "name\\s*:\\s*[\"']([^\"']*)[\"']\\s*,\\s*cc\\s*:\\s*" + NUM +
      "\\s*,\\s*loopBeats\\s*:\\s*" + NUM +
      "\\s*,\\s*pattern\\s*:\\s*\\[",
      "g"
    );
    var h;
    while ((h = headerRe.exec(code)) !== null) {
      var name = h[1];
      var cc = parseInt(h[2], 10);
      var loopBeats = parseFloat(h[3]);
      if (!(loopBeats > 0)) {
        throw new Error("parsePartsFromScript: loopBeats must be positive (got " + h[3] + ")");
      }
      var openIdx = headerRe.lastIndex - 1; // the '[' just consumed
      var closeIdx = matchDelim(code, openIdx, "[", "]");
      var body = code.slice(openIdx + 1, closeIdx);
      parts.push({ name: name, cc: cc, loopBeats: loopBeats, pattern: parsePatternBody(body) });
      headerRe.lastIndex = closeIdx + 1; // resume after the pattern's ']'
    }
    if (parts.length === 0) {
      throw new Error("parsePartsFromScript: no parts found between markers");
    }
    return { parts: parts };
  }

  // Legacy single-part: var PATTERN = [ ... ]; var LOOP_BEATS = N;
  var patOpen = /var\s+PATTERN\s*=\s*\[/.exec(code);
  if (!patOpen) {
    throw new Error("parsePartsFromScript: no PARTS or PATTERN found between markers");
  }
  var patIdx = patOpen.index + patOpen[0].length - 1; // the '['
  var patClose = matchDelim(code, patIdx, "[", "]");
  var patBody = code.slice(patIdx + 1, patClose);
  var legacyPattern = parsePatternBody(patBody);
  var loopMatch = /var\s+LOOP_BEATS\s*=\s*(-?[0-9]*\.?[0-9]+)\s*;/.exec(code);
  if (!loopMatch) {
    throw new Error("parsePartsFromScript: LOOP_BEATS not found between markers");
  }
  var legacyLoop = parseFloat(loopMatch[1]);
  if (!(legacyLoop > 0)) {
    throw new Error("parsePartsFromScript: LOOP_BEATS must be positive");
  }
  parts.push({ name: "part1", cc: 0, loopBeats: legacyLoop, pattern: legacyPattern });
  return { parts: parts };
}

// selectPart(parts, spec) -> the chosen part. `spec` is a name (exact match)
// or a 1-based index; undefined/empty picks part 1. Throws a clear error if the
// named/indexed part is not found.
function selectPart(parts, spec) {
  if (spec == null || spec === "") {
    return parts[0];
  }
  // An exact name match wins, so a part literally named "2" stays reachable
  // even though a bare integer otherwise means a 1-based index.
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].name === String(spec)) {
      return parts[i];
    }
  }
  // A pure integer string selects by 1-based index.
  if (/^[0-9]+$/.test(String(spec))) {
    var idx = parseInt(spec, 10) - 1;
    if (idx < 0 || idx >= parts.length) {
      throw new Error("to-midi: --part index out of range: " + spec + " (have " + parts.length + " part(s))");
    }
    return parts[idx];
  }
  throw new Error("to-midi: no part named '" + spec + "'");
}

// Output filename for a part in `to-midi`. `base` is the -o value (or the script
// path) with its .mid/.js extension already stripped. A single-part export
// writes `<base>.mid`; a multi-part export namespaces each part as
// `<base>.<partName>.mid` so the files don't collide.
function midiOutName(base, partName, multi) {
  return multi ? base + "." + partName + ".mid" : base + ".mid";
}

// ===========================================================================
// PATTERN -> SMF writer
// ===========================================================================

function writeVarLen(arr, value) {
  value = value >>> 0;
  var stack = [value & 0x7f];
  value = Math.floor(value / 128);
  while (value > 0) {
    stack.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  for (var i = stack.length - 1; i >= 0; i--) {
    arr.push(stack[i]);
  }
}

// patternToSmf(pattern, loopBeats, opts) -> Uint8Array
//   SMF format 0, one MTrk, ppq default 480, tempoBpm default 120, loops
//   default 1. Emits absolute-tick note-on/off, stable-sorted (note-offs before
//   note-ons at equal tick), delta-encoded, with a leading set-tempo meta and a
//   trailing end-of-track.
function patternToSmf(pattern, loopBeats, opts) {
  opts = opts || {};
  if (!pattern || pattern.length === 0) {
    throw new Error("patternToSmf: pattern is empty");
  }
  var ppq = opts.ppq != null && !isNaN(opts.ppq) ? opts.ppq : 480;
  var tempoBpm = opts.tempoBpm != null && !isNaN(opts.tempoBpm) ? opts.tempoBpm : 120;
  var loops = opts.loops != null && !isNaN(opts.loops) ? opts.loops : 1;
  if (!(ppq > 0 && ppq <= 32767)) {
    throw new Error("patternToSmf: ppq must be an integer in 1..32767 (PPQ division range)");
  }
  if (!(tempoBpm > 0)) {
    throw new Error("patternToSmf: tempoBpm must be positive");
  }
  if (!(loops >= 1)) {
    throw new Error("patternToSmf: loops must be >= 1");
  }
  if (!(loopBeats > 0)) {
    throw new Error("patternToSmf: loopBeats must be positive");
  }

  // Validate note values so a hand-edited script yields a clear error instead
  // of a silently corrupt MIDI file (negative offsets encode as huge deltas;
  // out-of-range pitch/velocity would be masked to a wrong note).
  for (var vi = 0; vi < pattern.length; vi++) {
    var pv = pattern[vi];
    if (!(pv.offset >= 0)) {
      throw new Error("patternToSmf: offset must be >= 0 (got " + pv.offset + ")");
    }
    if (!(pv.length >= 0)) {
      throw new Error("patternToSmf: length must be >= 0 (got " + pv.length + ")");
    }
    if (!(Number.isInteger(pv.pitch) && pv.pitch >= 0 && pv.pitch <= 127)) {
      throw new Error("patternToSmf: pitch must be an integer 0..127 (got " + pv.pitch + ")");
    }
    if (!(Number.isInteger(pv.velocity) && pv.velocity >= 1 && pv.velocity <= 127)) {
      throw new Error("patternToSmf: velocity must be an integer 1..127 (got " + pv.velocity + ")");
    }
  }

  // order 0 = note-off (must sort before note-on at same tick), 1 = note-on.
  var events = [];
  for (var loop = 0; loop < loops; loop++) {
    var base = loop * loopBeats;
    for (var i = 0; i < pattern.length; i++) {
      var ev = pattern[i];
      var onTick = Math.round((base + ev.offset) * ppq);
      var offTick = Math.round((base + ev.offset + ev.length) * ppq);
      // A zero-length note must still emit its note-off strictly after the
      // note-on, or the off would sort first and leave the note hanging.
      if (offTick <= onTick) {
        offTick = onTick + 1;
      }
      events.push({ tick: onTick, order: 1, pitch: ev.pitch, velocity: ev.velocity, isOn: true });
      events.push({ tick: offTick, order: 0, pitch: ev.pitch, velocity: 0, isOn: false });
    }
  }

  // Stable sort by tick, then off-before-on at equal ticks. Array.sort is
  // stable in bun/modern engines, preserving emission order for further ties.
  events.sort(function (a, b) {
    if (a.tick !== b.tick) {
      return a.tick - b.tick;
    }
    return a.order - b.order;
  });

  var track = [];
  // Leading set-tempo meta at tick 0.
  var us = Math.round(60000000 / tempoBpm);
  if (us > 0xffffff) {
    throw new Error("patternToSmf: tempoBpm too low for the 3-byte tempo field (use >= 3.6 BPM)");
  }
  writeVarLen(track, 0);
  track.push(0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff);

  var prevTick = 0;
  for (var e = 0; e < events.length; e++) {
    var evt = events[e];
    var delta = evt.tick - prevTick;
    prevTick = evt.tick;
    writeVarLen(track, delta);
    if (evt.isOn) {
      track.push(0x90, evt.pitch & 0x7f, evt.velocity & 0x7f);
    } else {
      track.push(0x80, evt.pitch & 0x7f, 0x00);
    }
  }

  // End-of-track meta.
  writeVarLen(track, 0);
  track.push(0xff, 0x2f, 0x00);

  var out = [];
  function pushStr(s) {
    for (var j = 0; j < s.length; j++) {
      out.push(s.charCodeAt(j));
    }
  }
  function pushU32(v) {
    out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  function pushU16(v) {
    out.push((v >> 8) & 0xff, v & 0xff);
  }

  pushStr("MThd");
  pushU32(6);
  pushU16(0); // format 0
  pushU16(1); // one track
  pushU16(ppq);
  pushStr("MTrk");
  pushU32(track.length);
  for (var b = 0; b < track.length; b++) {
    out.push(track[b]);
  }

  return new Uint8Array(out);
}

// ===========================================================================
// CLI wrapper (file I/O + argv). Not run when the module is required.
// ===========================================================================

// Maintenance: regenerate build artifacts from the engine source
// (src/midi-player.js) so everything derived from it stays in sync:
//   - the embedded PLAYER_TEMPLATE literal in this file (the single-file bundle)
//   - example-player.js, the paste-ready example shipped for users
// Tests guard both.
function buildBundle() {
  var fs = require("fs");
  var path = require("path");
  var selfPath = path.join(__dirname, "midi2scripter.js");
  var playerText = fs.readFileSync(path.join(__dirname, "src", "midi-player.js"), "utf8");
  var esc = playerText.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  var literal = "var PLAYER_TEMPLATE = `" + esc + "`;";
  var lines = fs.readFileSync(selfPath, "utf8").split("\n");
  var s = lines.indexOf("// >>> PLAYER_TEMPLATE-START");
  var e = lines.indexOf("// <<< PLAYER_TEMPLATE-END");
  if (s < 0 || e < 0 || e < s) {
    throw new Error("build: PLAYER_TEMPLATE markers not found in " + selfPath);
  }
  var out = lines.slice(0, s + 1).concat([literal], lines.slice(e)).join("\n");
  fs.writeFileSync(selfPath, out);
  fs.writeFileSync(path.join(__dirname, "example-player.js"), playerText);
  process.stderr.write("rebuilt PLAYER_TEMPLATE and example-player.js from src/midi-player.js\n");
}

function printHelp() {
  var text =
    "midi2scripter " + VERSION + " -- MIDI <-> player-script converter (bun, single-file)\n" +
    "\n" +
    "Usage:\n" +
    "  bun run midi2scripter.js to-script <in.mid> [more.mid ...] [-o out.js] [--loop-beats N] [--template path]\n" +
    "  bun run midi2scripter.js update <script.js> [--template path] [-o out.js]\n" +
    "  bun run midi2scripter.js to-midi <script.js> [--part <name|index>] [-o out.mid] [--tempo BPM] [--ppq N] [--loops N]\n" +
    "  bun run midi2scripter.js build\n" +
    "  bun run midi2scripter.js --version | --help\n" +
    "\n" +
    "Commands:\n" +
    "  to-script  Bake one or more MIDI grooves into a fresh player script — one\n" +
    "             switchable PART per .mid file (part name = sanitized basename).\n" +
    "             Uses the bundled player unless --template is given. Writes\n" +
    "             stdout unless -o. --loop-beats overrides every part's loop.\n" +
    "  update     Refresh a script's player engine from the bundled player (or\n" +
    "             --template), keeping the script's own PARTS. In place unless -o.\n" +
    "  to-midi    Convert a script's PARTS back to Standard MIDI Files. Without\n" +
    "             --part, exports EVERY part, one .mid each, named\n" +
    "             <base>.<part>.mid; --part <name|1-based index> exports just one\n" +
    "             to <base>.mid. Defaults: --tempo 120 --ppq 480 --loops 1.\n" +
    "  build      Maintainers only: regenerate PLAYER_TEMPLATE + example-player.js\n" +
    "             from src/midi-player.js (keeps derived artifacts in sync).\n";
  process.stdout.write(text);
}

function parseArgs(args) {
  var positional = [];
  var flags = {};
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === "-o") {
      flags.o = args[++i];
    } else if (a === "--loop-beats") {
      flags.loopBeats = parseFloat(args[++i]);
    } else if (a === "--template") {
      flags.template = args[++i];
    } else if (a === "--tempo") {
      flags.tempo = parseFloat(args[++i]);
    } else if (a === "--ppq") {
      flags.ppq = parseInt(args[++i], 10);
    } else if (a === "--loops") {
      flags.loops = parseInt(args[++i], 10);
    } else if (a === "--part") {
      flags.part = args[++i];
    } else {
      positional.push(a);
    }
  }
  return { positional: positional, flags: flags };
}

function main() {
  var fs = require("fs");
  var path = require("path");
  var argv = process.argv.slice(2);
  var cmd = argv[0];

  if (cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }
  if (cmd === "--version" || cmd === "-v") {
    process.stdout.write("midi2scripter " + VERSION + "\n");
    return;
  }
  if (!cmd) {
    process.stderr.write("error: no command given\n\n");
    printHelp();
    process.exit(1);
  }

  function fail(msg) {
    process.stderr.write("error: " + msg + "\n");
    process.exit(1);
  }

  function readMid(p) {
    var buf = fs.readFileSync(p);
    return parseSmf(new Uint8Array(buf));
  }

  try {
    if (cmd === "to-script") {
      var a = parseArgs(argv.slice(1));
      var inMids = a.positional;
      if (inMids.length === 0) {
        fail("to-script: missing input .mid path");
      }
      var opts = {};
      if (a.flags.loopBeats != null && !isNaN(a.flags.loopBeats)) {
        opts.loopBeats = a.flags.loopBeats;
      }
      // One switchable part per input file; the part name is the sanitized
      // basename, its loopBeats come from the file (unless --loop-beats), and
      // the default CC is 0 (assign per-part CCs by hand or via the params).
      var parts = inMids.map(function (p) {
        var parsed = readMid(p);
        var res = notesToPattern(parsed, opts);
        var tuples = res.pattern.map(function (ev) {
          return [ev.offset, ev.pitch, ev.velocity, ev.length];
        });
        return { name: sanitizePartName(p), cc: 0, loopBeats: res.loopBeats, pattern: tuples };
      });
      // Disambiguate parts that share a sanitized basename (e.g. two `verse.mid`
      // from different folders) so each stays reachable by name via `--part`.
      var seenNames = {};
      parts.forEach(function (pt) {
        var base = pt.name;
        var n = base;
        var k = 2;
        while (seenNames[n]) {
          n = base + "-" + k;
          k++;
        }
        seenNames[n] = true;
        pt.name = n;
      });
      var block = renderPartsBlock(parts);
      var template = a.flags.template ? fs.readFileSync(a.flags.template, "utf8") : PLAYER_TEMPLATE;
      var script = replacePatternBlock(template, block);
      if (a.flags.o) {
        fs.writeFileSync(a.flags.o, script);
        process.stderr.write("wrote " + a.flags.o + "\n");
      } else {
        process.stdout.write(script);
      }
    } else if (cmd === "update") {
      var au = parseArgs(argv.slice(1));
      var scriptPath = au.positional[0];
      if (!scriptPath) {
        fail("update: usage: update <script.js> [--template player.js] [-o out.js]");
      }
      var scriptText = fs.readFileSync(scriptPath, "utf8");
      // Validate the existing parts (clear error if malformed), then carry them
      // onto the fresh engine template — keep the parts, update the player.
      var parsedU = parsePartsFromScript(scriptText);
      var existingBlock = extractPatternBlock(scriptText);
      var templateU = au.flags.template ? fs.readFileSync(au.flags.template, "utf8") : PLAYER_TEMPLATE;
      // A modern tuple PARTS block is spliced verbatim so hand comments/
      // formatting survive. A legacy block — a single PATTERN/LOOP_BEATS or an
      // object-form PARTS — would not run against the tuple-reading engine, so
      // it is re-rendered from the parsed parts (a verbatim legacy splice would
      // leave PARTS undefined, or feed object literals to code that indexes
      // tuples, and the script would fail to load / play nothing).
      var isTuplePartsBlock =
        /var\s+PARTS\s*=/.test(existingBlock) && /pattern\s*:\s*\[\s*\[/.test(existingBlock);
      var blockU = isTuplePartsBlock ? existingBlock : renderPartsBlock(parsedU.parts);
      var updated = replacePatternBlock(templateU, blockU);
      var outU = au.flags.o || scriptPath;
      fs.writeFileSync(outU, updated);
      process.stderr.write("wrote " + outU + "\n");
    } else if (cmd === "to-midi") {
      var am = parseArgs(argv.slice(1));
      var scriptPathM = am.positional[0];
      if (!scriptPathM) {
        fail("to-midi: missing input <script.js> path");
      }
      var scriptTextM = fs.readFileSync(scriptPathM, "utf8");
      var partsM = parsePartsFromScript(scriptTextM).parts;
      var optsM = {};
      if (am.flags.tempo != null && !isNaN(am.flags.tempo)) {
        optsM.tempoBpm = am.flags.tempo;
      }
      if (am.flags.ppq != null && !isNaN(am.flags.ppq)) {
        optsM.ppq = am.flags.ppq;
      }
      if (am.flags.loops != null && !isNaN(am.flags.loops)) {
        optsM.loops = am.flags.loops;
      }
      // --part selects one part; without it, export EVERY part (one .mid each).
      var selectedM = am.flags.part != null ? [selectPart(partsM, am.flags.part)] : partsM;
      var multiM = selectedM.length > 1;
      // Output base: -o (or the script path) with its extension stripped.
      var baseM = (am.flags.o || scriptPathM).replace(/\.(mid|js)$/i, "");
      for (var pm = 0; pm < selectedM.length; pm++) {
        var chosen = selectedM[pm];
        // patternToSmf reads {offset,pitch,velocity,length}; adapt the tuples.
        var patObjs = chosen.pattern.map(function (ev) {
          return { offset: ev[0], pitch: ev[1], velocity: ev[2], length: ev[3] };
        });
        var bytes = patternToSmf(patObjs, chosen.loopBeats, optsM);
        var outM = midiOutName(baseM, chosen.name, multiM);
        fs.writeFileSync(outM, Buffer.from(bytes));
        process.stderr.write("wrote " + outM + "\n");
      }
    } else if (cmd === "build") {
      buildBundle();
    } else {
      process.stderr.write("error: unknown command '" + cmd + "'\n\n");
      printHelp();
      process.exit(1);
    }
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
  }
}

// ===========================================================================
// Exports (Node-guarded) + direct-run guard
// ===========================================================================

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseSmf: parseSmf,
    notesToPattern: notesToPattern,
    renderPatternBlock: renderPatternBlock,
    renderPartsBlock: renderPartsBlock,
    replacePatternBlock: replacePatternBlock,
    extractPatternBlock: extractPatternBlock,
    parsePatternFromScript: parsePatternFromScript,
    parsePartsFromScript: parsePartsFromScript,
    sanitizePartName: sanitizePartName,
    selectPart: selectPart,
    midiOutName: midiOutName,
    patternToSmf: patternToSmf,
    VERSION: VERSION,
    PLAYER_TEMPLATE: PLAYER_TEMPLATE
  };
}

if (typeof require !== "undefined" && require.main === module) {
  main();
}
