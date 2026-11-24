const hands = ['left', 'right'];
const reachTime = 86;
const touchTime = 38;
const returnTime = 74;
const bridgeTime = 80;
const quickReach = 52;
const quickTouch = 28;
const quickReturn = 40;
const quickInterval = 125;
const torsoPerCycle = 12;
const smooth = t => t * t * (3 - 2 * t);
const limit = t => Math.max(0, Math.min(1, t));
const wrap = (value, period) => (value % period + period) % period;
const poseIndex = (poses, progress) => Math.min(poses.length - 1, Math.floor(progress * poses.length));

export function createDualPaws(pages, take, bridgeImage, data, width, height) {
  const { clips, masks, cell, columns, rows, tileScale, torso, bridge } = data;
  const [tileW, tileH] = cell;
  const capacity = columns * rows;
  const body = document.createElement('canvas');
  body.width = width * 2;
  body.height = height * 2;
  const local = body.getContext('2d');
  const slots = { left: null, right: null };
  const pending = { left: null, right: null };
  let bridgeProgress = 0;
  let phase = 0;
  let clock = 0;
  let lastKeyAt = -Infinity;

  function stamp(ctx, entry) {
    if (!entry) return;
    const [id, x, y] = entry;
    const index = id % capacity;
    ctx.drawImage(pages[Math.floor(id / capacity)], index % columns * tileW, Math.floor(index / columns) * tileH,
      tileW, tileH, x, y, tileW / tileScale, tileH / tileScale);
  }

  function hasWork() {
    return hands.some(hand => slots[hand] || pending[hand]);
  }

  function accelerate(item) {
    if (!item) return;
    item.quick = true;
    const faster = item.stage === 'reach' ? quickReach : item.stage === 'touch' ? quickTouch : quickReturn;
    if (faster < item.duration) {
      item.elapsed *= faster / item.duration;
      item.duration = faster;
    }
  }

  function state() {
    return hands.flatMap(hand => {
      const item = slots[hand];
      if (!item) return [];
      const clip = clips[item.key];
      const touch = item.stage === 'touch';
      const releasing = item.stage === 'return';
      const progress = touch ? 1 : releasing ?
        1 - limit(item.elapsed / item.duration) : limit(item.elapsed / item.duration);
      const poses = releasing ? clip.retract : clip.poses;
      const index = poseIndex(poses, releasing ? 1 - progress : progress);
      return [{ hand, key: item.key, progress, index, pose: poses[index], touch, alpha: smooth(limit(progress * 5)) }];
    });
  }

  function compose(ctx, base) {
    local.setTransform(2, 0, 0, 2, 0, 0);
    local.clearRect(0, 0, width, height);
    base(local);
    for (const { hand, pose, alpha } of state()) {
      local.save();
      local.globalAlpha = alpha;
      local.globalCompositeOperation = 'destination-out';
      stamp(local, masks[hand]);
      local.globalCompositeOperation = 'lighter';
      stamp(local, pose.body);
      local.restore();
    }
    ctx.drawImage(body, 0, 0, width, height);
  }

  return {
    supports: key => Object.hasOwn(clips, key),
    handOf: key => clips[key].hand,
    busy: hasWork,
    posed: () => bridgeProgress > 0,
    finishForMouse() {
      for (const hand of hands) {
        pending[hand] = null;
        accelerate(slots[hand]);
      }
    },
    push(key, now = clock) {
      const hand = clips[key].hand;
      const quick = now - lastKeyAt <= quickInterval;
      lastKeyAt = now;
      const active = slots[hand];
      accelerate(active);
      if (active?.stage === 'reach' && active.elapsed < active.duration * .4) {
        // The early reach is still near the resting paw, where retargeting is least visible.
        active.key = key;
        active.requestedAt = now;
        pending[hand] = null;
      } else {
        pending[hand] = { key, quick: quick || Boolean(active), requestedAt: now };
      }
    },
    step(dt, onContact, stayDown = false, now = clock + dt) {
      clock = now;
      for (const hand of hands) {
        const item = slots[hand];
        const next = pending[hand];
        if (item) {
          item.elapsed += dt;
          item.clock += dt;
          if (item.stage === 'reach' && item.elapsed >= item.duration) {
            // Start contact on a rendered frame, even when a slow frame overshoots the reach.
            item.stage = 'touch';
            item.elapsed = 0;
            item.duration = item.quick ? quickTouch : touchTime;
            onContact(item.key, hand, now - item.requestedAt);
          } else if (item.stage === 'touch' && item.elapsed >= item.duration) {
            item.stage = 'return';
            item.elapsed -= item.duration;
            item.duration = item.quick || next ? quickReturn : returnTime;
          } else if (item.stage === 'return' && item.elapsed >= item.duration) {
            slots[hand] = null;
          }
        }
        if (!slots[hand] && next) {
          const age = Math.max(0, now - next.requestedAt);
          const quick = next.quick || age >= 50;
          slots[hand] = { ...next, quick, stage: 'reach', duration: quick ? quickReach : reachTime,
            elapsed: Math.min(dt, age), clock: 0 };
          pending[hand] = null;
        }
      }

      const driver = hands.filter(hand => slots[hand]).sort((a, b) => slots[a].clock - slots[b].clock)[0];
      const target = driver ? (driver === 'right' ? 0.5 : 0) + slots[driver].clock / 332 : 0;
      const error = wrap(target - phase + 0.5, 1) - 0.5;
      phase = wrap(phase + error * Math.min(1, dt / 46), torso.frames.length / torsoPerCycle);
      const stillStriking = hands.some(hand => pending[hand] || (slots[hand] && slots[hand].stage !== 'return'));
      if (stillStriking) bridgeProgress = limit(bridgeProgress + dt / bridgeTime);
      else if (!stayDown) bridgeProgress = limit(bridgeProgress - dt / bridgeTime);
      else if (!hasWork()) bridgeProgress = 0;
    },
    drawBody(ctx, rest) {
      if (bridgeProgress === 0) {
        compose(ctx, target => target.drawImage(rest, 0, 0, width, height));
        return;
      }
      const entering = bridgeProgress < 1;
      const atlas = entering ? bridge : torso;
      const frame = entering ? poseIndex(bridge.frames, smooth(bridgeProgress)) :
        wrap(Math.round(phase * torsoPerCycle), torso.frames.length);
      const [w, h] = atlas.size;
      compose(ctx, target => target.drawImage(entering ? bridgeImage : take, (frame % atlas.columns) * w * 2,
        Math.floor(frame / atlas.columns) * h * 2, w * 2, h * 2, ...atlas.origin, w, h));
    },
    drawOn(ctx, source) {
      compose(ctx, target => target.drawImage(source, 0, 0, width, height));
    },
    drawFront(ctx) {
      // Forearms crossing the keyboard rim keep their original opacity.
      for (const { pose, alpha } of state()) {
        if (alpha > 0) stamp(ctx, pose.front);
      }
    },
    snapshot() {
      return state().map(({ hand, key, progress, index, touch, pose }) =>
        ({ hand, key, progress, index, touch, source: pose.source }));
    },
  };
}
