// midi2scripter.js
// MIDI <-> Player-Script Converter (dependency-free bun CLI).
//
// Three build-time operations, all reducible to a single primitive:
// rewrite the region between `// MIDI-PLAYER:PATTERN-START` and `// MIDI-PLAYER:PATTERN-END`
// in the player script.
//
//   to-script <in.mid>   : bake a SMF groove into a fresh copy of the player.
//   update <script.js> : refresh the player engine in an existing script from
//                        the template, keeping the script's own PATTERN.
//   to-midi <script.js>  : turn a script's PATTERN back into a .mid file.
//
// The core functions (parseSmf, notesToPattern, renderPatternBlock,
// replacePatternBlock, parsePatternFromScript, patternToSmf) are pure and
// side-effect free; only the CLI wrapper touches the filesystem / argv. The
// SMF reader/writer is hand-rolled -- no npm packages, no package.json.

// ===========================================================================
// Markers
// ===========================================================================

var MARKER_START = "// MIDI-PLAYER:PATTERN-START";
var MARKER_END = "// MIDI-PLAYER:PATTERN-END";

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

function printHelp() {
  var text =
    "midi2scripter -- MIDI <-> player script converter (bun)\n" +
    "\n" +
    "Usage:\n" +
    "  bun run midi2scripter.js to-script <in.mid> [-o out.js] [--loop-beats N] [--template path]\n" +
    "  bun run midi2scripter.js update <script.js> [--template player.js] [-o out.js]\n" +
    "  bun run midi2scripter.js to-midi <script.js> [-o out.mid] [--tempo BPM] [--ppq N] [--loops N]\n" +
    "  bun run midi2scripter.js --help\n" +
    "\n" +
    "Commands:\n" +
    "  to-script  Bake a MIDI groove into a fresh copy of the player script.\n" +
    "             Default template: scripter/midi-player.js. Writes to\n" +
    "             stdout unless -o is given.\n" +
    "  update     Refresh the player engine in an existing script from the\n" +
    "             template (default scripter/midi-player.js), keeping the\n" +
    "             script's own PATTERN/LOOP_BEATS unchanged. In place unless -o.\n" +
    "  to-midi    Convert a script's PATTERN back to a Standard MIDI File.\n" +
    "             Defaults: --tempo 120 --ppq 480 --loops 1.\n";
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
      var inMid = a.positional[0];
      if (!inMid) {
        fail("to-script: missing input .mid path");
      }
      var templatePath = a.flags.template || path.join(__dirname, "midi-player.js");
      var parsed = readMid(inMid);
      var opts = {};
      if (a.flags.loopBeats != null && !isNaN(a.flags.loopBeats)) {
        opts.loopBeats = a.flags.loopBeats;
      }
      var res = notesToPattern(parsed, opts);
      var block = renderPatternBlock(res.pattern, res.loopBeats);
      var template = fs.readFileSync(templatePath, "utf8");
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
      var templatePathU = au.flags.template || path.join(__dirname, "midi-player.js");
      var scriptText = fs.readFileSync(scriptPath, "utf8");
      // Validate the existing pattern (clear error if malformed), then carry its
      // block verbatim onto the fresh engine template — keep the pattern, update
      // the player.
      parsePatternFromScript(scriptText);
      var existingBlock = extractPatternBlock(scriptText);
      var templateU = fs.readFileSync(templatePathU, "utf8");
      var updated = replacePatternBlock(templateU, existingBlock);
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
      var pat = parsePatternFromScript(scriptTextM);
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
      var bytes = patternToSmf(pat.pattern, pat.loopBeats, optsM);
      var outM = am.flags.o || scriptPathM.replace(/\.js$/, "") + ".mid";
      fs.writeFileSync(outM, Buffer.from(bytes));
      process.stderr.write("wrote " + outM + "\n");
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
    replacePatternBlock: replacePatternBlock,
    extractPatternBlock: extractPatternBlock,
    parsePatternFromScript: parsePatternFromScript,
    patternToSmf: patternToSmf
  };
}

if (typeof require !== "undefined" && require.main === module) {
  main();
}
