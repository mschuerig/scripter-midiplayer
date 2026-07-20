import { test, expect } from "bun:test";

const fs = require("fs");
const path = require("path");
const C = require("./midi2scripter.js");

// ---------------------------------------------------------------------------
// Small inline SMF builders (no external .mid fixtures).
// ---------------------------------------------------------------------------

// Wrap raw track bytes in a format-0 MThd + one MTrk with a given division.
function buildSmf(division, trackBytes) {
  var header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // header length 6
    0x00, 0x00, // format 0
    0x00, 0x01, // ntrks 1
    (division >> 8) & 0xff, division & 0xff
  ];
  var len = trackBytes.length;
  var trk = [
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff
  ];
  return new Uint8Array(header.concat(trk, trackBytes));
}

// ---------------------------------------------------------------------------
// Round-trip: patternToSmf -> parseSmf -> notesToPattern
// ---------------------------------------------------------------------------

test("patternToSmf -> parseSmf -> notesToPattern round-trips a known pattern", function () {
  var P = [
    { offset: 0.0, pitch: 36, velocity: 110, length: 0.25 },
    { offset: 1.0, pitch: 38, velocity: 100, length: 0.5 },
    { offset: 2.0, pitch: 36, velocity: 110, length: 0.25 },
    { offset: 3.5, pitch: 42, velocity: 64, length: 0.125 }
  ];
  var loopBeats = 4;

  var bytes = C.patternToSmf(P, loopBeats, {}); // default ppq 480, tempo 120
  expect(bytes).toBeInstanceOf(Uint8Array);

  var parsed = C.parseSmf(bytes);
  expect(parsed.ppq).toBe(480);

  var res = C.notesToPattern(parsed, { loopBeats: 4 });
  expect(res.loopBeats).toBe(4);
  expect(res.pattern.length).toBe(P.length);

  // Compare sorted-by-offset (both sides deterministically ordered).
  var expected = P.slice().sort(function (a, b) {
    return a.offset - b.offset || a.pitch - b.pitch;
  });
  var got = res.pattern.slice().sort(function (a, b) {
    return a.offset - b.offset || a.pitch - b.pitch;
  });
  for (var i = 0; i < expected.length; i++) {
    expect(got[i].pitch).toBe(expected[i].pitch);
    expect(got[i].velocity).toBe(expected[i].velocity);
    expect(Math.abs(got[i].offset - expected[i].offset)).toBeLessThan(1e-6);
    expect(Math.abs(got[i].length - expected[i].length)).toBeLessThan(1e-6);
  }
});

// ---------------------------------------------------------------------------
// Template round-trip: replace then re-parse
// ---------------------------------------------------------------------------

test("replacePatternBlock(template, renderPartsBlock(parts)) then parsePartsFromScript returns the parts", function () {
  var templateText = fs.readFileSync(path.join(__dirname, "src", "midi-player.js"), "utf8");

  var parts = [
    {
      name: "verse",
      cc: 20,
      loopBeats: 4,
      pattern: [
        [0.0, 36, 110, 0.1],
        [0.5, 42, 64, 0.25],
        [1.0, 38, 100, 0.5]
      ]
    },
    {
      name: "chorus",
      cc: 21,
      loopBeats: 8,
      pattern: [
        [0.0, 36, 120, 0.1],
        [4.0, 38, 100, 0.1]
      ]
    }
  ];

  var block = C.renderPartsBlock(parts);
  var script = C.replacePatternBlock(templateText, block);

  var parsed = C.parsePartsFromScript(script);
  expect(parsed.parts).toEqual(parts);
});

test("replacePatternBlock preserves every byte outside the marker region", function () {
  var templateText = fs.readFileSync(path.join(__dirname, "src", "midi-player.js"), "utf8");
  var P = [{ offset: 0.0, pitch: 40, velocity: 90, length: 0.2 }];
  var script = C.replacePatternBlock(templateText, C.renderPatternBlock(P, 2));

  var origLines = templateText.split("\n");
  var startIdx = origLines.indexOf("// MIDI-PLAYER:PATTERN-START");
  var endIdx = origLines.indexOf("// MIDI-PLAYER:PATTERN-END");
  var newLines = script.split("\n");
  var startIdx2 = newLines.indexOf("// MIDI-PLAYER:PATTERN-START");
  var endIdx2 = newLines.indexOf("// MIDI-PLAYER:PATTERN-END");

  // Everything up to & including START marker is identical.
  expect(newLines.slice(0, startIdx2 + 1)).toEqual(origLines.slice(0, startIdx + 1));
  // Everything from END marker onward is identical.
  expect(newLines.slice(endIdx2)).toEqual(origLines.slice(endIdx));
});

test("update: engine comes from the template, pattern is kept from the existing script", function () {
  var template =
    "// v2 engine top\n" +
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PATTERN = [];\n\nvar LOOP_BEATS = 1;\n" +
    "// MIDI-PLAYER:PATTERN-END\n" +
    "// v2 engine bottom\n";
  var oldScript =
    "// v1 engine top\n" +
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PATTERN = [\n  { offset: 0.0, pitch: 40, velocity: 90, length: 0.2 }\n];\n\nvar LOOP_BEATS = 2;\n" +
    "// MIDI-PLAYER:PATTERN-END\n" +
    "// v1 engine bottom\n";

  // update = carry the existing script's pattern block onto the fresh template.
  var updated = C.replacePatternBlock(template, C.extractPatternBlock(oldScript));

  // Engine (outside the markers) is now v2; no v1 engine text survives.
  expect(updated).toContain("// v2 engine top");
  expect(updated).toContain("// v2 engine bottom");
  expect(updated).not.toContain("v1 engine");
  // Pattern is preserved from the old script.
  var parsed = C.parsePatternFromScript(updated);
  expect(parsed.pattern).toEqual([{ offset: 0.0, pitch: 40, velocity: 90, length: 0.2 }]);
  expect(parsed.loopBeats).toBe(2);
});

// ---------------------------------------------------------------------------
// Marker errors
// ---------------------------------------------------------------------------

test("replacePatternBlock throws when markers are missing", function () {
  expect(function () {
    C.replacePatternBlock("no markers in here\njust text\n", "block");
  }).toThrow();
});

test("replacePatternBlock throws when a marker is duplicated", function () {
  var dup =
    "// MIDI-PLAYER:PATTERN-START\nold\n// MIDI-PLAYER:PATTERN-END\n// MIDI-PLAYER:PATTERN-START\nx\n// MIDI-PLAYER:PATTERN-END\n";
  expect(function () {
    C.replacePatternBlock(dup, "block");
  }).toThrow();
});

// ---------------------------------------------------------------------------
// Running status + velocity-0 note-off
// ---------------------------------------------------------------------------

test("hand-built SMF with running status and vel-0 note-off parses correctly", function () {
  // delta 0: note-on ch0 pitch 60 vel 100
  // delta 480 (varlen 0x83 0x60): running status (no status byte), pitch 60 vel 0 -> note-off
  // delta 0: end-of-track
  var track = [
    0x00, 0x90, 0x3c, 0x64, // note on 60 vel 100
    0x83, 0x60, 0x3c, 0x00, // running status, 480 ticks later, vel 0 -> off
    0x00, 0xff, 0x2f, 0x00 // end of track
  ];
  var bytes = buildSmf(480, track);
  var parsed = C.parseSmf(bytes);

  expect(parsed.notes.length).toBe(1);
  expect(parsed.notes[0].pitch).toBe(60);
  expect(parsed.notes[0].velocity).toBe(100);
  expect(parsed.notes[0].startTick).toBe(0);
  expect(parsed.notes[0].endTick).toBe(480);
});

test("set-tempo and time-signature meta are parsed", function () {
  // tempo 140 bpm -> us = round(60e6/140) = 428571
  var us = Math.round(60000000 / 140);
  var track = [
    0x00, 0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff,
    0x00, 0xff, 0x58, 0x04, 0x06, 0x03, 0x18, 0x08, // 6/8 time sig
    0x00, 0x90, 0x24, 0x64, // note on 36 vel 100
    0x60, 0x80, 0x24, 0x40, // 96 ticks later note off
    0x00, 0xff, 0x2f, 0x00
  ];
  var parsed = C.parseSmf(buildSmf(480, track));
  expect(Math.abs(parsed.tempoBpm - 140)).toBeLessThan(0.5);
  expect(parsed.timeSigNum).toBe(6);
  expect(parsed.timeSigDen).toBe(8);
});

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

test("SMPTE division is rejected", function () {
  // division high bit set (e.g. 0xE250 = -30 fps / 80 ticks)
  var track = [0x00, 0xff, 0x2f, 0x00];
  var bytes = buildSmf(0xe250, track);
  expect(function () {
    C.parseSmf(bytes);
  }).toThrow();
});

test("empty-notes MIDI is rejected by notesToPattern", function () {
  var track = [0x00, 0xff, 0x2f, 0x00]; // only end-of-track
  var parsed = C.parseSmf(buildSmf(480, track));
  expect(parsed.notes.length).toBe(0);
  expect(function () {
    C.notesToPattern(parsed, {});
  }).toThrow();
});

test("patternToSmf rejects an empty pattern", function () {
  expect(function () {
    C.patternToSmf([], 4, {});
  }).toThrow();
});

// ---------------------------------------------------------------------------
// Rendering / formatting
// ---------------------------------------------------------------------------

test("renderPatternBlock matches the player's exact formatting", function () {
  var block = C.renderPatternBlock(
    [
      { offset: 0, pitch: 36, velocity: 110, length: 0.1 },
      { offset: 1, pitch: 38, velocity: 100, length: 0.1 }
    ],
    4
  );
  var expected =
    "var PATTERN = [\n" +
    "  { offset: 0.0, pitch: 36, velocity: 110, length: 0.1 },\n" +
    "  { offset: 1.0, pitch: 38, velocity: 100, length: 0.1 }\n" +
    "];\n" +
    "\n" +
    "var LOOP_BEATS = 4;";
  expect(block).toBe(expected);
});

test("renderPatternBlock: key order, decimal offsets, no trailing comma", function () {
  var block = C.renderPatternBlock([{ offset: 2, pitch: 42, velocity: 80, length: 0.25 }], 8);
  // key order offset, pitch, velocity, length
  expect(block).toContain("{ offset: 2.0, pitch: 42, velocity: 80, length: 0.25 }");
  // integer offset rendered with a decimal point
  expect(block).toContain("offset: 2.0");
  // sole element has no trailing comma before the closing bracket
  expect(block).toContain("length: 0.25 }\n];");
  // whole loopBeats stays integer
  expect(block).toContain("var LOOP_BEATS = 8;");
});

test("notesToPattern default loopBeats rounds up to a whole bar", function () {
  // one note at beat 0, ending at beat 3.6 -> ceil to 1 bar (4 beats) in 4/4.
  var parsed = {
    ppq: 480,
    timeSigNum: 4,
    timeSigDen: 4,
    tempoBpm: 120,
    notes: [{ pitch: 36, velocity: 100, startTick: 0, endTick: Math.round(3.6 * 480), channel: 0 }]
  };
  var res = C.notesToPattern(parsed, {});
  expect(res.loopBeats).toBe(4);
});

test("notesToPattern normalizes offsets into [0, loopBeats)", function () {
  // start beat 5.0 with loopBeats 4 -> offset 1.0
  var parsed = {
    ppq: 480,
    timeSigNum: 4,
    timeSigDen: 4,
    tempoBpm: 120,
    notes: [{ pitch: 36, velocity: 100, startTick: 5 * 480, endTick: 5 * 480 + 240, channel: 0 }]
  };
  var res = C.notesToPattern(parsed, { loopBeats: 4 });
  expect(res.pattern.length).toBe(1);
  expect(Math.abs(res.pattern[0].offset - 1.0)).toBeLessThan(1e-6);
  expect(Math.abs(res.pattern[0].length - 0.5)).toBeLessThan(1e-6);
});

// ---------------------------------------------------------------------------
// renderPartsBlock: tuple formatting, element/key order, no trailing comma
// ---------------------------------------------------------------------------

test("renderPartsBlock emits the multi-part tuple style exactly", function () {
  var block = C.renderPartsBlock([
    { name: "backbeat", cc: 0, loopBeats: 4, pattern: [
      [0, 42, 80, 0.1],
      [1, 38, 100, 0.1]
    ] }
  ]);
  var expected =
    "var PARTS = [\n" +
    "  { name: \"backbeat\", cc: 0, loopBeats: 4, pattern: [\n" +
    "    [0.0, 42, 80, 0.1],\n" +
    "    [1.0, 38, 100, 0.1]\n" +
    "  ] }\n" +
    "];";
  expect(block).toBe(expected);
});

test("renderPartsBlock: decimal offsets/lengths, integer pitch/velocity, no trailing commas", function () {
  var block = C.renderPartsBlock([
    { name: "a", cc: 20, loopBeats: 8, pattern: [[2, 42, 80, 0.25]] },
    { name: "b", cc: 21, loopBeats: 4, pattern: [[0, 36, 110, 0.1]] }
  ]);
  // tuple element order offset, pitch, velocity, length; integer offset with a decimal
  expect(block).toContain("[2.0, 42, 80, 0.25]");
  // sole tuple in a part has no trailing comma before its closing bracket
  expect(block).toContain("[2.0, 42, 80, 0.25]\n  ] }");
  // whole loopBeats stays an integer
  expect(block).toContain("loopBeats: 8");
  // the last part has no trailing comma before the array close
  expect(block).toContain("[0.0, 36, 110, 0.1]\n  ] }\n];");
  // a non-final part DOES carry a trailing comma
  expect(block).toContain("  ] },\n  { name: \"b\"");
});

// ---------------------------------------------------------------------------
// Multi-file bundle: N .mid files -> N parts (drive the pure path)
// ---------------------------------------------------------------------------

test("to-script pure path: two SMF fixtures bundle into two parts", function () {
  // Two distinct grooves baked to SMF, then read back the way `to-script` does.
  var A = [{ offset: 0.0, pitch: 36, velocity: 110, length: 0.25 }];
  var B = [
    { offset: 0.0, pitch: 42, velocity: 80, length: 0.1 },
    { offset: 2.0, pitch: 38, velocity: 100, length: 0.1 }
  ];
  var smfA = C.patternToSmf(A, 4, {});
  var smfB = C.patternToSmf(B, 4, {});

  function fileToPart(name, bytes) {
    var res = C.notesToPattern(C.parseSmf(bytes), {});
    var tuples = res.pattern.map(function (ev) {
      return [ev.offset, ev.pitch, ev.velocity, ev.length];
    });
    return { name: name, cc: 0, loopBeats: res.loopBeats, pattern: tuples };
  }

  var parts = [fileToPart("a", smfA), fileToPart("b", smfB)];
  var block = C.renderPartsBlock(parts);
  var template = fs.readFileSync(path.join(__dirname, "src", "midi-player.js"), "utf8");
  var script = C.replacePatternBlock(template, block);

  var reparsed = C.parsePartsFromScript(script).parts;
  expect(reparsed.length).toBe(2);
  expect(reparsed[0].name).toBe("a");
  expect(reparsed[0].pattern.length).toBe(1);
  expect(reparsed[1].name).toBe("b");
  expect(reparsed[1].pattern.length).toBe(2);
});

test("sanitizePartName strips directory + extension and cleans the basename", function () {
  expect(C.sanitizePartName("/path/to/My Groove.mid")).toBe("My Groove");
  expect(C.sanitizePartName("beat.MIDI")).toBe("beat");
  expect(C.sanitizePartName("weird@name!.mid")).toBe("weird name");
});

// ---------------------------------------------------------------------------
// Legacy tolerance: parsePartsFromScript reads old formats as one/more parts
// ---------------------------------------------------------------------------

test("parsePartsFromScript reads a legacy single PATTERN/LOOP_BEATS script as one part", function () {
  var s =
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PATTERN = [\n" +
    "  { offset: 0.0, pitch: 36, velocity: 110, length: 0.1 },\n" +
    "  { offset: 2.0, pitch: 38, velocity: 100, length: 0.1 }\n" +
    "];\n\nvar LOOP_BEATS = 4;\n" +
    "// MIDI-PLAYER:PATTERN-END\n";
  var parsed = C.parsePartsFromScript(s);
  expect(parsed.parts.length).toBe(1);
  expect(parsed.parts[0].name).toBe("part1");
  expect(parsed.parts[0].cc).toBe(0);
  expect(parsed.parts[0].loopBeats).toBe(4);
  expect(parsed.parts[0].pattern).toEqual([
    [0.0, 36, 110, 0.1],
    [2.0, 38, 100, 0.1]
  ]);
});

test("update migrates a legacy PATTERN/LOOP_BEATS block onto the PARTS engine", function () {
  // A legacy script's block references PATTERN, but the refreshed engine reads
  // PARTS — so `update` must re-render the parsed parts into a PARTS block (a
  // verbatim splice would leave PARTS undefined and the script would not load).
  var legacy =
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PATTERN = [\n" +
    "  { offset: 0.0, pitch: 36, velocity: 110, length: 0.1 }\n" +
    "];\n\nvar LOOP_BEATS = 4;\n" +
    "// MIDI-PLAYER:PATTERN-END\n";
  var template = fs.readFileSync(path.join(__dirname, "src", "midi-player.js"), "utf8");

  // Mirror the CLI `update` migration branch exactly.
  var block = C.renderPartsBlock(C.parsePartsFromScript(legacy).parts);
  var updated = C.replacePatternBlock(template, block);

  // The emitted block defines PARTS, not a bare legacy PATTERN.
  var region = C.extractPatternBlock(updated);
  expect(region).toContain("var PARTS");
  expect(region).not.toContain("var PATTERN");
  // And it reparses to the migrated single part.
  var parsed = C.parsePartsFromScript(updated);
  expect(parsed.parts.length).toBe(1);
  expect(parsed.parts[0].loopBeats).toBe(4);
  expect(parsed.parts[0].pattern).toEqual([[0.0, 36, 110, 0.1]]);
});

test("parsePartsFromScript reads a legacy object-form PARTS (pattern of {offset,...})", function () {
  var s =
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PARTS = [\n" +
    "  { name: \"old\", cc: 5, loopBeats: 4, pattern: [\n" +
    "    { offset: 0.0, pitch: 36, velocity: 110, length: 0.1 },\n" +
    "    { offset: 1.0, pitch: 38, velocity: 100, length: 0.2 }\n" +
    "  ] }\n" +
    "];\n" +
    "// MIDI-PLAYER:PATTERN-END\n";
  var parsed = C.parsePartsFromScript(s);
  expect(parsed.parts.length).toBe(1);
  expect(parsed.parts[0].name).toBe("old");
  expect(parsed.parts[0].cc).toBe(5);
  expect(parsed.parts[0].pattern).toEqual([
    [0.0, 36, 110, 0.1],
    [1.0, 38, 100, 0.2]
  ]);
});

test("parsePartsFromScript reads a two-part tuple PARTS", function () {
  var s =
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PARTS = [\n" +
    "  { name: \"a\", cc: 20, loopBeats: 4, pattern: [\n" +
    "    [0.0, 36, 110, 0.1]\n" +
    "  ] },\n" +
    "  { name: \"b\", cc: 21, loopBeats: 8, pattern: [\n" +
    "    [0.0, 38, 100, 0.1],\n" +
    "    [4.0, 42, 80, 0.1]\n" +
    "  ] }\n" +
    "];\n" +
    "// MIDI-PLAYER:PATTERN-END\n";
  var parts = C.parsePartsFromScript(s).parts;
  expect(parts.length).toBe(2);
  expect(parts[0]).toEqual({ name: "a", cc: 20, loopBeats: 4, pattern: [[0.0, 36, 110, 0.1]] });
  expect(parts[1].loopBeats).toBe(8);
  expect(parts[1].pattern.length).toBe(2);
});

test("parsePartsFromScript throws on a malformed tuple (extra element)", function () {
  var s =
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PARTS = [\n" +
    "  { name: \"a\", cc: 0, loopBeats: 4, pattern: [\n" +
    "    [0.0, 36, 110, 0.1, 5]\n" +
    "  ] }\n" +
    "];\n" +
    "// MIDI-PLAYER:PATTERN-END\n";
  expect(function () {
    C.parsePartsFromScript(s);
  }).toThrow();
});

// ---------------------------------------------------------------------------
// to-midi --part: select the right part (drive selectPart on parsed parts)
// ---------------------------------------------------------------------------

test("selectPart picks by 1-based index, by name, and defaults to part 1", function () {
  var parts = [
    { name: "a", cc: 0, loopBeats: 4, pattern: [[0.0, 36, 110, 0.1]] },
    { name: "b", cc: 0, loopBeats: 4, pattern: [[0.0, 38, 100, 0.1]] }
  ];
  expect(C.selectPart(parts, undefined).name).toBe("a");
  expect(C.selectPart(parts, "2").name).toBe("b");
  expect(C.selectPart(parts, "a").name).toBe("a");
  expect(C.selectPart(parts, "b").name).toBe("b");
  expect(function () { C.selectPart(parts, "9"); }).toThrow();
  expect(function () { C.selectPart(parts, "missing"); }).toThrow();
});

test("to-midi pure path: the selected part's tuples convert to an SMF", function () {
  var parts = [
    { name: "kick", cc: 0, loopBeats: 4, pattern: [[0.0, 36, 110, 0.25]] },
    { name: "snare", cc: 0, loopBeats: 4, pattern: [[1.0, 38, 100, 0.5]] }
  ];
  var chosen = C.selectPart(parts, "snare");
  var patObjs = chosen.pattern.map(function (ev) {
    return { offset: ev[0], pitch: ev[1], velocity: ev[2], length: ev[3] };
  });
  var bytes = C.patternToSmf(patObjs, chosen.loopBeats, { ppq: 480 });
  var reparsed = C.parseSmf(bytes);
  expect(reparsed.notes.length).toBe(1);
  expect(reparsed.notes[0].pitch).toBe(38);
});

// ---------------------------------------------------------------------------
// Malformed-reparse: fail loudly instead of silently dropping notes
// ---------------------------------------------------------------------------

function scriptWith(body) {
  return "// MIDI-PLAYER:PATTERN-START\n" + body + "\nvar LOOP_BEATS = 4;\n// MIDI-PLAYER:PATTERN-END\n";
}

test("parsePatternFromScript throws on a reordered-key event (no silent drop)", function () {
  var s = scriptWith("var PATTERN = [\n  { pitch: 36, offset: 0.0, velocity: 100, length: 0.1 }\n];");
  expect(function () {
    C.parsePatternFromScript(s);
  }).toThrow();
});

test("parsePatternFromScript throws on an event with an extra key", function () {
  var s = scriptWith(
    "var PATTERN = [\n  { offset: 0.0, pitch: 36, velocity: 100, length: 0.1, prob: 0.5 }\n];"
  );
  expect(function () {
    C.parsePatternFromScript(s);
  }).toThrow();
});

test("parsePatternFromScript tolerates comments containing braces in the region", function () {
  var s = scriptWith(
    "var PATTERN = [\n  // a note { with braces } in a comment\n  { offset: 0.0, pitch: 36, velocity: 100, length: 0.1 }\n];"
  );
  var r = C.parsePatternFromScript(s);
  expect(r.pattern.length).toBe(1);
  expect(r.pattern[0].pitch).toBe(36);
});

// ---------------------------------------------------------------------------
// patternToSmf: validate values -> clear error, not a corrupt file
// ---------------------------------------------------------------------------

test("patternToSmf rejects out-of-range pitch/velocity and negative offset", function () {
  expect(function () {
    C.patternToSmf([{ offset: 0, pitch: 200, velocity: 100, length: 0.1 }], 4, {});
  }).toThrow();
  expect(function () {
    C.patternToSmf([{ offset: -1, pitch: 36, velocity: 100, length: 0.1 }], 4, {});
  }).toThrow();
  expect(function () {
    C.patternToSmf([{ offset: 0, pitch: 36, velocity: 0, length: 0.1 }], 4, {});
  }).toThrow();
});

test("patternToSmf rejects a ppq beyond the 15-bit division range", function () {
  expect(function () {
    C.patternToSmf([{ offset: 0, pitch: 36, velocity: 100, length: 0.1 }], 4, { ppq: 96000 });
  }).toThrow();
});

test("patternToSmf rejects a tempo too low for the 3-byte tempo field", function () {
  expect(function () {
    C.patternToSmf([{ offset: 0, pitch: 36, velocity: 100, length: 0.1 }], 4, { tempoBpm: 1 });
  }).toThrow();
});

// ---------------------------------------------------------------------------
// FIFO same-pitch pairing + zero-length note-off ordering
// ---------------------------------------------------------------------------

test("overlapping same-pitch notes pair FIFO (first-on to first-off)", function () {
  // on60@0, on60@96, off60@192, off60@288 -> FIFO: [0,192] and [96,288]
  var track = [
    0x00, 0x90, 0x3c, 0x64, // on 60 vel 100 @0
    0x60, 0x90, 0x3c, 0x50, // on 60 vel 80 @96
    0x60, 0x80, 0x3c, 0x40, // off 60 @192 -> closes the @0 note
    0x60, 0x80, 0x3c, 0x40, // off 60 @288 -> closes the @96 note
    0x00, 0xff, 0x2f, 0x00
  ];
  var parsed = C.parseSmf(buildSmf(480, track));
  expect(parsed.notes.length).toBe(2);
  var first = parsed.notes.filter(function (n) { return n.startTick === 0; })[0];
  var second = parsed.notes.filter(function (n) { return n.startTick === 96; })[0];
  expect(first.endTick).toBe(192);
  expect(first.velocity).toBe(100);
  expect(second.endTick).toBe(288);
  expect(second.velocity).toBe(80);
});

test("zero-length note round-trips with note-off strictly after note-on", function () {
  var bytes = C.patternToSmf([{ offset: 0.0, pitch: 36, velocity: 100, length: 0.0 }], 4, { ppq: 480 });
  var parsed = C.parseSmf(bytes);
  expect(parsed.notes.length).toBe(1);
  expect(parsed.notes[0].startTick).toBe(0);
  expect(parsed.notes[0].endTick).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Single-file bundle stays in sync with the separate player source
// ---------------------------------------------------------------------------

test("PLAYER_TEMPLATE matches src/midi-player.js (run `bun run midi2scripter.js build` if this fails)", function () {
  var player = fs.readFileSync(path.join(__dirname, "src", "midi-player.js"), "utf8");
  expect(C.PLAYER_TEMPLATE).toBe(player);
});

test("example-player.js matches src/midi-player.js (run `bun run midi2scripter.js build` if this fails)", function () {
  var player = fs.readFileSync(path.join(__dirname, "src", "midi-player.js"), "utf8");
  var example = fs.readFileSync(path.join(__dirname, "example-player.js"), "utf8");
  expect(example).toBe(player);
});

// ---------------------------------------------------------------------------
// Review-driven hardening
// ---------------------------------------------------------------------------

test("selectPart matches an all-digit part name before treating it as an index", function () {
  var parts = [{ name: "2" }, { name: "x" }];
  // "2" is an exact name here -> the part literally named "2" (index 0).
  expect(C.selectPart(parts, "2")).toBe(parts[0]);
  // With no name match, a bare integer still selects by 1-based index.
  var ab = [{ name: "a" }, { name: "b" }];
  expect(C.selectPart(ab, "2")).toBe(ab[1]);
});

test("parsePartsFromScript throws on a body mixing tuple and object events (no silent drop)", function () {
  var s =
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PARTS = [\n" +
    "  { name: \"mix\", cc: 0, loopBeats: 4, pattern: [\n" +
    "    [0.0, 36, 110, 0.1],\n" +
    "    { offset: 1.0, pitch: 38, velocity: 100, length: 0.1 }\n" +
    "  ] }\n" +
    "];\n" +
    "// MIDI-PLAYER:PATTERN-END\n";
  expect(function () {
    C.parsePartsFromScript(s);
  }).toThrow();
});

test("parsePartsFromScript accepts single-quoted part names (hand-edit tolerance)", function () {
  var s =
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PARTS = [\n" +
    "  { name: 'verse', cc: 7, loopBeats: 4, pattern: [\n" +
    "    [0.0, 36, 110, 0.1]\n" +
    "  ] }\n" +
    "];\n" +
    "// MIDI-PLAYER:PATTERN-END\n";
  var parsed = C.parsePartsFromScript(s);
  expect(parsed.parts.length).toBe(1);
  expect(parsed.parts[0].name).toBe("verse");
  expect(parsed.parts[0].cc).toBe(7);
});

test("update migrates a legacy OBJECT-form PARTS block onto the tuple engine", function () {
  // The engine indexes tuples (ev[0..3]); splicing object literals verbatim
  // would play nothing. Mirror the CLI update re-render path for a non-tuple block.
  var objScript =
    "// MIDI-PLAYER:PATTERN-START\n" +
    "var PARTS = [\n" +
    "  { name: \"old\", cc: 5, loopBeats: 4, pattern: [\n" +
    "    { offset: 0.0, pitch: 36, velocity: 110, length: 0.1 },\n" +
    "    { offset: 1.0, pitch: 38, velocity: 100, length: 0.2 }\n" +
    "  ] }\n" +
    "];\n" +
    "// MIDI-PLAYER:PATTERN-END\n";
  var template = fs.readFileSync(path.join(__dirname, "src", "midi-player.js"), "utf8");

  var block = C.renderPartsBlock(C.parsePartsFromScript(objScript).parts);
  var updated = C.replacePatternBlock(template, block);

  var region = C.extractPatternBlock(updated);
  expect(region).toContain("pattern: [");
  // The emitted block is tuple form (no object literals survive).
  expect(region).not.toContain("offset:");
  var parsed = C.parsePartsFromScript(updated);
  expect(parsed.parts[0].name).toBe("old");
  expect(parsed.parts[0].cc).toBe(5);
  expect(parsed.parts[0].pattern).toEqual([
    [0.0, 36, 110, 0.1],
    [1.0, 38, 100, 0.2]
  ]);
});
