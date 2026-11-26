import type { KuroCatEngine } from '../../catEngine';
import { resolveKeyByVk, type KeySpec } from '../../keyboardLayout';
import assets from './assets/atlas.json';
import { createTypingComposite } from './typing-composite';
import { createGazeController } from '../duorou/gaze-motion.js';
import { createInteractionMotion } from './interaction-motion';
import { createGripPainter, drawFishDream } from './pose-details';
import interactionAssets from './assets/interactions.json';
import bridgeAssets from './assets/bridges.json';

type Point = { x: number; y: number };
type Hand = 'left' | 'right';
type Beat = { key: KeySpec; hand: Hand };
type Strike = Beat & { start: number; contacted: boolean };
type Phase = 'rest' | 'rise' | 'typing' | 'settle' | 'resume';
type Loop = typeof assets.idle;
type Leisure = 'sleep' | 'play';

const size = .42;
const origin = { x: 25, y: 170 };
const keyboard = { x: 158, y: 331, sx: .46, sy: .46 };
const mouse = { x: 63, y: 324, scale: .81 };
const breathingAnchorTime = 0;
const sleepAnchor = 62 * 1000 / assets.sleep.fps;
const idleDelay = 10_000;
const urls = import.meta.glob<string>('./assets/*.webp', { eager: true, query: '?url', import: 'default' });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const timeline = <T>(frames: T[], progress: number) => frames[Math.round(clamp(progress, 0, 1) * (frames.length - 1))];
const ease = (t: number) => t * t * (3 - 2 * t);

async function loadPages(files: string[]): Promise<HTMLImageElement[]> {
  return Promise.all(files.map(async file => {
    const image = new Image();
    image.src = urls['./assets/' + file];
    await image.decode();
    return image;
  }));
}

export async function loadGolden(engine: KuroCatEngine) {
  const [idlePages, sleepPages, typingPages, interactionPages, bridgePages] = await Promise.all([
    loadPages(assets.idle.cards),
    loadPages(assets.sleep.cards),
    loadPages(assets.typing.cards),
    loadPages(interactionAssets.cards),
    loadPages(bridgeAssets.cards),
  ]);
  const frames: Record<string, number[]> = assets.typing.frames;
  const clips = assets.typing.sequences;
  const composite = createTypingComposite(drawRegisteredFrame, assets.typing.neutral);
  const paintGrip = createGripPainter();
  const facePlate = document.createElement('canvas');
  facePlate.width = 420;
  facePlate.height = 440;
  const gazeFace = facePlate.getContext('2d')!;
  const heldButtons = new Set<string>();
  const interaction = createInteractionMotion();
  let gaze = createGazeController();
  let pointer = { x: 0, y: 0 };
  const motionFrames: Record<string, number[]> = interactionAssets.frames;
  let phase: Phase = 'rest';
  let pending: Beat | null = null;
  let strike: Strike | null = null;
  let phaseAt = 0;
  let settle = 0;
  let lastFrame = 0;
  let lastKey = -Infinity;
  let mouseAt = -Infinity;
  let clickAt = -Infinity;
  let idleTime = breathingAnchorTime;
  let idleSince: number | null = null;
  let leisure: Leisure | null = null;
  let leisureAt = 0;
  let activityExit: { at: number; value: number } | null = null;
  let sleepInterrupted = false;
  let lastSleepFrameTime = 0;

  function keyPoint(key: KeySpec): Point {
    const target = engine.getPetKeyTarget(key);
    return {
      x: keyboard.x + (target.x - 214) * keyboard.sx,
      y: keyboard.y + (target.y - 353) * keyboard.sy,
    };
  }

  function drawLoop(ctx: CanvasRenderingContext2D, loop: Loop, pages: HTMLImageElement[], elapsed: number) {
    const id = Math.floor(Math.max(0, elapsed) * loop.fps / 1000) % loop.count;
    const [width, height] = loop.cell;
    const [left, top, right, bottom] = loop.crop;
    const perPage = loop.columns * loop.rows;
    const tile = id % perPage;
    ctx.drawImage(pages[Math.floor(id / perPage)], tile % loop.columns * width,
      Math.floor(tile / loop.columns) * height, width, height,
      origin.x + left * size, origin.y + top * size, (right - left) * size, (bottom - top) * size);
  }

  function drawRegisteredFrame(ctx: CanvasRenderingContext2D, frame: number) {
    const [page, x, y] = frames[frame];
    const [w, h] = assets.typing.cell;
    const [left, top] = assets.typing.offset;
    ctx.drawImage(typingPages[page], x, y, w, h, left, top + 96, w, h);
  }

  function drawVideo(ctx: CanvasRenderingContext2D, frame: number, offsetX = 0) {
    const [page, x, y] = frames[frame];
    const [w, h] = assets.typing.cell;
    const [left, top] = assets.typing.offset;
    ctx.drawImage(typingPages[page], x, y, w, h,
      origin.x + left * size + offsetX, origin.y + top * size, w * size, h * size);
  }

  function paintEquipment(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(keyboard.x, keyboard.y);
    ctx.scale(keyboard.sx, keyboard.sy);
    ctx.translate(-214, -353);
    engine.paintPetEquipment(ctx, 'keyboard');
    ctx.restore();
    ctx.save();
    const nativeMouse = engine.getPetMouse();
    ctx.translate(mouse.x, mouse.y);
    ctx.scale(mouse.scale, mouse.scale);
    ctx.translate(-nativeMouse.base[0], -nativeMouse.base[1]);
    engine.paintPetEquipment(ctx, 'mouse');
    ctx.restore();
    engine.paintWeekdaySign(ctx, 262, 307, .70);
  }

  function drawInteractionFrame(ctx: CanvasRenderingContext2D, frame: string, dx = 0, dy = 0) {
    const [page, x, y] = motionFrames[frame];
    const [width, height] = interactionAssets.cell;
    const [left, top] = interactionAssets.offset;
    const [w, h] = interactionAssets.size;
    ctx.drawImage(interactionPages[page], x, y, width, height,
      origin.x + left * size + dx, origin.y + top * size + dy, w * size, h * size);
  }

  function blendActors(ctx: CanvasRenderingContext2D, value: number, first: () => void, second: () => void) {
    const blend = ease(clamp(value, 0, 1));
    ctx.save();
    const alpha = ctx.globalAlpha;
    if (blend < 1) {
      ctx.globalAlpha = alpha * (1 - blend);
      first();
    }
    if (blend > 0) {
      ctx.globalAlpha = alpha * blend;
      ctx.globalCompositeOperation = 'lighter';
      second();
    }
    ctx.restore();
  }

  function drawRestPose(ctx: CanvasRenderingContext2D, time = idleTime) {
    drawLoop(ctx, assets.idle, idlePages, time);
  }

  function drawClip(ctx: CanvasRenderingContext2D, clip: string[], value: number, x = 0, y = 0) {
    const sample = clamp(value, 0, 1) * (clip.length - 1);
    const frame = Math.floor(sample);
    blendActors(ctx, sample - frame, () => drawInteractionFrame(ctx, clip[frame], x, y),
      () => drawInteractionFrame(ctx, clip[frame + 1], x, y));
  }

  function drawBridge(ctx: CanvasRenderingContext2D, clip: keyof typeof bridgeAssets.clips, value: number) {
    const [page, x, y] = timeline(bridgeAssets.clips[clip], ease(clamp(value, 0, 1)));
    const [w, h] = bridgeAssets.cell;
    const [left, top, width, height] = bridgeAssets.screen;
    ctx.drawImage(bridgePages[page], x, y, w, h, left, top, width, height);
  }

  function drawMousePose(ctx: CanvasRenderingContext2D, pose: 'gaze' | 'reach', amount: number, now: number, dt: number) {
    const { clips, center } = interactionAssets;
    const destination = pose === 'gaze' && amount > 0 ? [pointer.x * amount, pointer.y * amount] : [0, 0];
    const { head, eye } = gaze.step(dt, destination);
    const dx = head[0] * .76 + eye[0] * .24;
    const dy = head[1] * .76 + eye[1] * .24;
    const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
    const force = clamp((Math.hypot(dx, dy) - .08) / .43, 0, 1) * amount;
    const native = engine.getPetMouse().offset;
    const progress = pose === 'reach' ? amount : 1;
    const grip = ease(clamp((progress - .65) / .25, 0, 1));
    const mx = native[0] * mouse.scale;
    const my = native[1] * mouse.scale;
    const click = Math.sin(Math.PI * clamp((now - clickAt) / 145, 0, 1)) * 1.3 * grip;
    const drawGrip = (area: CanvasRenderingContext2D) => drawInteractionFrame(area, center);
    const drawActor = (area: CanvasRenderingContext2D) => {
      if (pose === 'reach') {
        if (progress < .09) {
          blendActors(area, progress / .09, () => drawRestPose(area), () => drawRestPose(area, breathingAnchorTime));
        } else if (progress < .28) drawBridge(area, 'reach', (progress - .09) / .19);
        else blendActors(area, (progress - .84) / .16,
          () => drawClip(area, clips.reach, (progress - .28) / .64), () => drawGrip(area));
        return;
      }
      drawGrip(area);
      // Only the face from the supplied look clip replaces the matching area of the held pose.
      if (force <= 0) return;
      area.save();
      const neck = area.createLinearGradient(0, 239, 0, 275);
      neck.addColorStop(0, `rgba(0,0,0,${force})`);
      neck.addColorStop(1, 'transparent');
      area.globalCompositeOperation = 'destination-out';
      area.fillStyle = neck;
      area.fillRect(26, 150, 180, 125);
      area.restore();
      const face = gazeFace;
      face.clearRect(0, 0, 420, 440);
      const first = Math.floor(angle * clips.gaze.length / (2 * Math.PI));
      const mix = angle * clips.gaze.length / (2 * Math.PI) - first;
      blendActors(face, mix, () => drawInteractionFrame(face, clips.gaze[first]),
        () => drawInteractionFrame(face, clips.gaze[(first + 1) % clips.gaze.length]));
      face.save();
      face.globalCompositeOperation = 'destination-in';
      face.fillStyle = neck;
      face.fillRect(26, 150, 180, 125);
      face.clearRect(0, 0, 420, 150);
      face.clearRect(0, 275, 420, 165);
      face.clearRect(0, 150, 26, 125);
      face.clearRect(206, 150, 214, 125);
      face.restore();
      area.save();
      area.globalCompositeOperation = 'lighter';
      area.drawImage(face.canvas, 0, 0);
      area.restore();
    };
    if (grip <= 0) {
      drawActor(ctx);
      paintEquipment(ctx);
      return;
    }
    paintGrip(ctx, drawActor, (mx + 2) * grip, (my + 2) * grip + click,
      () => paintEquipment(ctx), mouse.x + mx, mouse.y + my);
  }

  function drawSleepPose(ctx: CanvasRenderingContext2D, kind: 'fall' | 'sleep' | 'wake', value: number) {
    if (kind === 'sleep') {
      lastSleepFrameTime = value;
      drawLoop(ctx, assets.sleep, sleepPages, sleepAnchor + value);
    } else if (kind === 'fall') {
      if (value < .085) {
        blendActors(ctx, value / .085, () => drawRestPose(ctx), () => drawRestPose(ctx, breathingAnchorTime));
      } else if (value < .22) drawBridge(ctx, 'fall', (value - .085) / .135);
      else if (value > .81) drawBridge(ctx, 'sleep', (value - .81) / .19);
      else {
        const playhead = (value - .22) / .59;
        const stretch = ease(clamp((playhead - .26) / .67, 0, 1));
        drawClip(ctx, interactionAssets.clips.down, playhead, -2 + 18 * stretch, 1.5 * stretch);
      }
    } else if (value < .07) {
      blendActors(ctx, value / .07, () => drawLoop(ctx, assets.sleep, sleepPages, sleepAnchor + lastSleepFrameTime),
        () => drawLoop(ctx, assets.sleep, sleepPages, sleepAnchor));
    } else if (value < .22) drawBridge(ctx, 'sleep', 1 - (value - .07) / .15);
    else if (value > .79) drawBridge(ctx, 'wake', (value - .79) / .21);
    else {
      const playhead = (value - .22) / .57;
      const stretch = ease(1 - clamp(playhead / .50, 0, 1));
      drawClip(ctx, interactionAssets.clips.up, playhead, -7 + 23 * stretch, 1.5 * stretch);
    }
    paintEquipment(ctx);
    if (kind === 'sleep') drawFishDream(ctx, value);
    if (kind === 'wake') drawFishDream(ctx, lastSleepFrameTime + value * 1000, 1 - ease(clamp(value * 5, 0, 1)));
  }

  function drawPlayPose(ctx: CanvasRenderingContext2D, value: number, exit: number | null) {
    const source = () => {
      const playing = () => drawClip(ctx, interactionAssets.clips.play, value / .88);
      if (value < .10) blendActors(ctx, value / .10, () => drawRestPose(ctx), playing);
      else if (value > .88) drawBridge(ctx, 'play', (value - .88) / .12);
      else playing();
    };
    if (exit === null) source();
    else blendActors(ctx, exit, source, () => drawRestPose(ctx, breathingAnchorTime));
    paintEquipment(ctx);
  }

  function drawKeyStroke(ctx: CanvasRenderingContext2D, frame: number, active: Strike | null, progress: number) {
    const target = active ? keyPoint(active.key) : null;
    const reach = clamp(Math.min(progress / .46, 1, (1 - progress) / .32), 0, 1);
    composite.assemble(frame, active && target ? {
      hand: active.hand,
      contact: { x: (target.x - origin.x) / size, y: (target.y - origin.y - .9) / size },
      reach: ease(reach),
    } : null);
    const y = origin.y - composite.padding * size;
    const w = composite.body.width * size;
    const h = composite.body.height * size;
    ctx.drawImage(composite.body, origin.x, y, w, h);
    paintEquipment(ctx);
    if (target && reach > 0) {
      ctx.save();
      ctx.globalAlpha = ease(clamp(reach / .46, 0, 1));
      ctx.beginPath();
      ctx.moveTo(94, 310);
      ctx.lineTo(225, 316);
      ctx.lineTo(225, 357);
      ctx.lineTo(93, 357);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(composite.paw, origin.x, y, w, h);
      ctx.restore();
    }
  }

  function drawTyping(ctx: CanvasRenderingContext2D, now: number, dt: number): boolean {
    if (phase === 'rest') {
      if (!pending) return false;
      phase = 'rise';
      phaseAt = now;
    }
    let frame = assets.typing.neutral;
    let progress = 0;
    if (phase === 'rise' && now - phaseAt >= 620) phase = 'typing';
    if (phase === 'settle' && pending) phase = 'resume';
    if (phase === 'settle' || phase === 'resume') {
      settle += dt * (phase === 'resume' ? -1.8 : 1) / 1190;
      if (settle >= 1) {
        phase = 'rest';
        idleTime = breathingAnchorTime;
        return false;
      }
      if (settle <= 0) phase = 'typing';
    }

    if (phase === 'typing') {
      if (strike && now - strike.start >= 164) strike = null;
      if (pending && !strike) {
        strike = { ...pending, start: now, contacted: false };
        pending = null;
      }
      if (strike) {
        progress = (now - strike.start) / 164;
        frame = timeline(clips[strike.hand], progress);
        if (!strike.contacted && progress >= .46) {
          strike.contacted = true;
          engine.showPetKeyContact(strike.key.id);
        }
      } else if (now - lastKey >= 610) {
        phase = 'settle';
        settle = 0;
      }
      if (phase === 'typing') {
        drawKeyStroke(ctx, frame, strike, progress);
        return true;
      }
    }
    if (phase === 'rise') {
      const progress = (now - phaseAt) / 620;
      frame = timeline(clips.rise, progress);
      if (progress < .29) blendActors(ctx, progress / .29, () => drawRestPose(ctx), () => drawVideo(ctx, frame));
      else blendActors(ctx, (progress - .73) / .27, () => drawVideo(ctx, frame),
        () => drawVideo(ctx, assets.typing.neutral));
    }
    if (phase === 'settle' || phase === 'resume') {
      frame = timeline(clips.settle, clamp(settle / .70, 0, 1));
      if (settle < .14) blendActors(ctx, settle / .14,
        () => drawVideo(ctx, assets.typing.neutral), () => drawVideo(ctx, frame));
      else if (settle < .70) drawVideo(ctx, frame, -5 * ease(clamp((settle - .43) / .27, 0, 1)));
      else drawBridge(ctx, 'settle', (settle - .70) / .30);
    }
    paintEquipment(ctx);
    return true;
  }

  return {
    reset() {
      phase = 'rest';
      pending = strike = null;
      phaseAt = settle = lastFrame = leisureAt = 0;
      idleTime = breathingAnchorTime;
      idleSince = leisure = activityExit = null;
      sleepInterrupted = false;
      lastKey = mouseAt = clickAt = -Infinity;
      interaction.reset();
      gaze = createGazeController();
      pointer = { x: 0, y: 0 };
      lastSleepFrameTime = 0;
      heldButtons.clear();
    },
    keyDown(vk: number, repeat: boolean, now: number) {
      const key = resolveKeyByVk(vk, '65');
      if (!key) return;
      lastKey = now;
      if (!repeat) pending = { key, hand: keyPoint(key).x < keyboard.x ? 'left' : 'right' };
    },
    mouseActivity(now: number, button?: string, pressed = false) {
      mouseAt = now;
      if (!button) return;
      if (pressed) {
        if (!heldButtons.has(button)) clickAt = now;
        heldButtons.add(button);
      } else heldButtons.delete(button);
    },
    cursor(rx: number, ry: number, _inside: boolean, _now: number) {
      pointer = {
        x: clamp((rx * 420 - 156) / 112, -1, 1),
        y: clamp((ry * 440 - 235) / 98, -1, 1),
      };
    },
    draw(ctx: CanvasRenderingContext2D, now: number) {
      const dt = lastFrame ? clamp(now - lastFrame, 0, 44) : 16;
      lastFrame = now;
      if (phase !== 'rest' && drawTyping(ctx, now, dt)) return;
      const wantsMouse = heldButtons.size > 0 || now - mouseAt < 840;
      const activeInput = wantsMouse || pending !== null || engine.hasHeldPetKey() || now - lastKey < 200;
      if (activeInput) idleSince = null;
      if (leisure === 'play') {
        const value = clamp((now - leisureAt) / 4800, 0, 1);
        if (activeInput) activityExit ??= { at: now, value };
        const exit = activityExit ? (now - activityExit.at) / 320 : null;
        if (value < 1 && (exit === null || exit < 1)) {
          drawPlayPose(ctx, activityExit?.value ?? value, exit);
          return;
        }
        idleTime = breathingAnchorTime;
        leisure = activityExit = null;
      }
      if (leisure === 'sleep' && activeInput) sleepInterrupted = true;
      const pose = interaction.step(dt, wantsMouse, leisure === 'sleep' && !sleepInterrupted, pending !== null);
      if (pose.kind === 'reach' || pose.kind === 'gaze') {
        idleSince = null;
        drawMousePose(ctx, pose.kind, pose.value, now, dt);
        return;
      }
      if (pose.kind === 'fall' || pose.kind === 'sleep' || pose.kind === 'wake') {
        idleSince = null;
        if (pose.kind === 'wake') idleTime = breathingAnchorTime;
        drawSleepPose(ctx, pose.kind, pose.value);
        return;
      }
      if (leisure === 'sleep' && sleepInterrupted) {
        leisure = null;
        sleepInterrupted = false;
      }
      if (drawTyping(ctx, now, dt)) {
        idleSince = null;
        return;
      }
      if (!activeInput && !leisure) {
        idleSince ??= now;
        if (now - idleSince >= idleDelay) {
          leisure = Math.random() < .5 ? 'sleep' : 'play';
          idleSince = null;
          leisureAt = now;
        }
      }
      drawRestPose(ctx);
      paintEquipment(ctx);
      if (!leisure) idleTime += dt;
    },
  };
}
