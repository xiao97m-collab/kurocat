import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { createDualPaws } from '../src/pets/duorou/dual-paws.js';

const { dualPaws } = JSON.parse(readFileSync(new URL('../src/pets/duorou/assets/frames.json', import.meta.url)));
let vite;
let keys;

before(async () => {
  vite = await createServer({ configFile: false, appType: 'custom', server: { middlewareMode: true, ws: false } });
  ({ KEYBOARD_KEYS_65: keys } = await vite.ssrLoadModule('/src/keyboardLayout.ts'));
});

after(async () => { await vite?.close(); });

function replay() {
  globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
  const paws = createDualPaws([], {}, {}, dualPaws, 420, 440);
  delete globalThis.document;
  const contacts = [];
  const step = dt => paws.step(dt, (key, hand) => contacts.push({ key, hand }));
  return { paws, contacts, step };
}

test('every visible 65% key has a landing sprite inside its projected keycap', () => {
  assert.deepEqual(Object.keys(dualPaws.clips).sort(), keys.map(key => key.id).sort());
  for (const [id, clip] of Object.entries(dualPaws.clips)) {
    assert.ok(clip.poses.at(-1).front, id);
    const [x, y] = clip.tip;
    const edges = clip.polygon.map(([ax, ay], i) => {
      const [bx, by] = clip.polygon[(i + 1) % clip.polygon.length];
      return (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    });
    assert.ok(edges.every(d => d >= 0) || edges.every(d => d <= 0), id);
  }
});

test('each isolated press shows the final contact frame and returns through the centered bridge', () => {
  for (const dt of [1000 / 60, 34]) {
    const { paws, contacts, step } = replay();
    for (const { id } of keys) {
      const before = contacts.length;
      paws.push(id);
      let held = 0;
      for (let f = 0; f < 28; ++f) {
        step(dt);
        const pose = paws.snapshot()[0];
        if (pose?.touch) {
          ++held;
          assert.equal(pose.key, id);
          assert.equal(pose.progress, 1);
          assert.equal(pose.source, dualPaws.clips[id].poses.at(-1).source);
          assert.ok(paws.posed());
        }
      }
      assert.ok(held >= 2, id);
      assert.equal(contacts.length, before + 1);
      assert.equal(contacts.at(-1).key, id);
      assert.equal(paws.posed(), false);
    }
  }
});

test('typing returns through the same resting frame that the idle painter uses', () => {
  const rest = {};
  const samples = [];
  const local = {
    clearRect() {},
    setTransform() {},
    drawImage(image) { samples.push(image); },
  };
  globalThis.document = { createElement: () => ({ getContext: () => local }) };
  const paws = createDualPaws([], {}, {}, dualPaws, 420, 440);
  delete globalThis.document;

  paws.push('a');
  for (let frame = 0; frame < 20 && paws.busy(); ++frame) paws.step(1000 / 60, () => {});
  for (let frame = 0; frame < 12 && paws.posed(); ++frame) {
    paws.drawBody({ drawImage() {} }, rest);
    paws.step(1000 / 60, () => {});
  }

  assert.equal(paws.posed(), false);
  paws.drawBody({ drawImage() {} }, rest);
  assert.equal(samples.at(-1), rest);
});

test('very close same-paw presses merge the early reach and still land on the newest key', () => {
  const { paws, contacts, step } = replay();
  for (const key of ['u', 'i', 'o']) {
    assert.equal(paws.handOf(key), paws.handOf('u'));
    paws.push(key);
    step(16);
    step(16);
  }
  for (let i = 0; i < 100; ++i) step(16);
  assert.deepEqual(contacts.map(contact => contact.key), ['i', 'o']);
});

test('sustained fast alternating typing hits every key while both paws overlap', () => {
  const { paws, contacts, step } = replay();
  const sequence = Array.from({ length: 48 }, (_, i) => i % 2 ? 'a' : 'o');
  let overlaps = 0;
  for (let frame = 0; frame < sequence.length * 6 + 60; ++frame) {
    if (frame % 6 === 0 && frame / 6 < sequence.length) paws.push(sequence[frame / 6]);
    step(1000 / 60);
    if (paws.snapshot().length === 2) ++overlaps;
  }
  assert.ok(overlaps > sequence.length);
  for (const key of ['a', 'o']) assert.equal(contacts.filter(contact => contact.key === key).length, 24);
  assert.equal(paws.posed(), false);
});

test('fast same-paw and alternating bursts end within 250 ms of the last release', () => {
  const held = JSON.parse(readFileSync(new URL('../src/pets/duorou/assets/held-paws.json', import.meta.url)));
  for (const dt of [1000 / 60, 1000 / 30]) {
    for (const [sequence, interval, count, holdingMouse] of [
      [['u'], 100, 1, false],
      [['a', 'o'], 100, 10, false],
      [['a', 'o'], 80, 10, false],
      [['u', 'i', 'o'], 100, 5, false],
      [['u', 'i', 'o'], 100, 10, false],
      [['a', 'j', 'esc'], 100, 10, true],
      [['u', 'i', 'o'], 30, 14, false],
    ]) {
      globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
      const paws = createDualPaws([], {}, {}, holdingMouse ? { ...dualPaws, ...held } : dualPaws, 420, 440);
      delete globalThis.document;
      const releasedAt = (count - 1) * interval + 20;
      const seen = [];
      let next = 0;
      let end;
      for (let frame = 0; frame * dt < 4000; ++frame) {
        const now = frame * dt;
        while (next < count && next * interval <= now + .001) {
          paws.push(sequence[next % sequence.length], next * interval);
          ++next;
        }
        paws.step(dt, (key, _hand, age) => seen.push({ key, requestedAt: now - age }), holdingMouse, now);
        if (next === count && !paws.busy() && !paws.posed()) {
          end = now;
          break;
        }
      }
      const scenario = `${sequence.join('/')} at ${interval} ms with ${Math.round(1000 / dt)} FPS`;
      assert.ok(seen.some(({ key, requestedAt }) =>
        key === sequence[(count - 1) % sequence.length] && Math.abs(requestedAt + 20 - releasedAt) < .01), scenario);
      assert.ok(end - releasedAt <= 250, `${scenario}: ${Math.round(end - releasedAt)} ms`);
    }
  }
});

test('a key typed as the mouse paw takes over does not wait behind a full regular strike', () => {
  const held = JSON.parse(readFileSync(new URL('../src/pets/duorou/assets/held-paws.json', import.meta.url)));
  for (const dt of [1000 / 60, 1000 / 30]) {
    for (const switchAt of [30, 50, 60, 80, 115, 150]) {
      globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };
      const plain = createDualPaws([], {}, {}, dualPaws, 420, 440);
      const heldPaws = createDualPaws([], {}, {}, { ...dualPaws, ...held }, 420, 440);
      delete globalThis.document;
      plain.push('a', 0);
      const seen = [];
      let switched = false;
      let end;
      for (let frame = 0; frame < 90; ++frame) {
        const now = frame * dt;
        if (!switched && now >= switchAt) {
          plain.finishForMouse();
          heldPaws.push('j', switchAt);
          switched = true;
        }
        plain.step(dt, () => {}, false, now);
        if (switched && !plain.busy() && !plain.posed()) {
          heldPaws.step(dt, key => seen.push(key), true, now);
          if (!heldPaws.busy() && !heldPaws.posed()) {
            end = now;
            break;
          }
        }
      }
      assert.deepEqual(seen, ['j']);
      assert.ok(end - switchAt - 20 <= 250, `${dt} ms frame, switch at ${switchAt} ms: ${end - switchAt - 20} ms`);
    }
  }
});
