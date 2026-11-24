import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDualPaws } from '../src/pets/duorou/dual-paws.js';
import { createHeldLook, createIdleActions, createMouseClickMotion, createRestMotion, createVideoAtlas } from '../src/pets/duorou/video-motion.js';

function asset(name) {
  return JSON.parse(readFileSync(new URL(`../src/pets/duorou/assets/${name}.json`, import.meta.url)));
}

test('idle clip alignment eases off at the shared resting pose without moving the atlas crop', () => {
  const page = {};
  const atlas = createVideoAtlas([page], {
    columns: 7, rows: 1, cell: [100, 200], origin: [8, 16], size: [40, 80],
    frames: [0, 1, 2, 3, 4, 5, 6],
    alignment: { start: 2, end: 4, scale: [.9, 1.1], shift: [2, -7] },
  });
  const calls = [];
  const ctx = { drawImage: (...args) => calls.push(args) };
  for (const frame of [0, 1, 3, 6]) atlas.draw(ctx, frame);
  assert.deepEqual(calls.map(args => args.slice(0, 5)), [0, 1, 3, 6].map(i => [page, 100 * i, 0, 100, 200]));
  assert.deepEqual(calls[0].slice(5), [8, 16, 40, 80]);
  assert.deepEqual(calls[3].slice(5), calls[0].slice(5));
  assert.deepEqual(calls[1].slice(5).map(n => +n.toFixed(3)), [8.6, 13.3, 38, 84]);
  assert.deepEqual(calls[2].slice(5).map(n => +n.toFixed(3)), [9.2, 10.6, 36, 88]);
});

test('idle actions wait for the resting pose and alternate after ten quiet seconds', () => {
  const actions = createIdleActions([{ frames: [0, 1, 2], fps: 20 }, { frames: [0, 1], fps: 20 }]);

  assert.equal(actions.step(9999, 0, true, 0), null);
  assert.deepEqual(actions.step(10000, 0, true, 18), { clip: 0, frame: null });
  assert.deepEqual(actions.step(10100, 0, true, 0), { clip: 0, frame: 0 });
  assert.deepEqual(actions.step(10150, 0, true, 0), { clip: 0, frame: 1 });
  assert.deepEqual(actions.step(10200, 0, true, 0), { clip: 0, frame: 2 });
  assert.equal(actions.step(10250, 0, true, 0), null);
  assert.equal(actions.step(20249, 0, true, 0), null);
  assert.deepEqual(actions.step(20250, 0, true, 0), { clip: 1, frame: 0 });
  assert.equal(actions.step(20280, 20280, false, 0), null);
  assert.equal(actions.step(30279, 20280, true, 0), null);
  assert.deepEqual(actions.step(30280, 20280, true, 0), { clip: 0, frame: 0 });
  assert.equal(actions.step(30300, 30300, true, 0), null);
});

test('sleep lets the current idle action finish and defers the next action until after waking', () => {
  const actions = createIdleActions([{ frames: [0, 1, 2], fps: 10 }, { frames: [0], fps: 10 }]);
  assert.deepEqual(actions.step(10_000, 0, true, 0), { clip: 0, frame: 0 });
  assert.deepEqual(actions.step(10_100, 0, true, 18, false), { clip: 0, frame: 1 });
  assert.equal(actions.step(10_300, 0, true, 18, false), null);
  assert.equal(actions.step(30_000, 0, true, 0, false), null);
  assert.equal(actions.step(31_000, 31_000, true, 0), null);
  assert.deepEqual(actions.step(41_000, 31_000, true, 0), { clip: 1, frame: 0 });
});

test('the look-around waits for its breathing frame without restarting the resting pose', () => {
  const { rest, approvedIdle } = asset('video-scenes');
  const entry = rest.breathe[0];
  const actions = createIdleActions([approvedIdle.look, approvedIdle.pat], entry);

  assert.equal(actions.step(9999, 0, true, entry), null);
  assert.equal(actions.step(10_000, 0, true, rest.breathe[1]), null);
  assert.equal(actions.step(10_060, 0, true, 0), null);
  assert.deepEqual(actions.step(10_120, 0, true, entry), { clip: 0, frame: 0 });
  assert.deepEqual(actions.step(10_150, 0, true, 0), { clip: 0, frame: 0 });
  assert.deepEqual(actions.step(10_165, 0, true, 0), { clip: 0, frame: 1 });
});

test('both idle actions resume breathing directly even if a render crosses the last slot', () => {
  const { rest, approvedIdle } = asset('video-scenes');
  const breathingFrame = rest.breathe[0];

  for (const clip of [approvedIdle.look, approvedIdle.pat]) {
    const start = 10_000;
    const entry = clip.startFromBreathing ? breathingFrame : 0;
    const frameTime = 1000 / clip.fps;
    const end = start + (clip.frames.length - 1) * frameTime;

    for (const delay of [1, 2 * frameTime]) {
      const actions = createIdleActions([clip], breathingFrame);
      const motion = createRestMotion(rest);
      assert.deepEqual(actions.step(start, 0, true, entry), { clip: 0, frame: clip.frames[0] });
      assert.deepEqual(actions.step(end - frameTime / 2, 0, true, 0), { clip: 0, frame: clip.frames.at(-2) });
      assert.deepEqual(actions.step(end + delay, 0, true, 0), { clip: 0, frame: null, resumeBreathing: true });
      assert.equal(actions.step(end + delay + 16, 0, true, breathingFrame), null);
      assert.equal(motion.resumeBreathing(), breathingFrame);
      assert.equal(motion.step(33, 'idle'), breathingFrame);
      assert.equal(motion.step(33, 'idle'), rest.breathe[1]);
    }

    const interrupted = createIdleActions([clip], breathingFrame);
    interrupted.step(start, 0, true, entry);
    assert.equal(interrupted.step(end + 1, end + 1, false, 0), null);
  }
});

test('each rapid click presses the paw before it settles', () => {
  const motion = createMouseClickMotion();
  let previous = motion.step(0);
  for (let click = 0; click < 14; click += 1) {
    motion.press();
    const response = motion.step(16);
    assert.ok(response > previous + .3);
    previous = motion.step(64);
    assert.ok(previous < response);
  }
  const settled = motion.step(600);
  assert.ok(settled < .001);
});

test('the recorded idle, hover and wake states use the intended source frames', () => {
  const { rest } = asset('video-scenes');
  const pose = createRestMotion(rest);
  const replay = (intent, count) => Array.from({ length: count }, () => pose.step(1000 / 60, intent));
  const idle = replay('idle', 120);
  assert.ok(idle.some(frame => rest.breathe.includes(frame)));
  assert.ok(idle.every(frame => !rest.closed.includes(frame)));
  const hover = replay('hover', 130);
  assert.ok(hover.some(frame => rest.close.includes(frame)));
  assert.ok(hover.slice(-30).every(frame => rest.closed.includes(frame)));
  const wake = replay(null, 65);
  assert.ok(wake.some(frame => rest.open.includes(frame)));
  assert.equal(wake.at(-1), 0);
  assert.ok([...idle, ...hover, ...wake].every(frame => rest.frames.includes(frame)));
});

test('sleep closes the eyes and resumes the recorded wake motion when input returns', () => {
  const { rest } = asset('video-scenes');
  const pose = createRestMotion(rest);
  const sleep = Array.from({ length: 85 }, () => pose.step(34, 'sleep'));
  assert.ok(sleep.slice(-20).every(frame => rest.closed.includes(frame)));
  const wake = Array.from({ length: 35 }, () => pose.step(18, null));
  assert.ok(wake.some(frame => rest.open.includes(frame)));
  assert.equal(wake.at(-1), 0);
});

test('held gaze follows the recorded low arc through a centered nod without crossing the upright frames', () => {
  const { held } = asset('video-scenes');
  const pose = createHeldLook(held);
  const aim = (x, y) => Array.from({ length: 70 }, () => pose.step(1000 / 60, x, y));
  const right = aim(.71, .62).at(-1);
  const center = aim(0, 1);
  const left = aim(-.65, .83);
  assert.ok(Math.abs(right - 65) <= 2);
  assert.ok(Math.abs(center.at(-1) - 83) <= 2);
  assert.ok(Math.abs(left.at(-1) - 101) <= 2);
  const lowerArc = [right, ...center, ...left];
  assert.ok(lowerArc.slice(1).every((frame, i) => frame >= lowerArc[i] && frame - lowerArc[i] <= 3));
  aim(0, 0);
  assert.equal(pose.centered(), true);
});

test('every supported simultaneous key lands on its actual cap with the right paw', () => {
  const data = { ...asset('frames').dualPaws, ...asset('held-paws') };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
  const paws = createDualPaws([], {}, {}, data, 420, 440);
  globalThis.document = oldDocument;
  assert.ok(Object.keys(data.clips).length >= 30);
  assert.equal(paws.supports('bs'), false);
  for (const [key, clip] of Object.entries(data.clips)) {
    assert.equal(clip.hand, 'right');
    assert.ok(clip.poses.at(-1).front, key);
    const [x, y] = clip.tip;
    const edges = clip.polygon.map(([a, b], i) => {
      const [c, d] = clip.polygon[(i + 1) % clip.polygon.length];
      return (c - a) * (y - b) - (d - b) * (x - a);
    });
    assert.ok(edges.every(edge => edge >= 0) || edges.every(edge => edge <= 0), key);
    const contact = [];
    paws.push(key);
    for (let f = 0; f < 22; ++f) paws.step(34, (id, hand) => contact.push([id, hand]), true);
    assert.deepEqual(contact, [[key, 'right']]);
  }
});
