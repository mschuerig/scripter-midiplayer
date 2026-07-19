// midi-groove-player.js
// Logic/MainStage Scripter (MIDI FX) — Host-Synced MIDI Groove Player.
//
// Reads the host transport/tempo and plays a looping multi-lane MIDI drum
// pattern locked to the host beat grid. Emits MIDI only (no audio). Every
// note is scheduled in BEATS via sendAtBeat so host tempo changes track
// automatically, and every NoteOn is paired with a NoteOff so nothing hangs.
//
// On/off is controlled by the host: Play (and, on the metronome strip, the
// metronome toggle) gates playback. Map the plugin's bypass to a MainStage
// button for manual enable/disable.

var NeedsTimingInfo = true;

// ===========================================================================
// ============================  EDIT THIS  ==================================
// ===========================================================================
// Replace PATTERN and LOOP_BEATS to change the groove. Each event is:
//   { offset, pitch, velocity, length }   -- all timing values are in BEATS.
//     offset   : beat position within the loop (0 == start of loop)
//     pitch    : MIDI note number (drum map: 36 kick, 38 snare, 42 closed hat)
//     velocity : 1..127
//     length   : note duration in beats (offBeat = onBeat + length)
// LOOP_BEATS is the loop length in beats (one 4/4 bar == 4).
//
// To drop in a baked Drummer/MuseScore groove, paste its note array here in
// the same {offset, pitch, velocity, length} shape and set LOOP_BEATS.
//
// Default: a one-bar 4/4 backbeat.
//   kick  (36) on beats 0 and 2
//   snare (38) on beats 1 and 3 (the "2 & 4" backbeat)
//   hat   (42) on every eighth note (0, 0.5, 1, ... 3.5)
// ===========================================================================
// MGP:PATTERN-START
var PATTERN = [
  // Closed hi-hat on the eighths.
  { offset: 0.0, pitch: 42, velocity: 80, length: 0.1 },
  { offset: 0.5, pitch: 42, velocity: 64, length: 0.1 },
  { offset: 1.0, pitch: 42, velocity: 80, length: 0.1 },
  { offset: 1.5, pitch: 42, velocity: 64, length: 0.1 },
  { offset: 2.0, pitch: 42, velocity: 80, length: 0.1 },
  { offset: 2.5, pitch: 42, velocity: 64, length: 0.1 },
  { offset: 3.0, pitch: 42, velocity: 80, length: 0.1 },
  { offset: 3.5, pitch: 42, velocity: 64, length: 0.1 },
  // Kick on 1 and 3.
  { offset: 0.0, pitch: 36, velocity: 110, length: 0.1 },
  { offset: 2.0, pitch: 36, velocity: 110, length: 0.1 },
  // Snare backbeat on 2 and 4.
  { offset: 1.0, pitch: 38, velocity: 100, length: 0.1 },
  { offset: 3.0, pitch: 38, velocity: 100, length: 0.1 }
];

var LOOP_BEATS = 4;
// MGP:PATTERN-END

// ===========================================================================
// =========================  END EDIT THIS  =================================
// ===========================================================================

// Pure helper — no Scripter globals, no side effects. This is the one place
// the beat math lives (loop wrap + block edges), so it is unit-testable under
// bun/Node while ProcessMIDI stays a thin adapter.
//
// Returns every pattern event whose ABSOLUTE on-beat falls in the half-open
// range [blockStartBeat, blockEndBeat). The absolute beat of a pattern event
// with `offset` in loop iteration k is `k * loopBeats + offset`.
//
// Result: array of { pitch, velocity, onBeat, offBeat } with offBeat ==
// onBeat + length, ordered by ascending absolute onBeat (monotonic across the
// loop boundary).
function eventsInBlock(pattern, loopBeats, blockStartBeat, blockEndBeat) {
  var out = [];
  // Guard: a non-positive loop length has no well-defined iteration.
  if (!(loopBeats > 0)) {
    return out;
  }
  // Empty or inverted range yields nothing.
  if (!(blockEndBeat > blockStartBeat)) {
    return out;
  }

  // Determine the range of loop iterations k whose events can land in the
  // block. The earliest offset is >= 0 and the latest offset is < loopBeats,
  // so it is safe to scan from the loop containing blockStartBeat up to and
  // including the loop containing blockEndBeat.
  var firstLoop = Math.floor(blockStartBeat / loopBeats);
  var lastLoop = Math.floor(blockEndBeat / loopBeats);

  for (var k = firstLoop; k <= lastLoop; k++) {
    var base = k * loopBeats;
    for (var i = 0; i < pattern.length; i++) {
      var ev = pattern[i];
      // Normalize offset into [0, loopBeats) so an out-of-range offset — e.g.
      // pasting a 2-bar groove but leaving LOOP_BEATS at 4 — can never silently
      // drop a note. For a well-formed offset in [0, loopBeats) this is identity.
      var offset = ((ev.offset % loopBeats) + loopBeats) % loopBeats;
      var onBeat = base + offset;
      if (onBeat >= blockStartBeat && onBeat < blockEndBeat) {
        out.push({
          pitch: ev.pitch,
          velocity: ev.velocity,
          onBeat: onBeat,
          offBeat: onBeat + ev.length
        });
      }
    }
  }

  // Sort by absolute onBeat so results are monotonic even when a single loop
  // iteration lists lanes out of time order (as the default PATTERN does).
  out.sort(function (a, b) {
    return a.onBeat - b.onBeat;
  });

  return out;
}

// Per-block callback: schedule the pattern events overlapping this block.
function ProcessMIDI() {
  var info = GetTimingInfo();
  if (!info.playing) {
    return;
  }

  var evs = eventsInBlock(PATTERN, LOOP_BEATS, info.blockStartBeat, info.blockEndBeat);
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

// Per-incoming-event callback. With "Block Incoming Notes" on (default),
// swallow incoming Notes (e.g. metronome clicks) while letting CC / pitch
// bend / everything else pass through untouched.
function HandleMIDI(event) {
  if (GetParameter("Block Incoming Notes") && event instanceof Note) {
    return;
  }
  event.send();
}

// Called on stop/reset — panic: All Notes Off (CC 123) on all 16 channels so
// no note hangs when the transport stops mid-pattern.
function Reset() {
  for (var ch = 1; ch <= 16; ch++) {
    var cc = new ControlChange();
    cc.number = 123;
    cc.value = 0;
    cc.channel = ch;
    cc.send();
  }
}

var PluginParameters = [
  { name: "Block Incoming Notes", type: "checkbox", defaultValue: 1 }
];

// Node-guarded export so bun/Node tests can require the pure helper. Scripter
// has no `module`, so this branch never runs inside Logic/MainStage.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { eventsInBlock: eventsInBlock };
}
