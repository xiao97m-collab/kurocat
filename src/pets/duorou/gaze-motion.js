const clampDirection = x => Math.max(-1, Math.min(1, x));

function smoothstep(start, end, value) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function pointerGaze(x, y, inside, width, height) {
  const nearby = inside || (x >= 0 && x <= width && y >= height);
  const offset = x - 224;
  const down = nearby ? smoothstep(285, 372, y) * (1 - smoothstep(22, 104, Math.abs(offset))) : 0;
  return { direction: [clampDirection(offset / 124) * (1 - down), clampDirection((y - 149) / 119)], down, nearby };
}

function advance(position, velocity, target, seconds, frequency) {
  // Analytic critically damped response to a piecewise-constant mouse target.
  const decay = Math.exp(-frequency * seconds);
  for (let i = 0; i < 2; i++) {
    const goal = clampDirection(target[i]);
    const displacement = position[i] - goal;
    const slope = velocity[i] + frequency * displacement;
    position[i] = goal + (displacement + slope * seconds) * decay;
    velocity[i] = (velocity[i] - frequency * slope * seconds) * decay;
  }
}

export function createGazeController() {
  const eye = [0, 0], head = [0, 0];
  const eyeVelocity = [0, 0], headVelocity = [0, 0];
  return {
    step(dtMs, desiredDirection) {
      // A tab waking from suspension starts with one displayed frame.
      const seconds = (dtMs > 200 ? 1000 / 60 : Math.max(0, dtMs)) / 1000;
      advance(eye, eyeVelocity, desiredDirection, seconds, 36);
      advance(head, headVelocity, desiredDirection, seconds, 15);
      return {eye: eye.slice(), head: head.slice()};
    },
  };
}
