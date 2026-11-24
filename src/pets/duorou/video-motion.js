export function createVideoAtlas(pages, data) {
  const { columns, rows, cell: [w, h], size, origin, frames, alignment } = data;
  const capacity = columns * rows;
  const indices = new Map(frames.map((frame, i) => [frame, i]));
  return {
    draw(ctx, frame) {
      const id = indices.get(frame);
      const tile = id % capacity;
      let [x, y] = origin;
      let [width, height] = size;
      if (alignment) {
        const { start, end, scale: [sx, sy], shift: [dx, dy] } = alignment;
        const progress = Math.min(1, id / start, (frames.length - 1 - id) / (frames.length - 1 - end));
        const weight = progress * progress * (3 - 2 * progress);
        const scaleX = 1 + weight * (sx - 1);
        const scaleY = 1 + weight * (sy - 1);
        x = scaleX * x + weight * dx;
        y = scaleY * y + weight * dy;
        width *= scaleX;
        height *= scaleY;
      }
      ctx.drawImage(pages[Math.floor(id / capacity)], (tile % columns) * w,
        Math.floor(tile / columns) * h, w, h, x, y, width, height);
    },
  };
}

const idleActionDelay = 10_000;

export function createIdleActions(clips) {
  let lastActivity = null;
  let nextAt = 0;
  let active = null;
  let nextClip = 0;

  return {
    step(now, idleSince, eligible, resting, mayStart = true) {
      if (lastActivity !== idleSince || !eligible) {
        lastActivity = idleSince;
        nextAt = idleSince + idleActionDelay;
        active = null;
      }
      if (!eligible || now < nextAt) return null;

      if (!active) {
        if (!mayStart) return null;
        // Let breathing return to the shared resting pose before the clip starts.
        if (!resting) return { clip: nextClip, frame: null };
        active = { clip: nextClip, start: now };
        nextClip = (nextClip + 1) % clips.length;
      }

      const { frames, fps } = clips[active.clip];
      const index = Math.floor((now - active.start) * fps / 1000);
      if (index < frames.length) return { clip: active.clip, frame: frames[index] };

      active = null;
      nextAt = now + idleActionDelay;
      return null;
    },
  };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const wrap = (x, n) => ((x % n) + n) % n;

export function createMouseClickMotion() {
  let release = 0;
  let paw = 0;
  return {
    press() {
      const impulse = Math.min(1, 1.4 - release);
      release += impulse;
      paw += impulse;
    },
    step(dt) {
      release *= Math.exp(-dt / 55);
      paw *= Math.exp(-dt / 10);
      return release - paw;
    },
  };
}

export function createHeldLook(data) {
  const frames = data.frames.filter(frame => frame >= 24);
  const stations = data.landmarks.filter(([frame]) => frame >= 24).map(([frame, x, y]) => ({
    x, y, index: frames.reduce((best, p, i) => Math.abs(p - frame) < Math.abs(frames[best] - frame) ? i : best, 0),
  }));
  let index = 0;
  let budget = 0;
  let goal = 0;
  return {
    step(dt, x, y) {
      const n = frames.length - 1;
      if (Math.hypot(x, y) < .14) goal = 0;
      else {
        let best = Infinity;
        for (const pose of stations) {
          const distance = (x - pose.x) ** 2 + (y - pose.y) ** 2;
          if (distance < best) {
            best = distance;
            goal = pose.index % n;
          }
        }
      }
      if (index === goal) budget = 0;
      else {
        budget += dt;
        const distance = wrap(goal - index + n / 2, n) - n / 2;
        const returnToFront = frames[index] >= 179;
        if (budget >= (returnToFront ? 30 : 19)) {
          index = wrap(index + Math.sign(distance), n);
          budget = 0;
        }
      }
      return frames[index];
    },
    centered: () => index === 0,
  };
}

export function createRestMotion(data) {
  let phase = 'start';
  let cursor = 0;
  let reverse = false;
  let clock = 0;

  function select(next, at = 0) {
    phase = next;
    cursor = at;
    reverse = false;
    clock = 0;
  }

  return {
    step(dt, intent) {
      const active = intent !== null;
      const wantsClosed = intent === 'hover' || intent === 'sleep';
      if (phase === 'start' && !active && cursor === 0) return 0;

      clock += dt;
      const interval = !active ? 18 : phase === 'closed' ? 84 : phase === 'breathe' ? 60 : 34;
      if (phase === 'closed' && !wantsClosed) select('open');
      else if (phase === 'breathe' && intent === null) select('start', data.start.length - 1);
      else if (phase === 'breathe' && wantsClosed) select('close');
      else if (clock >= interval) {
        clock = 0;
        const end = data[phase].length - 1;
        switch (phase) {
          case 'start':
            cursor = clamp(cursor + (active ? 1 : -2), 0, end);
            if (active && cursor === end) select(wantsClosed ? 'close' : 'breathe');
            break;
          case 'breathe':
            if (cursor === end) reverse = true;
            if (cursor === 0) reverse = false;
            cursor += reverse ? -1 : 1;
            break;
          case 'close':
            cursor = clamp(cursor + (wantsClosed ? 1 : -2), 0, end);
            if (wantsClosed && cursor === end) select('closed');
            else if (!wantsClosed && cursor === 0) select(active ? 'breathe' : 'start', active ? 0 : data.start.length - 1);
            break;
          case 'closed':
            if (cursor === end) reverse = true;
            if (cursor === 0) reverse = false;
            cursor += reverse ? -1 : 1;
            break;
          case 'open':
            cursor = Math.min(cursor + (active ? 1 : 2), end);
            if (cursor === end) select(active ? 'breathe' : 'start', active ? 0 : data.start.length - 1);
            break;
        }
      }
      return data[phase][cursor];
    },
  };
}
