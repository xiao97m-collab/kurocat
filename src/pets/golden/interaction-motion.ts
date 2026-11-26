type Phase = 'rest' | 'reach' | 'held' | 'center' | 'release' | 'fall' | 'asleep' | 'wake';
type Pose = { kind: 'rest' } | { kind: 'reach' | 'gaze' | 'fall' | 'sleep' | 'wake'; value: number };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function createInteractionMotion() {
  let phase: Phase = 'rest';
  let progress = 0;
  let elapsed = 0;

  function enter(next: Phase, at = 0) {
    phase = next;
    progress = at;
    elapsed = 0;
  }

  return {
    reset() { enter('rest'); },
    step(dt: number, wantsMouse: boolean, wantsSleep: boolean, typing: boolean): Pose {
      const mouse = wantsMouse && !typing;
      const sleep = wantsSleep && !typing && !mouse;
      if (phase === 'rest') {
        if (mouse) enter('reach');
        else if (sleep) enter('fall');
        else return { kind: 'rest' };
      }
      elapsed += dt;
      switch (phase as Phase) {
        case 'reach':
        case 'release': {
          const leaving = phase === 'release';
          if (leaving && mouse) enter('reach', progress);
          else if (typing && !leaving) enter('release', progress);
          progress = clamp(progress + (phase === 'release'
            ? -dt / (typing ? 690 : 1570)
            : dt / 1510));
          if (progress >= 1) enter('held');
          else if (progress <= 0 && phase === 'release') {
            enter('rest');
            return { kind: 'rest' };
          }
          return { kind: 'reach', value: phase === 'held' ? 1 : progress };
        }
        case 'held':
        case 'center':
          if (mouse) {
            if (phase !== 'held') enter('held');
            return { kind: 'gaze', value: 1 };
          }
          if (phase === 'held') enter('center');
          if (elapsed >= 235) {
            enter('release', 1);
            return { kind: 'reach', value: 1 };
          }
          return { kind: 'gaze', value: 1 - elapsed / 235 };
        case 'fall':
          progress = clamp(progress + (sleep ? dt / 2680 : -dt / 1050));
          if (progress >= 1) enter('asleep');
          else if (progress <= 0 && !sleep) {
            enter('rest');
            return { kind: 'rest' };
          }
          return { kind: 'fall', value: phase === 'asleep' ? 1 : progress };
        case 'asleep':
          if (sleep) return { kind: 'sleep', value: elapsed };
          enter('wake');
          return { kind: 'wake', value: 0 };
        case 'wake':
          if (elapsed >= 2190) {
            enter('rest');
            return { kind: 'rest' };
          }
          return { kind: 'wake', value: elapsed / 2190 };
        default:
          return { kind: 'rest' };
      }
    },
  };
}
