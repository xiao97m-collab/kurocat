import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let KuroCatEngine;
let resolveKeyByVk;
let now;

before(async () => {
  globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  vite = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
  });
  ({ KuroCatEngine } = await vite.ssrLoadModule('/src/catEngine.ts'));
  ({ resolveKeyByVk } = await vite.ssrLoadModule('/src/keyboardLayout.ts'));
});

after(async () => {
  delete performance.now;
  delete globalThis.window;
  await vite?.close();
});

function replay(layout = '65', orientation = 'cat') {
  now = 10_000;
  const cat = new KuroCatEngine({ getContext: () => ({}) }, { embedded: true });
  cat.setKeyboardConfig(layout, orientation);

  function wait(ms) {
    const end = now + ms;
    while (now < end) {
      const step = Math.min(10, end - now);
      now += step;
      cat.update(step / 1000, now);
    }
  }

  function tap(vk, advance = 100) {
    wait(advance);
    cat.onKeyDown(vk, false);
    cat.onKeyUp(vk);
  }

  return { cat, tap, wait };
}

test('auto sleep ignores one-pixel jitter and wakes through normal input events', () => {
  const { cat, tap, wait } = replay();
  cat.onGlobalMouseMove(.5, .5, 100, 100);
  wait(27_999);
  assert.equal(cat.sleepStartedAt, null);
  assert.equal(cat.onGlobalMouseMove(.501, .499, 101, 99), false);

  wait(1);
  assert.equal(cat.sleepStartedAt, now);
  wait(650);
  assert.ok(cat.sleepDepth > .9);
  assert.equal(cat.onGlobalMouseMove(.502, .499, 102, 99), true);
  wait(10);
  assert.equal(cat.sleepStartedAt, null);

  wait(28_000);
  assert.notEqual(cat.sleepStartedAt, null);
  tap(0x41, 0);
  wait(10);
  assert.equal(cat.sleepStartedAt, null);
  assert.equal(cat.rightPaw.mode, 'poke');

  wait(28_000);
  assert.notEqual(cat.sleepStartedAt, null);
  cat.onMouseWheel();
  wait(10);
  assert.equal(cat.sleepStartedAt, null);
});

test('holding a key or mouse button keeps the pet awake', () => {
  const { cat, wait } = replay();
  cat.onMouseDown('left');
  wait(29_000);
  assert.equal(cat.sleepStartedAt, null);
  cat.onMouseUp('left');
  wait(27_999);
  assert.equal(cat.sleepStartedAt, null);
  wait(1);
  assert.equal(cat.sleepStartedAt, now);

  cat.onKeyDown(0x41, false);
  wait(29_000);
  assert.equal(cat.sleepStartedAt, null);
  cat.onKeyUp(0x41);
  wait(28_000);
  assert.equal(cat.sleepStartedAt, now);
});

test('only valid taps trigger fast typing, then a second paw assists and settles', () => {
  const { cat, tap, wait } = replay();
  tap(0x20);
  assert.equal(cat.rightPaw.mode, 'poke');
  tap(0x20, 350);
  assert.equal(cat.leftPaw.mode, 'poke');

  wait(900);
  cat.onKeyDown(0x41, false);
  for (let i = 0; i < 8; i++) {
    wait(50);
    cat.onKeyDown(0x41, true);
    tap(0xa0, 0);
  }
  cat.onKeyUp(0x41);
  assert.equal(cat.recentKeyTimes.length, 1);
  assert.equal(cat.fastTyping, false);

  for (let i = 0; i < 4; i++) tap(0x41);
  assert.equal(cat.fastTyping, true);
  assert.equal(cat.leftPaw.lastKeyStrikeAt, now);
  assert.ok(cat.rightPaw.lastKeyStrikeAt < now);
  tap(0x57);
  assert.equal(cat.rightPaw.lastKeyStrikeAt, now);
  wait(40);
  assert.equal(cat.leftPaw.mode, 'poke');
  assert.equal(cat.rightPaw.mode, 'poke');
  wait(500);
  assert.equal(cat.recentKeyTimes.length, 3);
  assert.equal(cat.fastTyping, true);
  wait(70);
  assert.equal(cat.fastTyping, false);
  wait(200);
  assert.equal(cat.leftPaw.mode, 'idle');
  assert.equal(cat.rightPaw.mode, 'idle');
});

test('mouse movement, button holds, release and scrolling reserve the mouse paw', () => {
  const { cat, tap, wait } = replay();
  cat.onGlobalMouseMove(0.55, 0.5);
  tap(0x41);
  assert.equal(cat.leftPaw.mode, 'mouse');
  assert.equal(cat.rightPaw.mode, 'poke');
  assert.equal(cat.tailStrike, null);

  wait(350);
  cat.onMouseDown('middle');
  for (let i = 0; i < 6; i++) tap(0x41);
  assert.equal(cat.leftPaw.mode, 'mouse');
  assert.equal(cat.rightPaw.lastKeyStrikeAt, now);
  assert.equal(cat.tailStrike, null);
  cat.onMouseUp('middle');
  wait(319);
  assert.equal(cat.leftPaw.mode, 'mouse');
  wait(1);
  assert.notEqual(cat.leftPaw.mode, 'mouse');
  cat.onMouseWheel();
  tap(0x41, 0);
  assert.equal(cat.leftPaw.mode, 'mouse');
  assert.equal(cat.tailStrike, null);
});

for (const [layout, orientation, near, far] of [
  ['65', 'cat', 0x41, 0x50],
  ['65', 'viewer', 0x4c, 0x41],
  ['108', 'cat', 0x46, 0x41],
  ['108', 'viewer', 0x2e, 0x41],
]) {
  test(`${layout} ${orientation}: tail reaches the correct key, cools down and resets`, () => {
    const { cat, tap, wait } = replay(layout, orientation);
    cat.showKeyBubbles = false;
    for (let i = 0; i < 4; i++) tap(near);
    cat.onGlobalMouseMove(0.6, 0.5);
    tap(far, 40);
    assert.equal(cat.tailStrike, null);
    assert.equal(cat.rightPaw.lastKeyStrikeAt, now);
    tap(near, 40);

    const key = resolveKeyByVk(near, layout);
    const strike = cat.tailStrike;
    assert.ok(strike);
    assert.equal(strike.keyId, key.id);
    assert.deepEqual(strike.target, cat.projectKeyboardPoint(
      key.uStart + key.uWidth / 2,
      (key.rowY ?? key.row) + (key.rowSpan ?? 1) / 2,
    ));
    assert.equal(cat.keyAnims.get(key.id).pressAmount, 1);
    assert.equal(cat.bubbles.length, 0);
    assert.ok(cat.rightPaw.lastKeyStrikeAt < now);
    assert.equal(cat.leftPaw.mode, 'mouse');

    wait(90);
    assert.equal(strike.reach, 1);
    wait(20);
    assert.equal(strike.pressure, 1);
    wait(100);
    assert.ok(strike.reach > 0 && strike.reach < 1);
    assert.equal(strike.pressure, 0);
    wait(70);
    assert.equal(cat.tailStrike, null);

    cat.onGlobalMouseMove(0.4, 0.5);
    tap(near, 169);
    assert.equal(cat.tailStrike, null);
    tap(near, 1);
    assert.ok(cat.tailStrike);
    cat.setKeyboardConfig(layout, orientation === 'cat' ? 'viewer' : 'cat');
    assert.equal(cat.tailStrike, null);
  });
}
