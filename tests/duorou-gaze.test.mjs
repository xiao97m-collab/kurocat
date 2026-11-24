import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { pointerGaze } from '../src/pets/duorou/gaze-motion.js';
import { createWholeGaze } from '../src/pets/duorou/whole-gaze.js';

const frames = JSON.parse(readFileSync(new URL('../src/pets/duorou/assets/frames.json', import.meta.url)));

test('the downward gaze enters and leaves through consecutive frames and holds under a stationary pointer', () => {
  globalThis.document = { createElement: () => ({ getContext: () => ({ clearRect() {}, drawImage() {} }) }) };
  const nod = frames.downGaze;
  const gaze = createWholeGaze([], frames.hdGaze, {}, nod);
  delete globalThis.document;
  let now = 1000;
  const draw = y => gaze.draw(0, y, now += 34);
  const trace = (y, length) => {
    const samples = [];
    for (let frame = 0; frame < length; ++frame) {
      draw(y);
      const pose = gaze.pose();
      if (pose.nod) samples.push(pose.ids[0]);
    }
    return samples;
  };
  draw(0);
  const descent = trace(1, 60);
  assert.equal(descent[0], 0);
  assert.equal(descent.at(-1), nod.frames.length - 1);
  assert.ok(descent.slice(1).every((frame, i) => frame - descent[i] >= 0 && frame - descent[i] <= 1));
  const hold = trace(1, 400);
  assert.equal(hold.length, 400);
  assert.ok(hold.every(frame => frame === nod.frames.length - 1));
  const rise = trace(0, 60);
  assert.equal(rise[0], nod.frames.length - 2);
  assert.ok(rise.slice(1).every((frame, i) => rise[i] - frame >= 0 && rise[i] - frame <= 1));
  assert.equal(gaze.pose().sourceFrames[0], 0);
});

test('the pointer keeps a continuous target across the lower window edge and across the bottom', () => {
  const target = (x, y) => pointerGaze(x, y, y <= 440, 420, 440);
  for (const y of [323, 324, 439, 440, 441, 565]) {
    const points = Array.from({ length: 169 }, (_, i) => target(140 + i, y));
    assert.ok(points.slice(1).every(({ direction, down }, i) =>
      Math.abs(direction[0] - points[i].direction[0]) < .02 && Math.abs(down - points[i].down) < .025));
  }
  for (const x of [152, 196, 224, 285]) {
    assert.deepEqual(target(x, 439), target(x, 441));
  }
  assert.deepEqual(target(224, 565), { direction: [0, 1], down: 1, nearby: true });
  assert.deepEqual(pointerGaze(425, 565, false, 420, 440), { direction: [1, 1], down: 0, nearby: false });
});
