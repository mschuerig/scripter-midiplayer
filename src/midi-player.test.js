import { test, expect } from "bun:test";

const { eventsInBlock } = require("./midi-player.js");

// Small, explicit test pattern so expectations are exact.
// Two lanes, loop length 4 beats.
var TEST_PATTERN = [
  { offset: 0.0, pitch: 36, velocity: 100, length: 0.25 },
  { offset: 1.0, pitch: 38, velocity: 90, length: 0.5 },
  { offset: 2.0, pitch: 36, velocity: 100, length: 0.25 },
  { offset: 3.5, pitch: 42, velocity: 70, length: 0.1 }
];
var TEST_LOOP = 4;

test("mid-loop block returns exactly the in-range events", function () {
  // Block [1.0, 3.0) within the first loop: offsets 1.0 and 2.0 qualify.
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 1.0, 3.0);
  expect(evs.length).toBe(2);
  expect(evs[0].onBeat).toBe(1.0);
  expect(evs[0].pitch).toBe(38);
  expect(evs[1].onBeat).toBe(2.0);
  expect(evs[1].pitch).toBe(36);
});

test("half-open range excludes the end and includes the start", function () {
  // Block [0.0, 1.0): includes offset 0.0, excludes offset 1.0.
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0.0, 1.0);
  expect(evs.length).toBe(1);
  expect(evs[0].onBeat).toBe(0.0);
  expect(evs[0].pitch).toBe(36);
});

test("block spanning the loop boundary returns tail + head with monotonic onBeats", function () {
  // Block [3.0, 5.0) spans the loop 0 -> loop 1 boundary at beat 4.
  //   tail of loop 0: offset 3.5 -> abs 3.5
  //   head of loop 1: offset 0.0 -> abs 4.0
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 3.0, 5.0);
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
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0.0, 8.0);
  expect(evs.length).toBe(8);
  for (var i = 1; i < evs.length; i++) {
    expect(evs[i].onBeat).toBeGreaterThan(evs[i - 1].onBeat);
  }
});

test("empty region returns []", function () {
  // A block with no events between offsets: [2.25, 3.25).
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 2.25, 3.25);
  expect(evs).toEqual([]);
});

test("zero-width block returns []", function () {
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 1.0, 1.0);
  expect(evs).toEqual([]);
});

test("every returned event satisfies offBeat === onBeat + length", function () {
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 0.0, 12.0);
  expect(evs.length).toBeGreaterThan(0);
  for (var i = 0; i < evs.length; i++) {
    var e = evs[i];
    // Recover the source event by matching absolute onBeat within its loop.
    var offsetInLoop = ((e.onBeat % TEST_LOOP) + TEST_LOOP) % TEST_LOOP;
    var src = null;
    for (var j = 0; j < TEST_PATTERN.length; j++) {
      if (TEST_PATTERN[j].offset === offsetInLoop && TEST_PATTERN[j].pitch === e.pitch) {
        src = TEST_PATTERN[j];
        break;
      }
    }
    expect(src).not.toBeNull();
    expect(e.offBeat).toBe(e.onBeat + src.length);
  }
});

test("non-positive loopBeats returns []", function () {
  expect(eventsInBlock(TEST_PATTERN, 0, 0.0, 4.0)).toEqual([]);
  expect(eventsInBlock(TEST_PATTERN, -4, 0.0, 4.0)).toEqual([]);
});

test("fractional block edges select correctly", function () {
  // Block [3.4, 3.6): only offset 3.5 qualifies.
  var evs = eventsInBlock(TEST_PATTERN, TEST_LOOP, 3.4, 3.6);
  expect(evs.length).toBe(1);
  expect(evs[0].onBeat).toBe(3.5);
  expect(evs[0].pitch).toBe(42);
});

test("offsets outside [0, loopBeats) are normalized into the loop (no silent drop)", function () {
  // offset 5.0 with loop 4 behaves like offset 1.0 (5 mod 4).
  var evs = eventsInBlock([{ offset: 5.0, pitch: 50, velocity: 80, length: 0.2 }], 4, 0.0, 4.0);
  expect(evs.length).toBe(1);
  expect(evs[0].onBeat).toBe(1.0);
  expect(evs[0].offBeat).toBe(1.2);
  // Negative offset wraps too: -1 mod 4 == 3.
  var evs2 = eventsInBlock([{ offset: -1.0, pitch: 50, velocity: 80, length: 0.2 }], 4, 0.0, 4.0);
  expect(evs2.length).toBe(1);
  expect(evs2[0].onBeat).toBe(3.0);
});
