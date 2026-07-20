import { test, expect } from "bun:test";

const { eventsInBlock, nextBarBoundary, planBlock, partCcParamName } = require("./midi-player.js");

// Small, explicit test pattern so expectations are exact.
// Two lanes, loop length 4 beats. Compact 4-tuples [offset, pitch, velocity, length].
var TEST_PATTERN = [
  [0.0, 36, 100, 0.25],
  [1.0, 38, 90, 0.5],
  [2.0, 36, 100, 0.25],
  [3.5, 42, 70, 0.1]
];
var TEST_LOOP = 4;

// ---------------------------------------------------------------------------
// eventsInBlock — origin 0 preserves the original single-part behavior
// ---------------------------------------------------------------------------

test("mid-loop block returns exactly the in-range events", function () {
  // Block [1.0, 3.0) within the first loop: offsets 1.0 and 2.0 qualify.
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0, 1.0, 3.0);
  expect(evs.length).toBe(2);
  expect(evs[0].onBeat).toBe(1.0);
  expect(evs[0].pitch).toBe(38);
  expect(evs[1].onBeat).toBe(2.0);
  expect(evs[1].pitch).toBe(36);
});

test("half-open range excludes the end and includes the start", function () {
  // Block [0.0, 1.0): includes offset 0.0, excludes offset 1.0.
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0, 0.0, 1.0);
  expect(evs.length).toBe(1);
  expect(evs[0].onBeat).toBe(0.0);
  expect(evs[0].pitch).toBe(36);
});

test("block spanning the loop boundary returns tail + head with monotonic onBeats", function () {
  // Block [3.0, 5.0) spans the loop 0 -> loop 1 boundary at beat 4.
  //   tail of loop 0: offset 3.5 -> abs 3.5
  //   head of loop 1: offset 0.0 -> abs 4.0
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0, 3.0, 5.0);
  expect(evs.length).toBe(2);
  expect(evs[0].onBeat).toBe(3.5);
  expect(evs[0].pitch).toBe(42);
  expect(evs[1].onBeat).toBe(4.0);
  expect(evs[1].pitch).toBe(36);

  // Absolute onBeats strictly increasing.
  for (var i = 1; i < evs.length; i++) {
    expect(evs[i].onBeat).toBeGreaterThan(evs[i - 1].onBeat);
  }
});

test("block spanning multiple whole loops keeps onBeats monotonic", function () {
  // Block [0.0, 8.0) covers loops 0 and 1 fully: 8 events, ascending.
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0, 0.0, 8.0);
  expect(evs.length).toBe(8);
  for (var i = 1; i < evs.length; i++) {
    expect(evs[i].onBeat).toBeGreaterThan(evs[i - 1].onBeat);
  }
});

test("empty region returns []", function () {
  // A block with no events between offsets: [2.25, 3.25).
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0, 2.25, 3.25);
  expect(evs).toEqual([]);
});

test("zero-width block returns []", function () {
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0, 1.0, 1.0);
  expect(evs).toEqual([]);
});

test("every returned event satisfies offBeat === onBeat + length", function () {
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0, 0.0, 12.0);
  expect(evs.length).toBeGreaterThan(0);
  for (var i = 0; i < evs.length; i++) {
    var e = evs[i];
    // Recover the source event by matching absolute onBeat within its loop.
    var offsetInLoop = ((e.onBeat % TEST_LOOP) + TEST_LOOP) % TEST_LOOP;
    var src = null;
    for (var j = 0; j < TEST_PATTERN.length; j++) {
      if (TEST_PATTERN[j][0] === offsetInLoop && TEST_PATTERN[j][1] === e.pitch) {
        src = TEST_PATTERN[j];
        break;
      }
    }
    expect(src).not.toBeNull();
    expect(e.offBeat).toBe(e.onBeat + src[3]);
  }
});

test("non-positive loopBeats returns []", function () {
  expect(eventsInBlock(TEST_PATTERN, 0, 0, 0.0, 4.0)).toEqual([]);
  expect(eventsInBlock(TEST_PATTERN, -4, 0, 0.0, 4.0)).toEqual([]);
});

test("fractional block edges select correctly", function () {
  // Block [3.4, 3.6): only offset 3.5 qualifies.
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0, 3.4, 3.6);
  expect(evs.length).toBe(1);
  expect(evs[0].onBeat).toBe(3.5);
  expect(evs[0].pitch).toBe(42);
});

test("offsets outside [0, loopBeats) are normalized into the loop (no silent drop)", function () {
  // offset 5.0 with loop 4 behaves like offset 1.0 (5 mod 4).
  var evs = eventsInBlock([[5.0, 50, 80, 0.2]], 4, 0, 0.0, 4.0);
  expect(evs.length).toBe(1);
  expect(evs[0].onBeat).toBe(1.0);
  expect(evs[0].offBeat).toBe(1.2);
  // Negative offset wraps too: -1 mod 4 == 3.
  var evs2 = eventsInBlock([[-1.0, 50, 80, 0.2]], 4, 0, 0.0, 4.0);
  expect(evs2.length).toBe(1);
  expect(evs2[0].onBeat).toBe(3.0);
});

// ---------------------------------------------------------------------------
// eventsInBlock — a non-zero origin shifts the whole loop grid
// ---------------------------------------------------------------------------

test("origin shifts the loop grid: a part anchored at beat 8 plays offset 0 at beat 8", function () {
  // Origin 8, block [8.0, 9.0): the loop restarts at 8, so offset 0.0 -> abs 8.0.
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 8, 8.0, 9.0);
  expect(evs.length).toBe(1);
  expect(evs[0].onBeat).toBe(8.0);
  expect(evs[0].pitch).toBe(36);

  // Block [9.0, 11.0) with origin 8: offsets 1.0 -> 9.0 and 2.0 -> 10.0.
  var evs2 = eventsInBlock(TEST_PATTERN, TEST_LOOP, 8, 9.0, 11.0);
  expect(evs2.length).toBe(2);
  expect(evs2[0].onBeat).toBe(9.0);
  expect(evs2[0].pitch).toBe(38);
  expect(evs2[1].onBeat).toBe(10.0);
  expect(evs2[1].pitch).toBe(36);
});

test("origin at a non-integer beat carries through to absolute onBeats", function () {
  // Origin 2.5, block [2.5, 3.0): offset 0.0 -> abs 2.5.
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 2.5, 2.5, 3.0);
  expect(evs.length).toBe(1);
  expect(evs[0].onBeat).toBe(2.5);
  expect(evs[0].pitch).toBe(36);
});

// ---------------------------------------------------------------------------
// nextBarBoundary
// ---------------------------------------------------------------------------

test("nextBarBoundary returns the next multiple strictly greater than beat (mid-bar)", function () {
  expect(nextBarBoundary(2.3, 4)).toBe(4);
  expect(nextBarBoundary(5.0, 4)).toBe(8);
});

test("nextBarBoundary on a boundary returns the NEXT boundary (never the current)", function () {
  expect(nextBarBoundary(4, 4)).toBe(8);
  expect(nextBarBoundary(0, 4)).toBe(4);
});

test("nextBarBoundary honors a non-4 bar length (3/4, 7/8-ish)", function () {
  expect(nextBarBoundary(1.0, 3)).toBe(3);
  expect(nextBarBoundary(3.0, 3)).toBe(6);
  expect(nextBarBoundary(0.5, 3.5)).toBe(3.5);
  expect(nextBarBoundary(3.5, 3.5)).toBe(7);
});

// ---------------------------------------------------------------------------
// planBlock
// ---------------------------------------------------------------------------

var TWO_PARTS = [
  { name: "a", cc: 0, loopBeats: 4, pattern: [[0.0, 36, 100, 0.1]] },
  { name: "b", cc: 0, loopBeats: 4, pattern: [[0.0, 38, 100, 0.1]] }
];

test("planBlock with no pending is one whole-block segment on the active part", function () {
  var state = { activePart: 0, partOrigin: 0, pending: null };
  var plan = planBlock(state, TWO_PARTS, 4, 4.0, 5.0);
  expect(plan.segments.length).toBe(1);
  expect(plan.segments[0]).toEqual({ part: 0, origin: 0, segStart: 4.0, segEnd: 5.0 });
  expect(plan.next).toEqual({ activePart: 0, partOrigin: 0, pending: null });
});

test("planBlock carries a pending whose boundary is beyond this block", function () {
  var state = { activePart: 0, partOrigin: 0, pending: { part: 1, atBeat: 8 } };
  var plan = planBlock(state, TWO_PARTS, 4, 4.0, 5.0);
  expect(plan.segments.length).toBe(1);
  expect(plan.segments[0]).toEqual({ part: 0, origin: 0, segStart: 4.0, segEnd: 5.0 });
  // Pending is carried forward unchanged.
  expect(plan.next).toEqual({ activePart: 0, partOrigin: 0, pending: { part: 1, atBeat: 8 } });
});

test("planBlock splits at a boundary inside the block into two segments", function () {
  // Block [3.0, 5.0), pending switch to part 1 at beat 4.
  var state = { activePart: 0, partOrigin: 0, pending: { part: 1, atBeat: 4 } };
  var plan = planBlock(state, TWO_PARTS, 4, 3.0, 5.0);
  expect(plan.segments.length).toBe(2);
  expect(plan.segments[0]).toEqual({ part: 0, origin: 0, segStart: 3.0, segEnd: 4 });
  expect(plan.segments[1]).toEqual({ part: 1, origin: 4, segStart: 4, segEnd: 5.0 });
  expect(plan.next).toEqual({ activePart: 1, partOrigin: 4, pending: null });
});

test("planBlock applies a pending already reached for the whole block", function () {
  // atBeat <= blockStart: the new part plays the whole block from its origin.
  var state = { activePart: 0, partOrigin: 0, pending: { part: 1, atBeat: 4 } };
  var plan = planBlock(state, TWO_PARTS, 4, 4.0, 5.0);
  expect(plan.segments.length).toBe(1);
  expect(plan.segments[0]).toEqual({ part: 1, origin: 4, segStart: 4.0, segEnd: 5.0 });
  expect(plan.next).toEqual({ activePart: 1, partOrigin: 4, pending: null });
});

test("planBlock restart (pending part == active) yields a fresh origin at the boundary", function () {
  // Restart of the active part 0: same part, new bar-aligned origin at 4.
  var state = { activePart: 0, partOrigin: 0, pending: { part: 0, atBeat: 4 } };
  var plan = planBlock(state, TWO_PARTS, 4, 3.0, 5.0);
  expect(plan.segments.length).toBe(2);
  expect(plan.segments[0]).toEqual({ part: 0, origin: 0, segStart: 3.0, segEnd: 4 });
  // Second segment is the same part but re-anchored at the boundary.
  expect(plan.segments[1]).toEqual({ part: 0, origin: 4, segStart: 4, segEnd: 5.0 });
  expect(plan.next).toEqual({ activePart: 0, partOrigin: 4, pending: null });
});

test("partCcParamName is the exact PluginParameters label used to read a part's CC", function () {
  // The builder and the Per-Part matcher must derive the same string, or the
  // matcher's GetParameter(...) would silently miss and switching would break.
  expect(partCcParamName(0, "backbeat")).toBe("Part 1 CC (backbeat)");
  expect(partCcParamName(2, "chorus")).toBe("Part 3 CC (chorus)");
});
