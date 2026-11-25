import type { KuroCatEngine } from '../catEngine';
import { resolveKeyByVk, type KeyboardLayoutId } from '../keyboardLayout';
import blackCompact from './landing-assets/black-65.webp';
import blackFull from './landing-assets/black-108.webp';
import corgiCompact from './landing-assets/corgi-65.webp';
import corgiFull from './landing-assets/corgi-108.webp';
import frames from './landing-assets/frames.json';

type LandingBreed = 'black' | 'corgi';
type Pose = keyof (typeof frames)['black-65'];
type AtlasKey = keyof typeof frames;

interface LandingAtlas {
  image: HTMLImageElement;
  frames: (typeof frames)[AtlasKey];
}

const urls: Record<AtlasKey, string> = {
  'black-65': blackCompact,
  'black-108': blackFull,
  'corgi-65': corgiCompact,
  'corgi-108': corgiFull,
};

const atlases = new Map<AtlasKey, Promise<LandingAtlas>>();

export function isLandingBreed(breed: string): breed is LandingBreed {
  return breed === 'black' || breed === 'corgi';
}

export function loadLandingAtlas(breed: LandingBreed, layout: KeyboardLayoutId): Promise<LandingAtlas> {
  const id: AtlasKey = `${breed}-${layout}`;
  let cached = atlases.get(id);
  if (!cached) {
    const image = new Image();
    image.src = urls[id];
    cached = image.decode().then(() => ({ image, frames: frames[id] })).catch(error => {
      atlases.delete(id);
      throw error;
    });
    atlases.set(id, cached);
  }
  return cached;
}

const fallDuration = 215;
const typingInAir = 100;
const tuckBeforeLanding = 193;
const typingOnDesk = 405;
const gear = [
  { item: 'mouse' as const, tilt: .17, restitution: .52, angles: [0, .28, -.16, 0], slides: [0, 14, -6, 0] },
  { item: 'keyboard' as const, tilt: -.11, restitution: .47, angles: [0, -.20, .11, 0], slides: [0, -16, 6, 0] },
].map(item => ({
  ...item,
  hops: [1, 2, 3].map(hop => 2 * fallDuration * item.restitution ** hop),
}));

const settled = fallDuration + Math.max(
  ...gear.map(item => item.hops.reduce((sum, hop) => sum + hop, 0)),
);
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (p: number) => p * p * (3 - 2 * p);

function rebound(item: (typeof gear)[number], time: number, drop: number) {
  const gravity = 2 * drop / fallDuration ** 2;
  for (const [i, duration] of item.hops.entries()) {
    if (time < duration) {
      const p = time / duration;
      return {
        x: mix(item.slides[i], item.slides[i + 1], p),
        y: -gravity * time * (duration - time) / 2,
        angle: mix(item.angles[i], item.angles[i + 1], p),
      };
    }
    time -= duration;
  }
  return { x: 0, y: 0, angle: 0 };
}

export function createLandingPainter(
  engine: KuroCatEngine,
  atlas: LandingAtlas,
  breed: LandingBreed,
  keys: number[],
  valid: () => boolean,
  shown: () => void,
  finish: () => void,
) {
  let start: number | undefined;
  let lastTap = -Infinity;
  let side: 'left' | 'right' = 'left';
  let braced = false;
  const wide = engine.keyboardLayout === '108';
  const corgi = breed === 'corgi';
  const drop = engine.getLogicalSize().h / 3;

  function drawSprite(
    ctx: CanvasRenderingContext2D,
    pose: Pose,
    shiftY = 0,
    sx = 1,
    sy = 1,
    rotation = 0,
    shiftX = 0,
  ) {
    const [sourceX, sourceY, x, y, width, height] = atlas.frames[pose];
    const pivotX = x + width / 2;
    const pivotY = y + height;
    ctx.save();
    ctx.translate(pivotX + shiftX, pivotY + shiftY);
    ctx.rotate(rotation);
    ctx.scale(sx, sy);
    engine.wardrobe.landing(engine.petSkin, corgi ? 'corgi' : 'cat', pose, wide, pivotX, pivotY, () => {
      ctx.drawImage(atlas.image, sourceX, sourceY, width, height, -width / 2, -height, width, height);
    });
    ctx.restore();
  }

  function drawBrace(ctx: CanvasRenderingContext2D, time: number) {
    if (time < 92) {
      const compression = time < 35
        ? mix(1.16, .94, ease(clamp(time / 35)))
        : mix(.94, 1, ease(clamp((time - 35) / 34)));
      drawSprite(ctx, time >= 47 && time < 72 ? 'flinch' : 'brace', 0, 1, compression);
      return;
    }

    const progress = ease(clamp((time - 92) / 88));
    // Match the resting face to the brace before easing it to the normal pose.
    drawSprite(ctx, 'rest', mix(corgi ? -48 : -1, 0, progress), mix(corgi ? 1 : 1.07, 1, progress),
      mix(corgi ? .78 : .75, 1, progress), 0, mix(corgi ? 14 : 2, 0, progress));
  }

  return (ctx: CanvasRenderingContext2D, now: number): boolean => {
    if (!valid()) {
      finish();
      return false;
    }
    const firstFrame = start === undefined;
    start ??= now;
    let time = now - start;
    if (time > settled + 3000) {
      finish();
      return false;
    }
    if (!braced && time >= fallDuration) {
      // A delayed frame can skip part of the fall, but it must show the four-paw contact.
      const contact = Math.min(time, fallDuration + 35);
      start += time - contact;
      time = contact;
      braced = true;
    }
    if (time >= settled && !keys.length && now - lastTap >= 58) {
      finish();
      return false;
    }

    const airborne = time >= typingInAir && time < tuckBeforeLanding;
    const canType = airborne || time >= typingOnDesk;
    if (canType && keys.length && now - lastTap >= (airborne ? 56 : 68)) {
      const key = resolveKeyByVk(keys.shift()!, engine.keyboardLayout);
      if (key) {
        lastTap = now;
        side = engine.getPetKeyTarget(key).x < (wide ? 290 : 214) ? 'left' : 'right';
        engine.showPetKeyContact(key.id);
      }
    }
    const working = canType && now - lastTap < 58;

    if (time < fallDuration) {
      const p = time / fallDuration;
      const y = -drop * (1 - p * p);
      const tilt = 1 - clamp(time / typingInAir);
      const bracing = time >= tuckBeforeLanding;
      const touchingMouse = !bracing && time >= 151;
      const typingWithMouse = touchingMouse && working && side === 'right';
      engine.paintLandingEquipment(ctx, 'mouse', { x: 0, y, angle: gear[0].tilt * tilt, mousePressed: touchingMouse });
      engine.paintLandingEquipment(ctx, 'keyboard', { x: 0, y, angle: gear[1].tilt * tilt });
      if (bracing) drawSprite(ctx, 'brace', y, 1, 1.16);
      else if (touchingMouse) drawSprite(ctx, typingWithMouse ? 'mouse-key' : 'mouse-touch', y);
      else if (working) drawSprite(ctx, side, y);
      else drawSprite(ctx, 'ready', y, 1 - .04 * tilt, 1 + .08 * tilt, .17 * tilt);
    } else {
      const hit = time - fallDuration;
      for (const item of gear) engine.paintLandingEquipment(ctx, item.item, rebound(item, hit, drop));
      if (hit < 180) drawBrace(ctx, hit);
      else drawSprite(ctx, working ? side : 'rest');
    }

    if (firstFrame) shown();
    return true;
  };
}
