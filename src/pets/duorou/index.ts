/// <reference types="vite/client" />
import type { KuroCatEngine } from '../../catEngine';
import { resolveKeyByVk } from '../../keyboardLayout';
import { drawSleepIndicator } from '../sleep-indicator';
import { createDualPaws } from './dual-paws.js';
import { createGazeController, pointerGaze } from './gaze-motion.js';
import { createPortraitPainter } from './portrait.js';
import { createWholeGaze } from './whole-gaze.js';
import { createWeekdayLamp } from './weekday-lamp';
import frames from './assets/frames.json';
import videos from './assets/video-scenes.json';
import heldKeys from './assets/held-paws.json';
import { createHeldLook, createIdleActions, createMouseClickMotion, createRestMotion, createVideoAtlas } from './video-motion.js';

const width = 420;
const height = 440;
const mouseScale = 0.68;
const mouseReach = 192;
const mouseReturn = 155;
const hoverDelay = 350;
const assets = import.meta.glob<string>('./assets/*.{webp,png}', { eager: true, import: 'default', query: '?url' });

function loadImage(filename: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = assets[`./assets/${filename}`];
  return image.decode().then(() => image);
}

function drawCell(ctx: CanvasRenderingContext2D, image: HTMLImageElement, rect: number[] | null): void {
  if (!rect) return;
  const [x, y, w, h, toX, toY] = rect;
  ctx.drawImage(image, x, y, w, h, toX, toY, w, h);
}

async function loadPages(name: string, count: number): Promise<HTMLImageElement[]> {
  const pages: HTMLImageElement[] = [];
  for (let index = 0; index < count; index += 1) {
    pages.push(await loadImage(`${name}-${index}.webp`));
  }
  return pages;
}

function sceneCanvas(scale: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法初始化多肉的动画');
  ctx.scale(scale, scale);
  return { canvas, ctx };
}

export async function loadDuorou(engine: KuroCatEngine) {
  const idleClips = [videos.approvedIdle.look, videos.approvedIdle.pat];
  // Keep the atlases from competing for decoding memory when the pet loads.
  const gazeFrames = await loadPages('gaze-page', frames.hdGaze.pages);
  const pawFrames = await loadPages('paws', frames.dualPaws.pages);
  const torso = await loadImage('body-take.webp');
  const typingBridge = await loadImage('typing-bridge.webp');
  const downGaze = await loadImage('look-down.webp');
  const mouseAtlas = await loadImage('atlas.webp');
  const portraits = await loadImage('authored.webp');
  const restFrames = await loadPages('rest-video', videos.rest.pages);
  const heldFrames = await loadPages('held-video', videos.held.pages);
  const heldPawFrames = await loadPages('held-paws', heldKeys.pages);

  const restAtlas = createVideoAtlas(restFrames, videos.rest);
  const idleAtlases = [
    createVideoAtlas(await loadPages('approved-look', idleClips[0].pages), idleClips[0]),
    createVideoAtlas(await loadPages('approved-pat', idleClips[1].pages), idleClips[1]),
  ];
  const heldAtlas = createVideoAtlas(heldFrames, videos.held);
  const createGaze = () => createWholeGaze(gazeFrames, frames.hdGaze, downGaze, frames.downGaze);
  const createPaws = () => createDualPaws(pawFrames, torso, typingBridge, frames.dualPaws, width, height);
  const createHeldPaws = () => createDualPaws(heldPawFrames, torso, typingBridge,
    { ...frames.dualPaws, ...heldKeys }, width, height);
  const painter = createPortraitPainter(portraits, frames.authoredViews);
  const reach = sceneCanvas(1);
  const restBody = sceneCanvas(2);
  const heldBody = sceneCanvas(2);
  const drawWeekdayLamp = createWeekdayLamp();
  const [mouseX, mouseY] = frames.mousePosition;
  const mouseButtons = new Set<string>();

  let gaze = createGaze();
  let look = createGazeController();
  let rest = createRestMotion(videos.rest);
  let idleActions = createIdleActions(idleClips);
  let heldLook = createHeldLook(videos.held);
  let mouseClick = createMouseClickMotion();
  let paws = createPaws();
  let heldPaws = createHeldPaws();
  let pointer: ReturnType<typeof pointerGaze> | null = null;
  let hoverAnchor: [number, number] | null = null;
  let hoverSince = 0;
  let idleSince = performance.now();
  let dozeSince: number | null = null;
  let mouseUntil = 0;
  let mouseProgress = 0;
  let lastTime = 0;
  let lastReach = -1;
  let lastHeld = -1;
  let lastRest = -1;
  let legacyUpper = false;

  function hasMouse(now: number) {
    return mouseButtons.size > 0 || now < mouseUntil;
  }

  return {
    reset() {
      gaze = createGaze();
      look = createGazeController();
      rest = createRestMotion(videos.rest);
      idleActions = createIdleActions(idleClips);
      heldLook = createHeldLook(videos.held);
      mouseClick = createMouseClickMotion();
      paws = createPaws();
      heldPaws = createHeldPaws();
      mouseButtons.clear();
      pointer = null;
      hoverAnchor = null;
      hoverSince = mouseUntil = mouseProgress = lastTime = 0;
      lastReach = lastHeld = lastRest = -1;
      idleSince = performance.now();
      dozeSince = null;
      legacyUpper = false;
    },
    keyDown(vk: number, repeat: boolean, now: number) {
      idleSince = now;
      if (repeat) return;
      const key = resolveKeyByVk(vk, '65');
      if (!key) return;
      if (hasMouse(now) || heldPaws.busy()) {
        if (heldPaws.supports(key.id)) {
          if (paws.busy()) paws.finishForMouse();
          heldPaws.push(key.id, now);
        }
      } else if (paws.supports(key.id)) {
        if (!paws.busy() && !paws.posed()) rest = createRestMotion(videos.rest);
        paws.push(key.id, now);
      }
    },
    mouseActivity(now: number, button?: string, pressed = false) {
      if (button !== undefined) {
        if (pressed) {
          if (button === 'left' && !mouseButtons.has(button)) mouseClick.press();
          mouseButtons.add(button);
        } else mouseButtons.delete(button);
      }
      mouseUntil = now + 320;
      idleSince = now;
    },
    cursor(rx: number, ry: number, inside: boolean, now: number, overDog = false) {
      const x = rx * width;
      const y = ry * height;
      const next = pointerGaze(x, y, inside, width, height);
      if (next.nearby || pointer?.nearby) idleSince = now;
      pointer = next;
      if (!overDog) hoverAnchor = null;
      else if (!hoverAnchor || Math.hypot(x - hoverAnchor[0], y - hoverAnchor[1]) > 6) {
        hoverAnchor = [x, y];
        hoverSince = now;
      }
    },
    draw(ctx: CanvasRenderingContext2D, now: number, sleepReady = false) {
      const dt = lastTime ? Math.min(34, Math.max(0, now - lastTime)) : 0;
      lastTime = now;
      const down = pointer?.down ?? 0;
      const contact = (key: string, _hand: string, age: number) => {
        if (age <= 165) engine.showPetKeyContact(key);
      };
      paws.step(dt, contact, down === 1, now);
      const typing = paws.busy() || paws.posed();
      const mouseTarget = Number(!typing && (hasMouse(now) || heldPaws.busy()));
      mouseProgress += Math.max(-dt / mouseReturn, Math.min(dt / mouseReach, mouseTarget - mouseProgress));
      if (!typing) heldPaws.step(dt, contact, true, now);

      const wantsSleep = sleepReady && !typing && mouseProgress === 0;
      if (!wantsSleep && dozeSince !== null) hoverSince = now;
      const hover = !typing && mouseProgress === 0 && hoverAnchor !== null && now - hoverSince >= hoverDelay;
      const idle = !typing && !pointer?.nearby && mouseProgress === 0;
      const idleFor = now - idleSince;
      const weight = pointer?.nearby ? 1 : mouseProgress;
      const target = typing ? [0, down] : hover || wantsSleep ? [0, 0] :
        pointer?.direction.map(value => value * weight) ?? [0, 0];
      const current = look.step(dt, target);
      const x = current.head[0] * .94 + current.eye[0] * .06;
      const y = current.head[1] * .94 + current.eye[1] * .06;
      const needsLegacy = mouseProgress > 0 && y < -.47 && x > -.18;
      const followHeld = mouseProgress > 0 && !needsLegacy && !legacyUpper;
      const heldFrame = heldLook.step(dt, followHeld ? x : 0, followHeld ? y : 0);
      if (mouseProgress === 0) legacyUpper = false;
      else if (needsLegacy && heldLook.centered()) legacyUpper = true;
      // Keep the unheld nod in step while the pointer stays below the dog.
      const warmDown = down > .55 && y > .3 && !legacyUpper;
      const useRing = mouseProgress === 0 || (legacyUpper && needsLegacy) || warmDown;
      const image = gaze.draw(useRing ? x : 0, useRing ? y : 0, now);
      const facingFront = gaze.pose().sourceFrames[0] === 0 && !gaze.pose().nod;
      if (legacyUpper && !needsLegacy && facingFront) legacyUpper = false;

      const idleAction = idleActions.step(now, idleSince, idle && facingFront, lastRest === 0, !wantsSleep);
      const sleeping = wantsSleep && facingFront && !idleAction;
      if (sleeping) dozeSince ??= now;
      else dozeSince = null;
      const expression = sleeping ? 'sleep' : facingFront && hover ? 'hover' :
        facingFront && idle && !idleAction && idleFor > 300 ? 'idle' : null;
      const restFrame = rest.step(dt, expression);
      if (restFrame !== lastRest) {
        restBody.ctx.clearRect(0, 0, width, height);
        restAtlas.draw(restBody.ctx, restFrame);
        lastRest = restFrame;
      }

      const mouse = engine.getPetMouse();
      const dx = mouse.offset[0] * mouseScale;
      const dy = mouse.offset[1] * mouseScale;
      const pawPress = mouseClick.step(dt) * mouseProgress * 3.2;
      const reachIndex = Math.round(mouseProgress * (frames.mouseFrames.length - 1));
      const reachPose = frames.mouseFrames[reachIndex];
      const settledGrip = mouseProgress >= .9;
      const combined = heldPaws.busy();
      if (typing) {
        paws.drawBody(ctx, restBody.canvas);
      } else if (mouseProgress > 0) {
        if (heldFrame !== lastHeld) {
          heldBody.ctx.clearRect(0, 0, width, height);
          heldAtlas.draw(heldBody.ctx, heldFrame);
          lastHeld = heldFrame;
        }
        if (reachIndex !== lastReach) {
          reach.ctx.clearRect(0, 0, width, height);
          drawCell(reach.ctx, mouseAtlas, reachPose.body);
          lastReach = reachIndex;
        }
        const useLegacyHead = legacyUpper || (!mouseTarget && !settledGrip && warmDown);
        const scene = restFrame > 0 ? restBody.canvas : useLegacyHead ? image : heldBody.canvas;
        const hd = useLegacyHead && restFrame === 0 ?
          { image: scene, origin: frames.hdGaze.origin, size: frames.hdGaze.size } :
          { image: scene, origin: [0, 0], size: [width, height] };
        const body = settledGrip ? heldBody.canvas : reach.canvas;
        const picture = painter.draw(body, settledGrip ? heldFrame + 1000 : reachIndex, current, {
          x: 0, y: 0,
          mouseX: dx * mouseProgress, mouseY: dy * mouseProgress + pawPress,
          stroke: true, dense: true, restFrame: 0, hd,
        });
        if (combined) heldPaws.drawOn(ctx, picture);
        else ctx.drawImage(picture, 0, 0, width, height);
      } else if (idleAction && idleAction.frame !== null) {
        const sequence = idleClips[idleAction.clip].frames;
        if (idleAction.frame === sequence[0] || idleAction.frame === sequence.at(-1)) {
          ctx.drawImage(restBody.canvas, 0, 0, width, height);
        } else {
          idleAtlases[idleAction.clip].draw(ctx, idleAction.frame);
        }
      } else if (restFrame > 0 || facingFront) {
        ctx.drawImage(restBody.canvas, 0, 0, width, height);
      } else {
        ctx.drawImage(image, frames.hdGaze.origin[0], frames.hdGaze.origin[1], frames.hdGaze.size[0], frames.hdGaze.size[1]);
      }

      ctx.save();
      ctx.translate(216, 333);
      ctx.scale(.56, .63);
      ctx.translate(-214, -353);
      engine.paintPetEquipment(ctx, 'keyboard');
      ctx.restore();

      ctx.save();
      ctx.translate(mouseX - 8, mouseY + 8);
      ctx.scale(mouseScale, mouseScale);
      ctx.translate(-mouse.base[0], -mouse.base[1]);
      engine.paintPetEquipment(ctx, 'mouse');
      ctx.restore();

      drawWeekdayLamp(ctx, 297, 335, now);
      if (dozeSince !== null && videos.rest.closed.includes(restFrame)) {
        drawSleepIndicator(ctx, 260, 98, now - dozeSince);
      }

      if (typing) {
        paws.drawFront(ctx);
      } else if (mouseProgress > 0) {
        ctx.save();
        ctx.translate(dx * mouseProgress, dy * mouseProgress + pawPress);
        if (settledGrip) {
          ctx.beginPath();
          ctx.ellipse(mouseX - 8, mouseY + 8, 13, 17, -.06, 0, 2 * Math.PI);
          ctx.clip();
          const [px, py, w, h] = [94, 299, 53, 30];
          ctx.drawImage(heldBody.canvas, px * 2, py * 2, w * 2, h * 2, px, py, w, h);
        } else {
          drawCell(ctx, mouseAtlas, reachPose.front);
        }
        ctx.restore();
        if (combined) heldPaws.drawFront(ctx);
      }
    },
  };
}
