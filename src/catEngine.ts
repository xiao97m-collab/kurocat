import {
  KEYBOARD_KEYS_65,
  KEYBOARD_KEYS_108,
  getKeyboardLayout,
  type KeySpec,
  type KeyboardLayoutId,
  formatBubbleForVk,
  resolveKeyByVk,
} from './keyboardLayout';
import { catAudio } from './audio';
import { boardFinishes, keyFinish, paintVoyageMark, rippleAmount, type KeyboardTheme, type KeyRipple } from './keyboardTheme';
import { resolveCustomSkin, type CatSkinConfig, type ResolvedSkin } from './catSkins';
import type { PetEquipment3D } from './pets/duorou/equipment3d';
import { drawSleepIndicator } from './pets/sleep-indicator';
import { drawBlueScarf } from './pets/blue-scarf';
import { createWardrobePainter, hasSleeves, type Arm, type PetSkin } from './pets/wardrobe';
import { createWeekdayLamp } from './pets/duorou/weekday-lamp';

export const LOGICAL_W = 420;
export const LOGICAL_H = 440;
export type CatBreed = 'black' | 'ragdoll';
export type KeyboardOrientation = 'cat' | 'viewer';
const AUTO_SLEEP_DELAY = 28_000;
const KEY_GRID_PAD_X = 7;
const KEY_GRID_PAD_Y = 6;
const KEY_GRID_BACK_SCALE = .94;
const KEY_GRID_TAPER = .09;
const MOUSE_RADIUS_X = 18.5;
const MOUSE_RADIUS_Y = 23;

interface Vec2 {
  x: number;
  y: number;
}

interface SmearFrame {
  sx: number;
  sy: number;
  px: number;
  py: number;
  alpha: number;
}

type PawMode = 'idle' | 'curled' | 'poke' | 'mouse';

interface PawState {
  side: 'left' | 'right';
  shoulderNormY: number; // vertical fraction along spine (0=ear tips, 1=base)
  shoulderHalfX: number;
  pos: Vec2;
  vel: Vec2;
  target: Vec2;
  mode: PawMode;
  idleWeight: number;
  curlWeight: number;
  pokeTime: number;
  impactSquash: number;
  lastKeyStrikeAt: number;
  smears: SmearFrame[];
}

interface KeyBubble {
  id: number;
  label: string;
  isSpace: boolean;
  x: number;
  targetX: number;
  y: number;
  targetY: number;
  rot: number;
  createdAt: number;
  lifetime: number;
}

interface KeyAnim {
  pressed: boolean;
  pressAmount: number;
  lastHitAt: number;
}

interface TailStrike {
  keyId: string;
  target: Vec2;
  startedAt: number;
  reach: number;
  pressure: number;
}

const TYPING_WINDOW = 800;
const MOUSE_ACTIVITY_WINDOW = 320;
const TAIL_REACH_TIME = 90;
const TAIL_CONTACT_TIME = 40;
const TAIL_RETURN_TIME = 150;
const MODIFIER_KEYS = new Set(['lshift', 'rshift', 'lctrl', 'rctrl', 'lalt', 'ralt', 'lwin', 'rwin', 'caps']);

// Exact measured pixel silhouette half-width profile from original video 0.3s (compact chubby sitting cat!)
// t = 0.0 (ear tips) -> t = 1.0 (bottom base flush on keyboard)
const BODY_SLICES: Array<{ t: number; hw: number }> = [
  { t: 0.12, hw: 49 }, // forehead / ear base
  { t: 0.21, hw: 56 }, // eye line
  { t: 0.30, hw: 60 }, // chubby cheeks widest
  { t: 0.38, hw: 52 }, // gentle neck indent
  { t: 0.47, hw: 54 }, // upper chest
  { t: 0.57, hw: 62 }, // mid chest
  { t: 0.68, hw: 70 }, // plump belly
  { t: 0.79, hw: 73 }, // widest soft thighs!
  { t: 0.90, hw: 69 }, // lower thigh curve
  { t: 0.97, hw: 58 }, // tapers softly inward at base!
  { t: 1.00, hw: 46 }, // cozy bottom rest
];

export class KuroCatEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId = 0;
  private lastTime = 0;
  private elapsed = 0;
  private lastInteractionAt = performance.now();
  private mouseMotionAnchor: Vec2 | null = null;
  private sleepStartedAt: number | null = null;
  private sleepDepth = 0;

  public showKeyBubbles = true;
  public catBreed: CatBreed = 'black';
  public customSkin: ResolvedSkin | null = null;
  public keyboardLayout: KeyboardLayoutId = '65';
  public keyboardOrientation: KeyboardOrientation = 'cat';
  public keyboardTheme: KeyboardTheme = 'classic';
  private lastKeyboardStrike: { key: KeySpec; at: number } | null = null;

  private getKeyboardRipple(): KeyRipple | null {
    const strike = this.lastKeyboardStrike;
    return strike && this.keyboardTheme === 'rgb' ? { key: strike.key, age: this.lastTime - strike.at } : null;
  }
  private renderScale = 1.0;
  private embedded = false;
  private petPainter: ((ctx: CanvasRenderingContext2D, now: number, sleepReady: boolean) => void) | null = null;
  private landingPainter: ((ctx: CanvasRenderingContext2D, now: number) => boolean) | null = null;
  private petEquipment3d: PetEquipment3D | null = null;

  public petSkin: PetSkin = 'plain';
  public readonly wardrobe: ReturnType<typeof createWardrobePainter>;
  public petDecorations = { weekdaySign: false, blueScarf: false };
  private weekdayLamp?: ReturnType<typeof createWeekdayLamp>;

  public paintPetScarf(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height = 1): void {
    if (this.petDecorations.blueScarf) drawBlueScarf(ctx, x, y, width, height);
  }

  public paintWeekdaySign(ctx: CanvasRenderingContext2D, x?: number, y?: number, scale = 1): void {
    if (this.petDecorations.weekdaySign) {
      (this.weekdayLamp ??= createWeekdayLamp())(ctx, x ?? this.kbCenterX + this.kbWidth * .5 - 9, y ?? this.kbCenterY - 67, this.lastTime, scale);
    }
  }

  public setPetPainter(painter: ((ctx: CanvasRenderingContext2D, now: number, sleepReady: boolean) => void) | null): void {
    if (painter !== this.petPainter) {
      this.lastInteractionAt = performance.now();
      this.sleepStartedAt = null;
      this.sleepDepth = 0;
    }
    this.petPainter = painter;
  }

  public setPetEquipment3d(equipment: PetEquipment3D | null): void {
    this.petEquipment3d = equipment;
  }

  public setLandingPainter(painter: (ctx: CanvasRenderingContext2D, now: number) => boolean): void {
    this.landingPainter = painter;
  }

  public paintLandingEquipment(
    ctx: CanvasRenderingContext2D,
    item: 'keyboard' | 'mouse',
    offset: { x: number; y: number; angle: number; mousePressed?: boolean },
  ): void {
    const keyboard = item === 'keyboard';
    const x = keyboard ? this.kbCenterX : this.mouseBaseX + this.mouseOffsetX;
    const halfWidth = keyboard ? this.kbWidth * .52 : MOUSE_RADIUS_X;
    const bottom = keyboard
      ? this.kbCenterY + this.kbHeight / 2 + this.kbBounce * 1.1
      : this.mouseBaseY + this.mouseOffsetY + MOUSE_RADIUS_Y;
    const edgeLift = Math.abs(Math.sin(offset.angle)) * halfWidth;
    const previousPress = this.mouseLeftPress;
    ctx.save();
    ctx.translate(x + offset.x, bottom + offset.y - edgeLift);
    ctx.rotate(offset.angle);
    ctx.translate(-x, -bottom);
    try {
      if (offset.mousePressed) this.mouseLeftPress = 1;
      this.drawPetEquipment(ctx, item);
      if (keyboard) this.paintWeekdaySign(ctx, undefined, undefined, .80);
    } finally {
      this.mouseLeftPress = previousPress;
      ctx.restore();
    }
  }

  public paintPetEquipment(ctx: CanvasRenderingContext2D, item: 'keyboard' | 'mouse', keyBubbleLimit?: number): void {
    this.drawPetEquipment(ctx, item);
    if (!this.showKeyBubbles) return;
    if (item === 'keyboard') this.drawKeyBubbles(ctx, keyBubbleLimit);
    else this.drawMouseBadges(ctx);
  }

  private drawPetEquipment(ctx: CanvasRenderingContext2D, item: 'keyboard' | 'mouse'): void {
    if (item === 'mouse' && this.wardrobe.prop(this.petSkin,
      this.mouseBaseX + this.mouseOffsetX, this.mouseBaseY + this.mouseOffsetY,
      this.mouseLeftPress, this.mouseRightPress, this.mouseOffsetX)) return;
    const equipment = this.petEquipment3d;
    if (!equipment?.isAvailable()) {
      if (item === 'keyboard') this.drawKeyboard(ctx);
      else this.drawMiniMouse(ctx);
      return;
    }

    equipment.configure(this.keyboardLayout, this.keyboardOrientation,
      this.kbWidth - KEY_GRID_PAD_X * 2, this.kbHeight - KEY_GRID_PAD_Y * 2,
      KEY_GRID_BACK_SCALE, KEY_GRID_TAPER, MOUSE_RADIUS_X * 2, MOUSE_RADIUS_Y * 2, this.keyboardTheme);
    equipment.update(this.lastTime, this.keyAnims, this.mouseLeftPress > 0.2, this.mouseRightPress > 0.2,
      Math.max(this.mouseScrollFlash, this.mouseMiddlePress), this.tailStrike?.keyId, this.tailStrike?.pressure, this.getKeyboardRipple());
    ctx.save();
    if (item === 'keyboard') {
      ctx.translate(this.kbCenterX, this.kbCenterY + this.kbBounce * 1.1);
      ctx.rotate(this.kbTiltRad);
    } else {
      ctx.translate(this.mouseBaseX + this.mouseOffsetX, this.mouseBaseY + this.mouseOffsetY);
      ctx.rotate(-0.06);
    }
    equipment.draw(ctx, item);
    ctx.restore();
  }

  public getPetMouse(): { base: [number, number]; offset: [number, number] } {
    return { base: [this.mouseBaseX, this.mouseBaseY], offset: [this.mouseOffsetX, this.mouseOffsetY] };
  }

  public getPetKeyTarget(spec: KeySpec): Vec2 {
    return this.getKeyWorldCenter(spec);
  }

  public showPetKeyContact(keyId: string): void {
    const key = this.keyAnims.get(keyId);
    if (key) key.pressAmount = Math.max(key.pressAmount, 0.77);
  }

  public setRenderScale(scale: number): void {
    this.renderScale = Math.max(0.2, Math.min(1.5, scale));
  }

  public getLogicalSize(): { w: number; h: number } {
    return { w: this.logicalW, h: this.logicalH };
  }

  public setCatAppearance(breedId: string, skin?: CatSkinConfig | null): void {
    if ((breedId === 'black' || breedId === 'ragdoll') && (!skin || skin.builtin)) {
      this.catBreed = breedId;
      this.customSkin = null;
    } else if (skin) {
      this.catBreed = 'black';
      this.customSkin = resolveCustomSkin(skin);
    } else {
      this.catBreed = 'black';
      this.customSkin = null;
    }
  }

  public setKeyboardConfig(layout: KeyboardLayoutId, orientation: KeyboardOrientation): void {
    const nextLayout: KeyboardLayoutId = layout === '108' ? '108' : '65';
    const nextOrientation: KeyboardOrientation = orientation === 'viewer' ? 'viewer' : 'cat';
    const layoutChanged = this.keyboardLayout !== nextLayout;
    if (layoutChanged || this.keyboardOrientation !== nextOrientation) {
      this.tailStrike = null;
    }
    this.keyboardLayout = nextLayout;
    this.keyboardOrientation = nextOrientation;

    if (nextLayout === '108') {
      this.logicalW = 540;
      this.logicalH = 456;
      this.catCenterX = 278;
      this.catTopY = 66;
      this.catBaseY = 292;
      this.kbCenterX = 290;
      this.kbCenterY = 356;
      this.kbWidth = 398;
      this.kbHeight = 96;
      this.kbTiltRad = (2.4 * Math.PI) / 180;
      this.mouseBaseX = 46;
      this.mouseBaseY = 342;
    } else {
      this.logicalW = 420;
      this.logicalH = 440;
      this.catCenterX = 196;
      this.catTopY = 82;
      this.catBaseY = 308;
      this.kbCenterX = 214;
      this.kbCenterY = 353;
      this.kbWidth = 266;
      this.kbHeight = 74;
      this.kbTiltRad = (3.4 * Math.PI) / 180;
      this.mouseBaseX = 46;
      this.mouseBaseY = 338;
    }

    if (layoutChanged) {
      this.leftPaw.pos = { x: this.catCenterX - 18, y: this.catBaseY };
      this.leftPaw.target = { x: this.catCenterX - 18, y: this.catBaseY };
      this.rightPaw.pos = { x: this.catCenterX + 18, y: this.catBaseY };
      this.rightPaw.target = { x: this.catCenterX + 18, y: this.catBaseY };
    }
  }

  // Dynamic logical proportions (65% compact = 420x440; 108-key full-size = 540x456)
  private logicalW = 420;
  private logicalH = 440;
  private catCenterX = 196;
  private catTopY = 82;
  private catBaseY = 308;
  private readonly catHeight = 226;

  // Mechanical keyboard deck below the sitting cat
  private kbCenterX = 214;
  private kbCenterY = 353;
  private kbWidth = 266;
  private kbHeight = 74;
  private kbTiltRad = (3.4 * Math.PI) / 180;

  // True-scale white oval mouse to the left of keyboard
  private mouseBaseX = 46;
  private mouseBaseY = 338;
  private mouseOffsetX = 0;
  private mouseOffsetY = 0;
  private mouseTargetOffsetX = 0;
  private mouseTargetOffsetY = 0;
  private mouseLeftDown = false;
  private mouseRightDown = false;
  private mouseMiddleDown = false;
  private mouseLeftPress = 0;
  private mouseRightPress = 0;
  private mouseMiddlePress = 0;
  private mouseScrollFlash = 0;
  private lastMouseActivityAt = -10000;
  private lastMouseMotionAt = -10000;
  private mouseBadges: Array<{
    id: number;
    label: string;
    color: string;
    x: number;
    y: number;
    createdAt: number;
    lifetime: number;
  }> = [];

  // Cursor & 100% live eye tracking + 2.5D head turn
  private cursorRelX = 0.5;
  private cursorRelY = 0.5;
  private cursorOverCat = false;
  private eyeLookX = 0;
  private eyeLookY = 0;
  private faceTurnX = 0;

  // Spine-shear deformation state (exact measured flexible cat spine + playful typing body/head sway!)
  private spineLean = 0;    // -1 (mouse lean: head shifts -46px left while hips stay anchored!) .. +1
  private headTilt = 0;
  private typingHunch = 0;  // 0..1 lowers head & rounds posture slightly when typing
  private typingSway = 0;   // -1..+1 lively left-right torso & head sway while typing!
  private typingSwayVel = 0;
  private typingGroovePhase = 0;
  private lastKeyBias = 0;
  private strikeRock = 0;
  private strikeRockVel = 0;
  private bodyBob = 0;
  private kbBounce = 0;

  // Blinking, petting, ear micro-twitch, typing rhythm
  private nextBlinkAt = 2.8;
  private blinkProgress = 0;
  private isBlinking = false;

  private lastPetCursorX: number | null = null;
  private lastPetCursorY: number | null = null;
  private petEnergy = 0;
  private squintAmount = 0;
  private earTwitchLeft = 0;
  private earTwitchRight = 0;
  private recentKeyTimes: number[] = [];
  private fastTyping = false;
  private typingEnergy = 0;
  private lastAnyKeyAt = -10000;

  // Paws
  private leftPaw: PawState;
  private rightPaw: PawState;
  private lastSpacePaw: 'left' | 'right' = 'left';
  private tailStrike: TailStrike | null = null;
  private lastTailStrikeAt = -10000;

  // Keys & bubbles
  private keyAnims = new Map<string, KeyAnim>();
  private bubbles: KeyBubble[] = [];
  private nextBubbleId = 1;

  constructor(canvas: HTMLCanvasElement, options?: { embedded?: boolean }) {
    this.canvas = canvas;
    this.embedded = Boolean(options?.embedded);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize 2D canvas context');
    this.ctx = ctx;
    this.wardrobe = createWardrobePainter(ctx);

    for (const k of KEYBOARD_KEYS_65) {
      this.keyAnims.set(k.id, { pressed: false, pressAmount: 0, lastHitAt: -10000 });
    }
    for (const k of KEYBOARD_KEYS_108) {
      if (!this.keyAnims.has(k.id)) {
        this.keyAnims.set(k.id, { pressed: false, pressAmount: 0, lastHitAt: -10000 });
      }
    }

    this.leftPaw = {
      side: 'left',
      shoulderNormY: 0.50,
      shoulderHalfX: -32,
      pos: { x: this.catCenterX - 18, y: this.catBaseY },
      vel: { x: 0, y: 0 },
      target: { x: this.catCenterX - 18, y: this.catBaseY },
      mode: 'idle',
      idleWeight: 1,
      curlWeight: 0,
      pokeTime: 1,
      impactSquash: 0,
      lastKeyStrikeAt: -10000,
      smears: [],
    };

    this.rightPaw = {
      side: 'right',
      shoulderNormY: 0.50,
      shoulderHalfX: 32,
      pos: { x: this.catCenterX + 18, y: this.catBaseY },
      vel: { x: 0, y: 0 },
      target: { x: this.catCenterX + 18, y: this.catBaseY },
      mode: 'idle',
      idleWeight: 1,
      curlWeight: 0,
      pokeTime: 1,
      impactSquash: 0,
      lastKeyStrikeAt: -10000,
      smears: [],
    };

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  public resize(): void {
    const dpr = Math.max(window.devicePixelRatio || 1, 1);
    const cssW = Math.max(1, this.embedded ? (this.canvas.clientWidth || 420) : window.innerWidth);
    const cssH = Math.max(1, this.embedded ? (this.canvas.clientHeight || 440) : window.innerHeight);
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
  }

  public start(): void {
    this.lastTime = performance.now();
    this.lastInteractionAt = this.lastTime;
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
      this.lastTime = now;
      this.update(dt, now);
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  // ---- Flexible spine coordinate system (exact match to measured 0.3s -> 2.2s shear!) ----

  private spinePoint(t: number, breath: number): Vec2 {
    // t in [0..1]: 0 = ear tips, 1 = seated base on desk
    const u = Math.max(0, Math.min(1, 1 - t)); // 0 at hips, 1 at head
    const shearCurve = u * u * (3 - 2 * u); // smoothstep from hips up to head!
    // Measured mouse-lean shift (-46px at head) + lively typing left-right body/head sway (+-25px)!
    const leanAmp = this.keyboardLayout === '108' ? 76 : 46;
    const leanX = (this.spineLean * leanAmp + this.typingSway * 25 + this.strikeRock * 10) * shearCurve;
    const swayDipY = Math.abs(this.typingSway) * 4.0 * shearCurve;
    const hunchY = (this.typingHunch * 13 + this.bodyBob * 4.8 + breath + this.sleepDepth * 34) * shearCurve + swayDipY;
    // Slight forward drop when leaning deeply to the mouse
    const leanDropY = Math.abs(this.spineLean) * 6 * shearCurve;
    return {
      x: this.catCenterX + leanX,
      y: this.catTopY + t * this.catHeight + hunchY + leanDropY,
    };
  }

  private getLiveShoulder(paw: PawState, breath: number): Vec2 {
    const sp = this.spinePoint(paw.shoulderNormY, breath);
    return {
      x: sp.x + paw.shoulderHalfX,
      y: sp.y,
    };
  }

  private getLiveCurledPawPos(paw: PawState, breath: number): Vec2 {
    // Bent forearm elbow -> cute curled paw sitting near lower belly (matches 8.3s / 10.6s!)
    const sp = this.spinePoint(0.84, breath);
    const bob = Math.sin(this.elapsed * 12 + (paw.side === 'left' ? 0 : Math.PI)) * (1.5 + this.typingEnergy * 2.0);
    const xOff = paw.side === 'left' ? -24 : 24;
    return {
      x: sp.x + xOff,
      y: sp.y + bob,
    };
  }

  // ---- Input event handlers ----

  public onKeyDown(vk: number, repeat: boolean): void {
    const now = performance.now();
    this.lastInteractionAt = now;
    const spec = resolveKeyByVk(vk, this.keyboardLayout);
    if (!spec) return;

    const anim = this.keyAnims.get(spec.id);
    if (anim) {
      anim.pressed = true;
      anim.pressAmount = 1;
      anim.lastHitAt = now;
    }

    if (repeat) return;

    this.lastKeyboardStrike = { key: spec, at: now };
    this.lastAnyKeyAt = now;
    const isTypingKey = !MODIFIER_KEYS.has(spec.id);
    if (isTypingKey) {
      this.recentKeyTimes.push(now);
      if (this.recentKeyTimes.length > 26) this.recentKeyTimes.shift();
    }
    this.updateTypingSpeed(now);

    this.bodyBob = Math.min(1.15, this.bodyBob + 0.65);
    this.kbBounce = Math.min(1, this.kbBounce + 0.45);

    if (Math.random() < 0.16) {
      if (Math.random() < 0.5) this.earTwitchLeft = 1;
      else this.earTwitchRight = 1;
    }

    const layout = getKeyboardLayout(this.keyboardLayout);
    const isCatFacing = this.keyboardOrientation === 'cat';
    const keyColCenter = spec.uStart + spec.uWidth * 0.5;
    const screenKeyCol = isCatFacing ? layout.totalUnits - keyColCenter : keyColCenter;
    const midCol = layout.totalUnits * 0.5;
    const keyBias = Math.max(-1, Math.min(1, (screenKeyCol - midCol) / (layout.totalUnits * 0.34)));
    this.lastKeyBias = keyBias;
    this.typingGroovePhase += 1.22;

    let targetPoint = this.getKeyWorldCenter(spec);
    let chosen: PawState;

    const activelyMousing = this.isMouseActive(now);
    const tailStrike = activelyMousing && isTypingKey ? this.tryTailStrike(spec, now) : null;
    if (tailStrike) {
      this.showKeyBubble(vk, spec, tailStrike.target.x, now);
      return;
    }

    const splitCol =
      this.keyboardLayout === '108'
        ? isCatFacing
          ? 12.2
          : 8.4
        : 7.5;

    if (activelyMousing) {
      chosen = this.rightPaw;
    } else if (spec.id === 'space') {
      this.lastSpacePaw = this.lastSpacePaw === 'left' ? 'right' : 'left';
      chosen = this.lastSpacePaw === 'left' ? this.leftPaw : this.rightPaw;
    } else {
      chosen = screenKeyCol < splitCol ? this.leftPaw : this.rightPaw;
      const other = chosen.side === 'left' ? this.rightPaw : this.leftPaw;
      if (this.fastTyping && isTypingKey && now - chosen.lastKeyStrikeAt < 220 &&
          other.mode !== 'poke' && Math.abs(targetPoint.x - this.getLiveShoulder(other, 0).x) <= 150) {
        chosen = other;
      }
    }

    if (spec.id === 'space') {
      const spaceU = isCatFacing
        ? chosen.side === 'left'
          ? spec.uStart + spec.uWidth * 0.68
          : spec.uStart + spec.uWidth * 0.32
        : chosen.side === 'left'
          ? spec.uStart + spec.uWidth * 0.32
          : spec.uStart + spec.uWidth * 0.68;
      const rY = spec.rowY ?? spec.row;
      targetPoint = this.projectKeyboardPoint(spaceU, rY + 0.50);
    }

    const sideSign = chosen.side === 'left' ? -1 : 1;
    this.strikeRockVel += sideSign * (1.75 + this.typingEnergy * 1.25);
    if (!activelyMousing) {
      // Lively groove impulse: rocks head & upper body back and forth as the cat types!
      this.typingSwayVel += (keyBias * 2.1 + Math.cos(this.typingGroovePhase) * 1.65) * (0.9 + this.typingEnergy * 0.45);
    }

    const prevShoulder = this.getLiveShoulder(chosen, 0);
    if (chosen.mode === 'poke' && Math.hypot(targetPoint.x - chosen.pos.x, targetPoint.y - chosen.pos.y) > 22) {
      chosen.smears.push({
        sx: prevShoulder.x,
        sy: prevShoulder.y,
        px: chosen.pos.x,
        py: chosen.pos.y,
        alpha: 0.28,
      });
      if (chosen.smears.length > 3) chosen.smears.shift();
    }

    if (chosen.mode === 'curled' || chosen.mode === 'idle') {
      const startPt = this.getLiveCurledPawPos(chosen, 0);
      chosen.pos = { x: startPt.x, y: startPt.y };
      chosen.vel = { x: 0, y: 0 };
    }
    chosen.mode = 'poke';
    chosen.target = this.clampToKeyboardSurface(targetPoint);
    chosen.pokeTime = 0;
    chosen.impactSquash = 0.85;
    chosen.lastKeyStrikeAt = now;

    const other = chosen.side === 'left' ? this.rightPaw : this.leftPaw;
    if (other.mode === 'idle' && !activelyMousing) {
      other.mode = 'curled';
    }

    this.showKeyBubble(vk, spec, targetPoint.x, now);
  }

  private showKeyBubble(vk: number, spec: KeySpec, x: number, now: number): void {
    if (!this.showKeyBubbles) return;
    const label = formatBubbleForVk(vk, spec);
    if (label) this.spawnBubble(label, spec.id === 'space', x, now);
  }

  private updateTypingSpeed(now: number): void {
    while (this.recentKeyTimes.length > 0 && now - this.recentKeyTimes[0] > TYPING_WINDOW) {
      this.recentKeyTimes.shift();
    }
    this.fastTyping = this.recentKeyTimes.length >= (this.fastTyping ? 3 : 5);
  }

  private isMouseActive(now: number): boolean {
    return this.mouseLeftDown || this.mouseRightDown || this.mouseMiddleDown ||
      now - this.lastMouseActivityAt < MOUSE_ACTIVITY_WINDOW;
  }

  private getTailRoot(): Vec2 {
    const hip = this.spinePoint(0.84, 0);
    return { x: hip.x + 56, y: hip.y - 2 };
  }

  private tryTailStrike(spec: KeySpec, now: number): TailStrike | null {
    if (!this.fastTyping || now - this.lastMouseMotionAt >= MOUSE_ACTIVITY_WINDOW ||
        now - this.lastTailStrikeAt < 450) return null;

    const target = this.projectKeyboardPoint(
      spec.uStart + spec.uWidth * 0.5,
      (spec.rowY ?? spec.row) + (spec.rowSpan ?? 1) * 0.5,
    );
    const root = this.getTailRoot();
    if (target.x < root.x - 18 || Math.hypot(target.x - root.x, target.y - root.y) > 132) return null;

    this.lastTailStrikeAt = now;
    this.tailStrike = { keyId: spec.id, target, startedAt: now, reach: 0, pressure: 0 };
    return this.tailStrike;
  }

  private updateTailStrike(now: number): void {
    const strike = this.tailStrike;
    if (!strike) return;

    const age = now - strike.startedAt;
    const releaseAt = TAIL_REACH_TIME + TAIL_CONTACT_TIME;
    if (age >= releaseAt + TAIL_RETURN_TIME) {
      this.tailStrike = null;
      return;
    }

    const extension = Math.min(1, age / TAIL_REACH_TIME, 1 - (age - releaseAt) / TAIL_RETURN_TIME);
    strike.reach = extension * extension * (3 - 2 * extension);
    strike.pressure = age >= TAIL_REACH_TIME && age < releaseAt
      ? 1 - Math.abs((age - TAIL_REACH_TIME) / TAIL_CONTACT_TIME * 2 - 1)
      : 0;
  }

  public onKeyUp(vk: number): void {
    this.lastInteractionAt = performance.now();
    const spec = resolveKeyByVk(vk, this.keyboardLayout);
    if (!spec) return;
    const anim = this.keyAnims.get(spec.id);
    if (anim) anim.pressed = false;
  }

  public onGlobalMouseMove(nx: number, ny: number, x = nx * this.logicalW, y = ny * this.logicalH): boolean {
    const anchor = this.mouseMotionAnchor;
    // Keep the last accepted position so slow movements still add up.
    if (anchor && Math.max(Math.abs(x - anchor.x), Math.abs(y - anchor.y)) <= 1) return false;
    this.mouseMotionAnchor = { x, y };
    const now = performance.now();
    this.lastInteractionAt = now;
    this.mouseTargetOffsetX = (nx - 0.5) * 28;
    this.mouseTargetOffsetY = (ny - 0.5) * 20;
    this.lastMouseActivityAt = now;
    this.lastMouseMotionAt = now;

    this.leftPaw.mode = 'mouse';
    return true;
  }

  private getMouseButtonColors(): { left: string; right: string; middle: string } {
    const primary = this.customSkin
      ? this.customSkin.accentColor
      : this.catBreed === 'ragdoll'
        ? '#7ac7ff'
        : '#d4f044';
    const scroll = this.customSkin
      ? this.customSkin.accentSideColor
      : this.catBreed === 'ragdoll'
        ? '#4690d8'
        : '#92ba12';

    // Pick a high-contrast complementary color for RMB so Left vs Right click are unmistakable on every skin
    const isWarmAccent = /^#(f[a-f0-9][89a-c]|ff[789a-c]|e[89a-f][789a])/i.test(primary);
    const rightColor = isWarmAccent ? '#58c7ff' : '#ff7b3b';
    return { left: primary, right: rightColor, middle: scroll };
  }

  private spawnMouseBadge(button: 'left' | 'right' | 'middle', now: number): void {
    if (!this.showKeyBubbles) return;
    const colors = this.getMouseButtonColors();
    const label = button === 'left' ? 'LMB' : button === 'right' ? 'RMB' : 'MMB';
    const color = button === 'left' ? colors.left : button === 'right' ? colors.right : colors.middle;
    const mx = this.mouseBaseX + this.mouseOffsetX;
    const my = this.mouseBaseY + this.mouseOffsetY;
    const isCatFacing = this.keyboardOrientation === 'cat';
    const sideShift =
      button === 'left'
        ? isCatFacing
          ? 10
          : -10
        : button === 'right'
          ? isCatFacing
            ? -10
            : 10
          : 0;

    if (this.mouseBadges.length >= 2) {
      this.mouseBadges.shift();
    }
    this.mouseBadges.push({
      id: this.nextBubbleId++,
      label,
      color,
      x: Math.max(24, mx + sideShift),
      y: my - 30,
      createdAt: now,
      lifetime: 560,
    });
  }

  public onMouseDown(button: string): void {
    const now = performance.now();
    this.lastInteractionAt = now;
    if (button === 'left') {
      this.mouseLeftDown = true;
      this.mouseLeftPress = 1;
      this.spawnMouseBadge('left', now);
    } else if (button === 'right') {
      this.mouseRightDown = true;
      this.mouseRightPress = 1;
      this.spawnMouseBadge('right', now);
    } else if (button === 'middle') {
      this.mouseMiddleDown = true;
      this.mouseMiddlePress = 1;
      this.spawnMouseBadge('middle', now);
    }

    this.lastMouseActivityAt = now;
    this.leftPaw.mode = 'mouse';
    this.leftPaw.impactSquash = 0.72;
  }

  public onMouseUp(button: string): void {
    if (button === 'left') this.mouseLeftDown = false;
    else if (button === 'right') this.mouseRightDown = false;
    else if (button === 'middle') this.mouseMiddleDown = false;
    else return;
    this.lastInteractionAt = this.lastMouseActivityAt = performance.now();
  }

  public onMouseWheel(): void {
    const now = performance.now();
    this.lastInteractionAt = now;
    this.mouseScrollFlash = 1;
    this.lastMouseActivityAt = now;
    this.leftPaw.mode = 'mouse';
  }

  public onWindowCursor(relX: number, relY: number, overCat: boolean): void {
    this.cursorRelX = relX;
    this.cursorRelY = relY;
    this.cursorOverCat = overCat;

    if (overCat && !this.mouseLeftDown && !this.mouseRightDown) {
      const px = relX * this.logicalW;
      const py = relY * this.logicalH;
      if (this.lastPetCursorX !== null && this.lastPetCursorY !== null) {
        const dist = Math.hypot(px - this.lastPetCursorX, py - this.lastPetCursorY);
        if (dist > 1.5 && dist < 80) {
          this.petEnergy = Math.min(1, this.petEnergy + dist * 0.011);
        }
      }
      this.lastPetCursorX = px;
      this.lastPetCursorY = py;
    } else {
      this.lastPetCursorX = null;
      this.lastPetCursorY = null;
    }
  }

  // ---- Keyboard projection ----

  private projectKeyboardPoint(uCol: number, rowPos: number): Vec2 {
    const layout = getKeyboardLayout(this.keyboardLayout);
    const isCatFacing = this.keyboardOrientation === 'cat';
    const screenU = isCatFacing ? layout.totalUnits - uCol : uCol;
    const screenRow = isCatFacing ? layout.totalRows - rowPos : rowPos;

    const innerW = this.kbWidth - KEY_GRID_PAD_X * 2;
    const innerH = this.kbHeight - KEY_GRID_PAD_Y * 2;
    const localX = -innerW / 2 + (screenU / layout.totalUnits) * innerW;
    const localY = -innerH / 2 + (screenRow / layout.totalRows) * innerH;

    const depthFactor = KEY_GRID_BACK_SCALE + (screenRow / layout.totalRows) * KEY_GRID_TAPER;
    const px = localX * depthFactor;
    const py = localY;

    const cos = Math.cos(this.kbTiltRad);
    const sin = Math.sin(this.kbTiltRad);
    return {
      x: this.kbCenterX + px * cos - py * sin,
      y: this.kbCenterY + px * sin + py * cos,
    };
  }

  private getKeyWorldCenter(spec: KeySpec): Vec2 {
    const layout = getKeyboardLayout(this.keyboardLayout);
    const isCatFacing = this.keyboardOrientation === 'cat';
    const uClamped = Math.max(0.65, Math.min(layout.totalUnits - 0.65, spec.uStart + spec.uWidth * 0.5));
    const rY = spec.rowY ?? spec.row;
    const rSpan = spec.rowSpan ?? 1;
    let rowPos = rY + rSpan * 0.5;
    if (isCatFacing && rY <= 0.1) {
      rowPos = rY + 0.68;
    } else if (!isCatFacing && rY + rSpan >= layout.totalRows - 0.1) {
      rowPos = rY + rSpan - 0.68;
    }
    return this.projectKeyboardPoint(uClamped, rowPos);
  }

  private clampToKeyboardSurface(pt: Vec2): Vec2 {
    // Transform into keyboard-local space and clamp so the plump paw pad NEVER extends past the keyboard bezel!
    const dx = pt.x - this.kbCenterX;
    const dy = pt.y - this.kbCenterY;
    const cos = Math.cos(-this.kbTiltRad);
    const sin = Math.sin(-this.kbTiltRad);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;

    const maxX = this.kbWidth * 0.5 - 15;
    const minY = -this.kbHeight * 0.5 + 8;
    const maxY = this.kbHeight * 0.5 - 14;
    const cx = Math.max(-maxX, Math.min(maxX, lx));
    const cy = Math.max(minY, Math.min(maxY, ly));

    const rcos = Math.cos(this.kbTiltRad);
    const rsin = Math.sin(this.kbTiltRad);
    return {
      x: this.kbCenterX + cx * rcos - cy * rsin,
      y: this.kbCenterY + cx * rsin + cy * rcos,
    };
  }

  private spawnBubble(label: string, isSpace: boolean, keyX: number, now: number): void {
    if (this.bubbles.length >= 6) {
      this.bubbles.shift();
    }
    const minX = this.keyboardLayout === '108' ? 145 : 125;
    const maxX = this.logicalW - 105;
    const baseX = Math.max(minX, Math.min(maxX, keyX * 0.45 + this.kbCenterX * 0.55));
    const staggerY = 258 + ((this.nextBubbleId % 3) - 1) * 10 + (Math.random() - 0.5) * 6;
    this.bubbles.push({
      id: this.nextBubbleId++,
      label,
      isSpace,
      x: baseX,
      targetX: baseX,
      y: 292,
      targetY: staggerY,
      rot: ((Math.random() - 0.5) * 4.5 * Math.PI) / 180,
      createdAt: now,
      lifetime: 940,
    });
    this.layoutBubbles();
  }

  private layoutBubbles(): void {
    const count = this.bubbles.length;
    if (count === 0) return;

    const widths = this.bubbles.map((b) => (b.isSpace ? 40 : Math.max(25, b.label.length * 7.5 + 14)));
    const gap = 3.5;
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (count - 1);
    const anchor = this.kbCenterX + 12;
    const leftBound = this.keyboardLayout === '108' ? 140 : 126;
    const rightBound = this.logicalW - 82;
    let cursor = Math.max(leftBound, Math.min(rightBound - totalW, anchor - totalW * 0.5));

    for (let i = 0; i < count; i++) {
      const w = widths[i];
      this.bubbles[i].targetX = cursor + w * 0.5;
      cursor += w + gap;
    }
  }

  // ---- Simulation update ----

  private canSleep(now: number): boolean {
    if (now - this.lastInteractionAt < AUTO_SLEEP_DELAY ||
        this.mouseLeftDown || this.mouseRightDown || this.mouseMiddleDown) return false;
    for (const key of this.keyAnims.values()) {
      if (key.pressed) return false;
    }
    return true;
  }

  private update(dt: number, now: number): void {
    this.elapsed += dt;
    if (this.canSleep(now)) this.sleepStartedAt ??= now;
    else this.sleepStartedAt = null;
    const shouldDoze = this.sleepStartedAt !== null && !this.petPainter;
    const sleepEase = 1 - Math.exp(-(shouldDoze ? 4 : 14) * dt);
    this.sleepDepth += (Number(shouldDoze) - this.sleepDepth) * sleepEase;

    const mLerp = 1 - Math.exp(-28 * dt);
    this.mouseOffsetX += (this.mouseTargetOffsetX - this.mouseOffsetX) * mLerp;
    this.mouseOffsetY += (this.mouseTargetOffsetY - this.mouseOffsetY) * mLerp;
    if (!this.mouseLeftDown && this.mouseLeftPress > 0) {
      this.mouseLeftPress = Math.max(0, this.mouseLeftPress - dt * 5.8);
    }
    if (!this.mouseRightDown && this.mouseRightPress > 0) {
      this.mouseRightPress = Math.max(0, this.mouseRightPress - dt * 5.8);
    }
    if (!this.mouseMiddleDown && this.mouseMiddlePress > 0) {
      this.mouseMiddlePress = Math.max(0, this.mouseMiddlePress - dt * 5.8);
    }
    this.mouseScrollFlash = Math.max(0, this.mouseScrollFlash - dt * 4.5);
    this.mouseBadges = this.mouseBadges.filter((b) => now - b.createdAt < b.lifetime);

    this.updateTypingSpeed(now);
    this.updateTailStrike(now);
    const targetTypingEnergy = Math.min(1, this.recentKeyTimes.length / 7);
    this.typingEnergy += (targetTypingEnergy - this.typingEnergy) * (1 - Math.exp(-9 * dt));

    const isTypingRecently = now - this.lastAnyKeyAt < 650;
    const targetHunch = isTypingRecently ? 0.45 + this.typingEnergy * 0.55 : 0;
    this.typingHunch += (targetHunch - this.typingHunch) * (1 - Math.exp(-10 * dt));

    const rockAcc = -this.strikeRock * 140 - this.strikeRockVel * 14;
    this.strikeRockVel += rockAcc * dt;
    this.strikeRock = Math.max(-1, Math.min(1, this.strikeRock + this.strikeRockVel * dt));

    this.bodyBob = Math.max(0, this.bodyBob - dt * 11.5);
    this.kbBounce = Math.max(0, this.kbBounce - dt * 15);

    // Playful left-right body & head groove sway during pure typing (matches original video first half!)
    const pureTypingActive = isTypingRecently && this.leftPaw.mode !== 'mouse';
    if (pureTypingActive) {
      this.typingGroovePhase += dt * (4.8 + this.typingEnergy * 5.2);
    }
    const grooveWave = Math.sin(this.typingGroovePhase) * (0.58 + this.typingEnergy * 0.44);
    const targetTypingSway = pureTypingActive
      ? Math.max(-1.1, Math.min(1.1, grooveWave * 0.72 + this.lastKeyBias * 0.55))
      : this.leftPaw.mode === 'mouse' && isTypingRecently
        ? Math.sin(this.typingGroovePhase) * 0.16
        : 0;
    const swayAcc = (targetTypingSway - this.typingSway) * 118 - this.typingSwayVel * 12.5;
    this.typingSwayVel += swayAcc * dt;
    this.typingSway = Math.max(-1.2, Math.min(1.2, this.typingSway + this.typingSwayVel * dt));

    // Measured spine-shear lean: shifts head & chest cleanly forward-left toward mouse while hips stay anchored!
    let targetLean = 0;
    if (this.leftPaw.mode === 'mouse') {
      const mouseSweepBias = (this.mouseOffsetX / 18) * 0.22;
      targetLean = this.rightPaw.mode === 'poke'
        ? -0.52 + mouseSweepBias
        : -0.96 + mouseSweepBias;
    }
    this.spineLean += (targetLean - this.spineLean) * (1 - Math.exp(-10 * dt));

    const desiredHeadTilt =
      this.typingSway * 0.18 +
      this.typingHunch * (this.strikeRock * 0.065 - 0.02) +
      this.spineLean * 0.085;
    this.headTilt += (desiredHeadTilt - this.headTilt) * (1 - Math.exp(-12 * dt));

    this.petEnergy = Math.max(0, this.petEnergy - dt * (this.cursorOverCat ? 0.22 : 0.65));
    const wantSquint = this.petEnergy > 0.3 ? 1 : 0;
    this.squintAmount += (wantSquint - this.squintAmount) * (1 - Math.exp(-12 * dt));
    catAudio.setPurrIntensity(this.squintAmount > 0.25 ? this.squintAmount : 0);

    this.earTwitchLeft = Math.max(0, this.earTwitchLeft - dt * 8);
    this.earTwitchRight = Math.max(0, this.earTwitchRight - dt * 8);

    if (!this.isBlinking && this.elapsed >= this.nextBlinkAt) {
      this.isBlinking = true;
      this.blinkProgress = 0;
    }
    if (this.isBlinking) {
      this.blinkProgress += dt * 12;
      if (this.blinkProgress >= 2) {
        this.isBlinking = false;
        this.blinkProgress = 0;
        this.nextBlinkAt = this.elapsed + 2.8 + Math.random() * 3.6;
      }
    }

    // 100% live eye tracking toward cursor, OR cozy bottom-edge glance at keys during pure typing!
    const eyePos = this.spinePoint(0.24, 0);
    const eyeCenterRelX = eyePos.x / this.logicalW;
    const eyeCenterRelY = eyePos.y / this.logicalH;
    let dx = this.cursorRelX - eyeCenterRelX;
    let dy = this.cursorRelY - eyeCenterRelY;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.001) {
      const mag = Math.min(1, dist * 1.9);
      dx = (dx / dist) * mag;
      dy = (dy / dist) * mag;
    }
    const mouseRecentlyMoved = now - this.lastMouseActivityAt < 2400;
    const pureTypingGlance = mouseRecentlyMoved ? 0 : this.typingHunch;
    const targetEyeX =
      dx * 7.0 * (1 - pureTypingGlance * 0.45) +
      pureTypingGlance * (this.typingSway * 3.8 + this.lastKeyBias * 2.2);
    const targetEyeY = dy * 5.2 * (1 - pureTypingGlance * 0.45) + pureTypingGlance * 5.8;
    const eyeLerp = 1 - Math.exp(-20 * dt);
    this.eyeLookX += (targetEyeX - this.eyeLookX) * eyeLerp;
    this.eyeLookY += (targetEyeY - this.eyeLookY) * eyeLerp;

    const targetFaceTurn = (dx * 4.0 + this.spineLean * 8.0 + this.typingSway * 8.5 + pureTypingGlance * 1.5) * (1 - this.sleepDepth);
    this.faceTurnX += (targetFaceTurn - this.faceTurnX) * (1 - Math.exp(-11 * dt));

    for (const anim of this.keyAnims.values()) {
      if (!anim.pressed && anim.pressAmount > 0) {
        anim.pressAmount = Math.max(0, anim.pressAmount - dt * 5.0);
      }
    }

    this.updatePaw(this.leftPaw, dt, now);
    this.updatePaw(this.rightPaw, dt, now);

    const beforeLen = this.bubbles.length;
    this.bubbles = this.bubbles.filter((b) => now - b.createdAt < b.lifetime);
    if (this.bubbles.length !== beforeLen) {
      this.layoutBubbles();
    }
    for (const b of this.bubbles) {
      const age = (now - b.createdAt) / b.lifetime;
      b.x += (b.targetX - b.x) * (1 - Math.exp(-18 * dt));
      const desiredY = b.targetY - age * 10;
      b.y += (desiredY - b.y) * (1 - Math.exp(-16 * dt));
    }
  }

  private updatePaw(paw: PawState, dt: number, now: number): void {
    const liveMouseX = this.mouseBaseX + this.mouseOffsetX;
    const liveMouseY = this.mouseBaseY + this.mouseOffsetY;

    if (paw.mode === 'mouse') {
      const isCatFacing = this.keyboardOrientation === 'cat';
      const lrBias = this.mouseLeftPress - this.mouseRightPress;
      const anyClickPress = Math.max(this.mouseLeftPress, this.mouseRightPress, this.mouseMiddlePress);
      if (isCatFacing) {
        // 180° cat-facing: palm heel at TOP, LMB = inner/+X, RMB = outer/-X
        paw.target = {
          x: liveMouseX + 1.2 + lrBias * 6.4,
          y: liveMouseY - 11.5 + anyClickPress * 3.6,
        };
      } else {
        // 0° viewer-facing: palm heel at BOTTOM, LMB = left/-X, RMB = right/+X
        paw.target = {
          x: liveMouseX + 0.5 - lrBias * 6.4,
          y: liveMouseY + 10.0 - anyClickPress * 3.4,
        };
      }
      const typingRecently = now - this.lastAnyKeyAt < 650;
      const stillHolding = this.isMouseActive(now) ||
        (!typingRecently && now - this.lastMouseActivityAt < 2200);
      if (!stillHolding) {
        paw.mode = typingRecently ? 'curled' : 'idle';
      }
    } else if (paw.mode === 'poke') {
      paw.pokeTime += dt;
      const activelyMousing = this.isMouseActive(now);
      const strokeDuration = this.fastTyping && !activelyMousing ? 0.17 : 0.13;
      if (paw.pokeTime > strokeDuration) {
        if (paw.side === 'left' && activelyMousing) {
          paw.mode = 'mouse';
        } else if (now - this.lastAnyKeyAt < 650) {
          paw.mode = 'curled';
        } else {
          paw.mode = 'idle';
        }
      }
    } else if (paw.mode === 'curled') {
      if (now - this.lastAnyKeyAt > 680) {
        paw.mode = 'idle';
      }
    }

    if (paw.mode === 'curled') {
      paw.target = this.getLiveCurledPawPos(paw, 0);
    } else if (paw.mode === 'idle') {
      const baseSp = this.spinePoint(1.0, 0);
      paw.target = { x: baseSp.x + (paw.side === 'left' ? -19 : 19), y: baseSp.y };
    }

    const wantIdle = paw.mode === 'idle' ? 1 : 0;
    const wantCurl = paw.mode === 'curled' ? 1 : 0;
    const blendRate = 1 - Math.exp(-20 * dt);
    paw.idleWeight += (wantIdle - paw.idleWeight) * blendRate;
    paw.curlWeight += (wantCurl - paw.curlWeight) * blendRate;

    // Unconditionally stable, framerate-independent tracking (ZERO Euler spring overshoot at any FPS!)
    const followRate = paw.mode === 'poke' ? 42 : paw.mode === 'mouse' ? 32 : 22;
    const follow = 1 - Math.exp(-followRate * dt);
    paw.pos.x += (paw.target.x - paw.pos.x) * follow;
    paw.pos.y += (paw.target.y - paw.pos.y) * follow;
    paw.vel.x = 0;
    paw.vel.y = 0;

    // Hard guarantee: while poking a key, paw tip stays strictly on top of the keyboard surface
    if (paw.mode === 'poke') {
      const clamped = this.clampToKeyboardSurface(paw.pos);
      if (clamped.y < paw.pos.y || Math.abs(clamped.x - paw.pos.x) > 0.01) {
        paw.pos.x = clamped.x;
        paw.pos.y = Math.min(paw.pos.y, clamped.y);
      }
    }

    paw.impactSquash = Math.max(0, paw.impactSquash - dt * 7.5);

    for (const s of paw.smears) {
      s.alpha -= dt * 3.8;
    }
    paw.smears = paw.smears.filter((s) => s.alpha > 0.02);
  }

  // ---- High-fidelity true-scale rendering ----

  private render(): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    ctx.save();
    if (this.embedded) {
      const baseFit = Math.min((cw * 0.86) / this.logicalW, (ch * 0.86) / this.logicalH);
      const effectiveMul = this.renderScale <= 1.0 ? this.renderScale : 1.0 + (this.renderScale - 1.0) * 0.30;
      const uniformScale = baseFit * effectiveMul;
      const drawW = this.logicalW * uniformScale;
      const drawH = this.logicalH * uniformScale;
      const offsetX = (cw - drawW) * 0.5;
      const offsetY = (ch - drawH) * 0.52;
      ctx.translate(offsetX, offsetY);
      ctx.scale(uniformScale, uniformScale);
    } else {
      const cssW = Math.max(1, window.innerWidth);
      const dpr = cw / cssW;
      const fitScale = Math.min(cw / this.logicalW, ch / this.logicalH);
      const uniformScale = Math.min(fitScale, this.renderScale * dpr);
      const drawW = this.logicalW * uniformScale;
      const drawH = this.logicalH * uniformScale;
      const offsetX = cw - drawW;
      const offsetY = ch - drawH;
      ctx.translate(offsetX, offsetY);
      ctx.scale(uniformScale, uniformScale);
    }

    if (this.landingPainter) {
      if (this.landingPainter(ctx, this.lastTime)) {
        ctx.restore();
        return;
      }
      this.landingPainter = null;
    }

    if (this.petPainter) {
      this.petPainter(ctx, this.lastTime, this.sleepStartedAt !== null);
      ctx.restore();
      return;
    }

    const breath = Math.sin(this.elapsed * 2.1) * 1.0;
    const purrShift = this.squintAmount > 0.4 ? Math.sin(this.elapsed * 22) * 0.45 * this.squintAmount : 0;

    if (!this.tailStrike) this.drawTail(ctx);

    // Layer 2: Mini mouse & 65% mechanical keyboard
    this.drawPetEquipment(ctx, 'mouse');
    this.drawPetEquipment(ctx, 'keyboard');
    // A reaching tail crosses in front of the keyboard and behind the cat.
    if (this.tailStrike) this.drawTail(ctx);

    // Layer 3: Exact measured spine-deformable cat silhouette (ears, cheeks, neck, pear belly, grounded hind feet, eyes & tiny whiskers)
    const sleeves = hasSleeves(this.petSkin) ? this.getCostumeSleeves(breath, purrShift) : [];
    this.drawCatBody(ctx, breath, purrShift, sleeves);

    // Layer 4: True-scale velvety cat paws (tapered idle legs / planted diagonal mouse support leg / bent curled chest paw / plump round poking paw!)
    this.drawPaw(ctx, this.leftPaw, breath);
    this.drawPaw(ctx, this.rightPaw, breath);
    for (const sleeve of sleeves) this.wardrobe.sleeve(this.petSkin, sleeve, false);
    this.paintWeekdaySign(ctx, undefined, undefined, .80);

    if (this.sleepStartedAt !== null && this.sleepDepth > .85) {
      const head = this.spinePoint(.1, breath);
      drawSleepIndicator(ctx, head.x + 57, head.y + 1, this.lastTime - this.sleepStartedAt);
    }

    // Layer 5: Organic bouncing 3D keycap bubbles & crisp mouse click badges
    if (this.showKeyBubbles) {
      this.drawKeyBubbles(ctx);
      this.drawMouseBadges(ctx);
    }

    ctx.restore();
  }

  private drawTail(ctx: CanvasRenderingContext2D): void {
    // Exact ORIG 0.3s tail: leaves hip slightly higher, flat horizontal start curving cleanly up into a soft horizontal S-hook!
    const gentleDrift = Math.sin(this.elapsed * 0.9) * 1.4;
    const { x: startX, y: startY } = this.getTailRoot();
    let cp1X = startX + 34;
    let cp1Y = startY + 4 + gentleDrift * 0.25;
    let cp2X = startX + 38;
    let cp2Y = startY - 34 + gentleDrift * 0.45;
    let endX = startX + 70 + gentleDrift * 0.35;
    let endY = startY - 35 + gentleDrift;

    const strike = this.tailStrike;
    if (strike) {
      const { target, reach } = strike;
      const targetY = target.y + this.kbBounce * 1.1;
      cp1X += 18 * reach;
      cp1Y += (startY + 12 - cp1Y) * reach;
      cp2X += (target.x + 30 - cp2X) * reach;
      cp2Y += (targetY - 34 - cp2Y) * reach;
      endX += (target.x - endX) * reach;
      endY += (targetY - endY) * reach;
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (this.customSkin) {
      const s = this.customSkin;
      const tailW = s.tailFluffy ? 20.0 : 16.0;
      if (s.outlineColor) {
        ctx.shadowColor = 'rgba(30, 32, 40, 0.22)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1.5;
        ctx.strokeStyle = s.outlineColor;
        ctx.lineWidth = tailW + 3.4;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
      } else {
        ctx.shadowColor = 'rgba(18, 17, 18, 0.42)';
        ctx.shadowBlur = 1.6;
      }

      const tailGrad = ctx.createLinearGradient(startX, startY, endX, endY);
      tailGrad.addColorStop(0.0, s.tailColor);
      tailGrad.addColorStop(1.0, s.tailTipColor);
      ctx.strokeStyle = tailGrad;
      ctx.lineWidth = tailW;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY);
      ctx.stroke();

      if (s.tailFluffy) {
        ctx.fillStyle = s.tailTipColor;
        ctx.beginPath();
        ctx.ellipse(endX + 1, endY, 11.8, 10.2, -0.15, 0, Math.PI * 2);
        ctx.fill();
      }

      // Cute tabby tail rings when tailStripes is enabled!
      if (s.tailStripes && (s.stripeColor || s.tailTipColor)) {
        const ringColor = s.stripeColor || s.tailTipColor;
        ctx.strokeStyle = ringColor;
        ctx.lineWidth = 3.2;
        ctx.shadowBlur = 0;
        for (const t of [0.24, 0.44, 0.64, 0.82]) {
          const mt = 1 - t;
          const bx =
            mt * mt * mt * startX +
            3 * mt * mt * t * cp1X +
            3 * mt * t * t * cp2X +
            t * t * t * endX;
          const by =
            mt * mt * mt * startY +
            3 * mt * mt * t * cp1Y +
            3 * mt * t * t * cp2Y +
            t * t * t * endY;
          const tx =
            3 * mt * mt * (cp1X - startX) +
            6 * mt * t * (cp2X - cp1X) +
            3 * t * t * (endX - cp2X);
          const ty =
            3 * mt * mt * (cp1Y - startY) +
            6 * mt * t * (cp2Y - cp1Y) +
            3 * t * t * (endY - cp2Y);
          const tLen = Math.max(1, Math.hypot(tx, ty));
          const nx = (-ty / tLen) * (tailW * 0.42);
          const ny = (tx / tLen) * (tailW * 0.42);
          ctx.beginPath();
          ctx.moveTo(bx - nx, by - ny);
          ctx.lineTo(bx + nx, by + ny);
          ctx.stroke();
        }
      }

      ctx.restore();
      return;
    }

    if (this.catBreed === 'ragdoll') {
      // Plush bushy warm cocoa-taupe Ragdoll plume tail matching the real cat photo!
      ctx.shadowColor = 'rgba(48, 38, 30, 0.22)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1.5;
      ctx.strokeStyle = '#4e4239';
      ctx.lineWidth = 23.5;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      const tailGrad = ctx.createLinearGradient(startX, startY, endX, endY);
      tailGrad.addColorStop(0.0, '#8d7e6f');
      tailGrad.addColorStop(0.5, '#726356');
      tailGrad.addColorStop(1.0, '#584b40');
      ctx.strokeStyle = tailGrad;
      ctx.lineWidth = 20.2;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY);
      ctx.stroke();

      // Bushy warm cocoa-taupe plume tip puff
      ctx.fillStyle = '#584b40';
      ctx.beginPath();
      ctx.ellipse(endX + 1, endY, 12.2, 10.6, -0.15, 0, Math.PI * 2);
      ctx.fill();

      // Soft warm creamy sheen along upper fluff curve
      ctx.strokeStyle = 'rgba(246, 240, 232, 0.26)';
      ctx.lineWidth = 5.0;
      ctx.beginPath();
      ctx.moveTo(startX + 4, startY - 4);
      ctx.bezierCurveTo(cp1X - 2, cp1Y - 4, cp2X - 3, cp2Y - 4, endX - 3, endY - 4);
      ctx.stroke();
    } else {
      ctx.shadowColor = 'rgba(18, 17, 18, 0.45)';
      ctx.shadowBlur = 1.6;
      ctx.strokeStyle = '#141314';
      ctx.lineWidth = 16.0;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY);
      ctx.stroke();
    }

    ctx.restore();
  }

  private getCostumeSleeves(breath: number, purrShift: number): Arm[] {
    const idleCuff = this.spinePoint(.85, breath);
    return [this.leftPaw, this.rightPaw].map(paw => {
      const shoulder = this.getLiveShoulder(paw, breath);
      const curl = this.getLiveCurledPawPos(paw, breath);
      const sign = paw.side === 'left' ? -1 : 1;
      const reach = Math.max(0, 1 - paw.idleWeight - paw.curlWeight);
      const mouseDrop = paw.mode === 'mouse'
        ? Math.max(this.mouseLeftPress, this.mouseRightPress, this.mouseMiddlePress) * 1.8 : 0;
      const tip = { x: paw.pos.x, y: paw.pos.y + mouseDrop };
      const distance = Math.hypot(tip.x - shoulder.x, tip.y - shoulder.y);
      const maxLength = this.petSkin === 'sakura' ? 72 : 53;
      const length = Math.min(.66, maxLength / Math.max(1, distance));
      const cuffX = blendCuff(idleCuff.x + sign * 24, curl.x, tip.x, shoulder.x);
      const cuffY = blendCuff(idleCuff.y, curl.y, tip.y, shoulder.y);
      return [
        shoulder.x + (cuffX - shoulder.x) * .14 + purrShift,
        shoulder.y + (cuffY - shoulder.y) * .16 + 3,
        cuffX + purrShift, cuffY,
      ];

      function blendCuff(idle: number, curled: number, active: number, root: number): number {
        return idle * paw.idleWeight + (root + (curled - root) * .68) * paw.curlWeight
          + (root + (active - root) * length) * reach;
      }
    });
  }

  private drawCatBody(ctx: CanvasRenderingContext2D, breath: number, purrShift: number, sleeves: Arm[]): void {
    if (this.customSkin) {
      this.drawCustomCatBody(ctx, this.customSkin, breath, purrShift);
      return;
    }
    const isRagdoll = this.catBreed === 'ragdoll';
    const catBlack = '#141314';
    const inkOutline = '#5d5148';

    // Evaluate measured left & right silhouette points deformed by flexible cat spine + unified head tilt!
    const leftPts: Vec2[] = [];
    const rightPts: Vec2[] = [];
    const bellySwell = 1 + this.typingHunch * 0.04;
    const headCenter = this.spinePoint(0.24, breath);
    const hcx = headCenter.x + purrShift;
    const hcy = headCenter.y;

    for (const slice of BODY_SLICES) {
      const sp = this.spinePoint(slice.t, breath);
      const widen = slice.t > 0.45 ? bellySwell : 1;
      const hw = slice.hw * widen;

      if (slice.t <= 0.38) {
        const tiltW = slice.t <= 0.30 ? 1.0 : (0.42 - slice.t) / 0.12;
        const ang = this.headTilt * tiltW;
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        const relY = sp.y - hcy;
        const lx0 = sp.x + purrShift - hw - hcx;
        const rx0 = sp.x + purrShift + hw - hcx;
        leftPts.push({
          x: hcx + lx0 * cosA - relY * sinA,
          y: hcy + lx0 * sinA + relY * cosA,
        });
        rightPts.push({
          x: hcx + rx0 * cosA - relY * sinA,
          y: hcy + rx0 * sinA + relY * cosA,
        });
      } else {
        leftPts.push({ x: sp.x + purrShift - hw, y: sp.y });
        rightPts.push({ x: sp.x + purrShift + hw, y: sp.y });
      }
    }

    const crownRelY = this.spinePoint(0.11, breath).y - hcy;
    const crownPt = {
      x: hcx - crownRelY * Math.sin(this.headTilt),
      y: hcy + crownRelY * Math.cos(this.headTilt),
    };
    const basePt = this.spinePoint(1.0, breath);
    const back = this.spinePoint(.60, breath);
    const neck = this.spinePoint(.42, breath);
    if (this.petSkin === 'explorer') this.wardrobe.pack(back.x + 59 + purrShift, back.y + 4, false);

    ctx.save();
    if (isRagdoll) {
      ctx.shadowColor = 'rgba(26, 30, 40, 0.24)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'rgba(18, 17, 18, 0.42)';
      ctx.shadowBlur = 1.6;
    }

    // 1) Cute rounded grounded hind paws peeking out when front paws lift (matches 8.3s, 10.6s, 13.2s, 31.0s!)
    const anyFrontLifted = this.leftPaw.idleWeight < 0.7 || this.rightPaw.idleWeight < 0.7;
    if (anyFrontLifted) {
      ctx.fillStyle = isRagdoll ? '#f7f5f0' : catBlack;
      ctx.strokeStyle = inkOutline;
      ctx.lineWidth = 1.9;
      for (const [fx, fy, rx, ry] of [
        [basePt.x - 42, basePt.y - 3, 14.5, 11.5],
        [basePt.x + 32, basePt.y - 1, 15.0, 11.5],
      ]) {
        ctx.beginPath();
        ctx.ellipse(fx, fy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        if (isRagdoll) {
          ctx.save();
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 2) Build exact smooth spline through measured silhouette slices (left top -> right top -> right down -> bottom -> left up)!
    const traceBodyPath = () => {
      ctx.beginPath();
      const crownCos = Math.cos(this.headTilt);
      const crownSin = Math.sin(this.headTilt);
      ctx.moveTo(leftPts[0].x + 14 * crownCos + 6 * crownSin, leftPts[0].y + 14 * crownSin - 6 * crownCos);
      ctx.quadraticCurveTo(crownPt.x, crownPt.y - 2, rightPts[0].x - 14 * crownCos + 6 * crownSin, rightPts[0].y - 14 * crownSin - 6 * crownCos);

      ctx.lineTo(rightPts[0].x, rightPts[0].y);
      for (let i = 0; i < rightPts.length - 1; i++) {
        const p0 = rightPts[i];
        const p1 = rightPts[i + 1];
        const mx = (p0.x + p1.x) * 0.5;
        const my = (p0.y + p1.y) * 0.5;
        ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
      }
      const lastR = rightPts[rightPts.length - 1];
      ctx.lineTo(lastR.x, lastR.y);

      const lastL = leftPts[leftPts.length - 1];
      ctx.quadraticCurveTo(basePt.x + purrShift, basePt.y + 6, lastL.x, lastL.y);

      for (let i = leftPts.length - 1; i > 0; i--) {
        const p0 = leftPts[i];
        const p1 = leftPts[i - 1];
        const mx = (p0.x + p1.x) * 0.5;
        const my = (p0.y + p1.y) * 0.5;
        ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
      }
      ctx.lineTo(leftPts[0].x, leftPts[0].y);
      ctx.closePath();
    };

    traceBodyPath();
    if (isRagdoll) {
      // Warm creamy ivory base coat matching the real fluffy Ragdoll photo!
      const furGrad = ctx.createRadialGradient(hcx, hcy + 68, 18, basePt.x, basePt.y - 60, 148);
      furGrad.addColorStop(0.0, '#fbf9f3');
      furGrad.addColorStop(0.68, '#f4f0e6');
      furGrad.addColorStop(1.0, '#e8e2d6');
      ctx.fillStyle = furGrad;
      ctx.fill();

      // Paint custom warm milk-tea taupe Ragdoll markings clipped cleanly inside the body silhouette!
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.clip();

      // 2a) Plush warm taupe-brown lower flanks / hips wrapping around both outer thighs (matches photo!)
      const midTorso = this.spinePoint(0.72, breath);
      for (const sgn of [-1, 1]) {
        const flankGrad = ctx.createRadialGradient(
          midTorso.x + purrShift + sgn * 70,
          midTorso.y + 8,
          14,
          midTorso.x + purrShift + sgn * 50,
          midTorso.y + 10,
          72,
        );
        flankGrad.addColorStop(0.0, 'rgba(130, 115, 100, 0.78)');
        flankGrad.addColorStop(0.50, 'rgba(156, 141, 126, 0.45)');
        flankGrad.addColorStop(0.82, 'rgba(178, 165, 150, 0.14)');
        flankGrad.addColorStop(1.0, 'rgba(190, 178, 164, 0.0)');
        ctx.fillStyle = flankGrad;
        ctx.beginPath();
        ctx.ellipse(midTorso.x + purrShift + sgn * 60, midTorso.y + 8, 52, 84, sgn * -0.14, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2b) Subtle fluffy creamy-white chest lion-mane fur tufts under chin
      const neckSp = this.spinePoint(0.47, breath);
      ctx.strokeStyle = 'rgba(182, 170, 156, 0.36)';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(neckSp.x + purrShift, neckSp.y - 2, 34, 0.22 * Math.PI, 0.78 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(neckSp.x + purrShift - 16, neckSp.y + 18, 14, 0.18 * Math.PI, 0.72 * Math.PI);
      ctx.arc(neckSp.x + purrShift + 16, neckSp.y + 18, 14, 0.28 * Math.PI, 0.82 * Math.PI);
      ctx.stroke();

      // 2c) Custom warm milk-tea taupe crown cap & wide fluffy creamy-white blaze (1:1 match to user's real Ragdoll photos!)
      ctx.save();
      ctx.translate(hcx, hcy);
      ctx.rotate(this.headTilt);

      const maskShift = this.faceTurnX * 0.72;
      // Rich warm latte-taupe head mask covering crown, ears base, temples & outer cheeks
      const capGrad = ctx.createLinearGradient(0, -40, 0, 22);
      capGrad.addColorStop(0.0, '#8d7d6e');
      capGrad.addColorStop(0.42, '#9e8e7f');
      capGrad.addColorStop(0.84, '#b3a495');
      capGrad.addColorStop(1.0, 'rgba(186, 173, 158, 0.14)');

      ctx.fillStyle = capGrad;
      ctx.shadowColor = 'rgba(138, 122, 108, 0.45)';
      ctx.shadowBlur = 4.8;

      // Full warm milk-tea head mask curving around outer eyes & cheeks, opening into a wide soft fluffy white blaze!
      ctx.beginPath();
      ctx.moveTo(-74, -44);
      ctx.lineTo(74, -44);
      ctx.lineTo(70, 20);
      ctx.quadraticCurveTo(maskShift + 42, 18, maskShift + 26, 9);
      ctx.quadraticCurveTo(maskShift + 17, 0, maskShift + 13.5, -13);
      // Soft wide fluffy dome peak of the creamy-white blaze between the brows (warm latte bridge stays connected across forehead!)
      ctx.quadraticCurveTo(maskShift + 7, -21.5, maskShift, -22.5);
      ctx.quadraticCurveTo(maskShift - 7, -21.5, maskShift - 13.5, -13);
      ctx.quadraticCurveTo(maskShift - 17, 0, maskShift - 26, 9);
      ctx.quadraticCurveTo(maskShift - 42, 18, -70, 20);
      ctx.closePath();
      ctx.fill();

      // Lighter warm champagne-beige soft forehead bridge highlight right between the ears (exact match to close-up photo!)
      ctx.shadowBlur = 5.5;
      ctx.fillStyle = 'rgba(208, 194, 176, 0.58)';
      ctx.beginPath();
      ctx.ellipse(maskShift, -32, 18, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      // Deeper warm taupe-brown shading along outer temples below both ears
      ctx.fillStyle = 'rgba(116, 100, 86, 0.40)';
      ctx.beginPath();
      ctx.ellipse(-44 + maskShift * 0.4, -10, 21, 22, -0.18, 0, Math.PI * 2);
      ctx.ellipse(44 + maskShift * 0.4, -10, 21, 22, 0.18, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore(); // end mask head-space
      ctx.restore(); // end body clip

      // Clean refined soft warm-brown body outline so creamy fur pops crisply on BOTH light & dark wallpapers!
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      traceBodyPath();
      ctx.strokeStyle = inkOutline;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = catBlack;
      ctx.fill();
    }

    if (this.petSkin !== 'plain') {
      ctx.save();
      ctx.shadowBlur = 0;
      const hem = this.spinePoint(.86, breath);
      this.wardrobe.body(this.petSkin, [
        neck.x + purrShift - 52, neck.x + purrShift + 52, neck.y + 1,
        hem.x + purrShift - 69 * bellySwell, hem.x + purrShift + 69 * bellySwell, hem.y, sleeves,
      ], false);
      if (this.petSkin === 'explorer') {
        this.wardrobe.explorerStraps({
          neck: [neck.x + purrShift, neck.y - 2, this.headTilt],
          back: [back.x + purrShift + 64, back.y - 4],
        }, false, 'ready');
      }
      ctx.restore();
    }

    // 3) Compact plush rounded cat ears matching ORIG 0.3s exact height (shorter & cuter, no tall rabbit ears!)
    ctx.save();
    ctx.translate(hcx, hcy);
    ctx.rotate(this.headTilt);

    const lTwitch = Math.sin(this.earTwitchLeft * Math.PI) * 0.12;
    const rTwitch = Math.sin(this.earTwitchRight * Math.PI) * 0.12;

    const drawOneEar = (sideSign: -1 | 1, twitch: number) => {
      ctx.save();
      ctx.translate(sideSign * 33 + this.faceTurnX * 0.18, -28);
      ctx.rotate(sideSign * (0.08 + twitch));

      const earPath = () => {
        ctx.beginPath();
        ctx.moveTo(sideSign * 19, 20);
        ctx.bezierCurveTo(sideSign * 19, -8, sideSign * 12, -23, sideSign * 3, -21);
        ctx.bezierCurveTo(sideSign * -8, -18, sideSign * -16, -6, sideSign * -21, 8);
        ctx.closePath();
      };

      if (isRagdoll) {
        // Rich dark espresso-taupe ear rims fading to soft warm latte base (1:1 match to user's real cat!)
        const earGrad = ctx.createLinearGradient(0, -23, 0, 18);
        earGrad.addColorStop(0.0, '#463b33');
        earGrad.addColorStop(0.42, '#625449');
        earGrad.addColorStop(0.82, '#8b7c6e');
        earGrad.addColorStop(1.0, '#9c8d7e');
        ctx.fillStyle = earGrad;
        earPath();
        ctx.fill();

        // Stroke outer ear rim cleanly (open at bottom skull merge so there is zero seam line!)
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = '#473c34';
        ctx.lineWidth = 1.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sideSign * 19, 17);
        ctx.bezierCurveTo(sideSign * 19, -8, sideSign * 12, -23, sideSign * 3, -21);
        ctx.bezierCurveTo(sideSign * -8, -18, sideSign * -16, -6, sideSign * -19, 5);
        ctx.stroke();

        // Soft warm dusty-blush cream inner ear
        ctx.fillStyle = '#dec4be';
        ctx.beginPath();
        ctx.moveTo(sideSign * 11, 10);
        ctx.bezierCurveTo(sideSign * 11, -3, sideSign * 7, -13, sideSign * 2, -11);
        ctx.bezierCurveTo(sideSign * -4, -9, sideSign * -9, -1, sideSign * -10, 8);
        ctx.closePath();
        ctx.fill();

        // Fluffy creamy-white Ragdoll ear furnishings
        ctx.strokeStyle = 'rgba(252, 249, 242, 0.90)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(sideSign * -7, 6);
        ctx.quadraticCurveTo(sideSign * -1, 3, sideSign * 5, 6);
        ctx.moveTo(sideSign * -4, 10);
        ctx.quadraticCurveTo(sideSign * 2, 7.5, sideSign * 8, 10);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = catBlack;
        earPath();
        ctx.fill();
      }
      ctx.restore();
    };

    drawOneEar(-1, lTwitch);
    drawOneEar(1, rTwitch);

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    const wShift = this.faceTurnX * 0.72;

    // 4) Ragdoll rosy petting blush + adorable tiny pink nose & gentle kitten smile!
    if (isRagdoll) {
      if (this.squintAmount > 0.12) {
        ctx.fillStyle = `rgba(244, 146, 166, ${(0.42 * this.squintAmount).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(wShift - 30, 13, 8.5, 4.6, -0.08, 0, Math.PI * 2);
        ctx.ellipse(wShift + 30, 13, 8.5, 4.6, 0.08, 0, Math.PI * 2);
        ctx.fill();
      }

      // Cute rosy-pink Ragdoll nose centered neatly inside the snow-white inverted-V blaze
      ctx.fillStyle = '#ee8e9e';
      ctx.beginPath();
      ctx.moveTo(wShift - 4.1, 9.6);
      ctx.quadraticCurveTo(wShift, 8.5, wShift + 4.1, 9.6);
      ctx.quadraticCurveTo(wShift + 3.2, 13.8, wShift, 14.3);
      ctx.quadraticCurveTo(wShift - 3.2, 13.8, wShift - 4.1, 9.6);
      ctx.closePath();
      ctx.fill();

      // Delicate cute kitten "w" mouth
      ctx.strokeStyle = 'rgba(72, 77, 92, 0.80)';
      ctx.lineWidth = 1.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(wShift - 5.8, 16.6);
      ctx.quadraticCurveTo(wShift - 2.9, 19.6, wShift, 16.4);
      ctx.quadraticCurveTo(wShift + 2.9, 19.6, wShift + 5.8, 16.6);
      ctx.stroke();
    }

    // 5) Delicate wispy cheek whiskers adapting to 2.5D head turn
    ctx.strokeStyle = isRagdoll ? 'rgba(98, 86, 76, 0.52)' : 'rgba(205, 208, 214, 0.54)';
    ctx.lineWidth = isRagdoll ? 1.15 : 1.05;
    ctx.lineCap = 'round';
    const leftLen = Math.max(8, 12 - this.faceTurnX * 0.55);
    const rightLen = Math.max(8, 12 + this.faceTurnX * 0.55);
    for (let i = 0; i < 3; i++) {
      const wy = 16 + i * 5.0;
      const slant = 2.0 + i * 1.1;
      ctx.beginPath();
      ctx.moveTo(-34 + wShift, wy);
      ctx.lineTo(-34 + wShift - leftLen, wy + slant);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(34 + wShift, wy);
      ctx.lineTo(34 + wShift + rightLen, wy + slant);
      ctx.stroke();
    }

    // 6) Expressive eyes (lemon-chartreuse for Black Cat / luminous sapphire-blue for Ragdoll!)
    this.drawEyes(ctx, wShift, -1);
    this.paintPetScarf(ctx, 0, 45, 109, .84);
    if (this.petSkin !== 'plain') {
      ctx.shadowBlur = 0;
      this.wardrobe.scarf(this.petSkin, 0, 42, 0, this.petSkin === 'classic' ? 100 : 107, false);
      this.wardrobe.hat(this.petSkin, 0, -1, 0, false, false);
    }

    ctx.restore(); // end head

    ctx.restore();
  }

  private drawEyes(ctx: CanvasRenderingContext2D, cx: number, eyeY: number): void {
    const isRagdoll = this.catBreed === 'ragdoll';
    const blinkVal = this.isBlinking ? 1 - Math.abs(this.blinkProgress - 1) : 0;
    const closedness = Math.max(blinkVal, this.squintAmount * 0.85, this.sleepDepth);

    // Exact measured eye spacing & size from original 0.3s & 10.6s!
    const eyeXs = [cx - 23.0, cx + 23.0];
    const rx = 14.8 + this.typingHunch * 1.0;
    const ry = 13.4 - this.typingHunch * 0.5;

    for (let idx = 0; idx < 2; idx++) {
      const ex = eyeXs[idx];
      ctx.save();
      ctx.translate(ex, eyeY);

      if (this.sleepDepth > .87 || (this.squintAmount > 0.38 && blinkVal < 0.3)) {
        if (isRagdoll) {
          // Sleek lazy drooping slits with a subtle crystal-blue underside shimmer!
          ctx.strokeStyle = 'rgba(174, 224, 255, 0.72)';
          ctx.lineWidth = 4.4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-12.5, 0.2);
          ctx.quadraticCurveTo(0, 2.2, 12.5, 1.8);
          ctx.stroke();

          ctx.strokeStyle = '#212533';
          ctx.lineWidth = 2.7;
          ctx.beginPath();
          ctx.moveTo(-13.5, -0.5);
          ctx.quadraticCurveTo(0, 1.4, 13.5, 1.2);
          ctx.stroke();
        } else {
          // Exact sleek thin horizontal lazy-slanted lemon-chartreuse slits from user's reference photo (NO grey lid blob!)
          ctx.strokeStyle = '#d4f044';
          ctx.lineWidth = 2.9;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-13.5, -0.5);
          ctx.quadraticCurveTo(0, 1.4, 13.5, 1.2);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }

      const openRy = Math.max(1.2, ry * (1 - closedness));
      const curiousTilt = (idx === 0 ? -0.1 : 0.1) * (0.25 + this.typingHunch * 0.75);
      ctx.rotate(curiousTilt);

      if (isRagdoll) {
        // Gentle soulful sky-cerulean Ragdoll eyes (warm & lifelike, matching user's Ragdoll!)
        const irisGrad = ctx.createLinearGradient(0, -openRy, 0, openRy);
        irisGrad.addColorStop(0.0, '#2c5594');
        irisGrad.addColorStop(0.50, '#5a94d6');
        irisGrad.addColorStop(1.0, '#a3d2f2');
        ctx.fillStyle = irisGrad;
      } else {
        ctx.fillStyle = '#d4f044';
      }

      ctx.beginPath();
      ctx.ellipse(0, 0, rx, openRy, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.clip();

      if (openRy > 3.2) {
        // Expressive pupil hugging lower rim when looking down at keyboard!
        const px = this.eyeLookX;
        const py = this.eyeLookY;
        const pupilRx = 6.2;
        const pupilRy = 8.8;

        ctx.fillStyle = isRagdoll ? '#101624' : '#0e0e10';
        ctx.beginPath();
        ctx.ellipse(px, py, pupilRx, pupilRy, 0, 0, Math.PI * 2);
        ctx.fill();

        if (isRagdoll) {
          // Crisp glossy twin starlight catchlights for dreamy Ragdoll doll eyes!
          ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
          ctx.beginPath();
          ctx.arc(px - 3.6, py - 4.0, 2.5, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.beginPath();
          ctx.arc(px + 3.2, py + 3.2, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();

      if (isRagdoll && openRy > 2.2) {
        // Delicate velvety eye rim so sapphire iris frames cleanly inside the blue-grey mask
        ctx.strokeStyle = 'rgba(34, 39, 54, 0.85)';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, openRy, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private drawMiniMouse(ctx: CanvasRenderingContext2D): void {
    const mx = this.mouseBaseX + this.mouseOffsetX;
    const my = this.mouseBaseY + this.mouseOffsetY;
    const rx = MOUSE_RADIUS_X;
    const ry = MOUSE_RADIUS_Y;
    const lPress = this.mouseLeftPress;
    const rPress = this.mouseRightPress;
    const mPress = Math.max(this.mouseMiddlePress, this.mouseScrollFlash);
    const colors = this.getMouseButtonColors();

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-0.06);

    // Soft 3D base rim / drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3.5;
    ctx.fillStyle = '#c8cac4';
    ctx.beginPath();
    ctx.ellipse(0, 1.8, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Main mouse palm shell (rear/palm at TOP closest to cat; split L/R buttons at BOTTOM pointing away from cat)
    const palmGrad = ctx.createLinearGradient(0, -ry, 0, 2);
    palmGrad.addColorStop(0.0, '#ecece7');
    palmGrad.addColorStop(1.0, '#f4f4f0');
    ctx.fillStyle = palmGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Clip inside mouse silhouette to render strictly separated Left / Right front button plates!
    const isCatFacing = this.keyboardOrientation === 'cat';
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx - 0.5, ry - 0.5, 0, 0, Math.PI * 2);
    ctx.clip();

    // Orientation-aware button/wheel geometry:
    // - 'cat' (180°): palm at TOP, buttons at BOTTOM, L = +X (inner), R = -X (outer)
    // - 'viewer' (0°): buttons at TOP, palm at BOTTOM, L = -X (left), R = +X (right)
    ctx.save();
    if (!isCatFacing) {
      ctx.scale(-1, -1);
    }

    const traceSeam = () => {
      ctx.moveTo(-rx - 2, -0.8);
      ctx.quadraticCurveTo(0, 1.8, rx + 2, -0.8);
    };

    // 1) Left Mouse Button plate (+X half in local coords -> inner-bottom in cat mode, top-left in viewer mode)
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.quadraticCurveTo(rx * 0.52, 0.4, rx + 2, -0.8);
    ctx.lineTo(rx + 2, ry + 2);
    ctx.lineTo(0, ry + 2);
    ctx.closePath();
    ctx.fillStyle = lPress > 0.08 ? colors.left : '#fafaf7';
    ctx.fill();
    if (lPress > 0.08) {
      ctx.fillStyle = `rgba(18, 22, 28, ${(0.18 * lPress).toFixed(3)})`;
      ctx.fillRect(0, -1, rx + 2, 3.8);
      ctx.fillRect(0, -1, 2.2, ry + 2);
    }

    // 2) Right Mouse Button plate (-X half in local coords -> outer-bottom in cat mode, top-right in viewer mode)
    ctx.beginPath();
    ctx.moveTo(-rx - 2, -0.8);
    ctx.quadraticCurveTo(-rx * 0.52, 0.4, 0, 0.5);
    ctx.lineTo(0, ry + 2);
    ctx.lineTo(-rx - 2, ry + 2);
    ctx.closePath();
    ctx.fillStyle = rPress > 0.08 ? colors.right : '#fafaf7';
    ctx.fill();
    if (rPress > 0.08) {
      ctx.fillStyle = `rgba(18, 22, 28, ${(0.18 * rPress).toFixed(3)})`;
      ctx.fillRect(-rx - 2, -1, rx + 2, 3.8);
      ctx.fillRect(-2.2, -1, 2.2, ry + 2);
    }

    // Crisp horizontal palm-to-button seam & vertical center L/R split line
    ctx.strokeStyle = 'rgba(42, 45, 52, 0.56)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    traceSeam();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(42, 45, 52, 0.66)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, 0.6);
    ctx.lineTo(0, ry + 1);
    ctx.stroke();

    // Recessed scroll wheel housing + interactive wheel (middle click & scroll glow)
    ctx.fillStyle = '#2d2f36';
    this.roundRect(ctx, -2.5, 4.2, 5.0, 9.4, 2.5);
    ctx.fill();

    ctx.fillStyle = mPress > 0.12 ? colors.middle : '#6b6f78';
    this.roundRect(ctx, -1.7, 5.0 + this.mouseMiddlePress * 0.8, 3.4, 7.6, 1.7);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-1.0, 8.8 + this.mouseMiddlePress * 0.8);
    ctx.lineTo(1.0, 8.8 + this.mouseMiddlePress * 0.8);
    ctx.stroke();

    ctx.restore(); // end local orientation transform

    // Always draw upright crisp L / R button legends in unobstructed front tips!
    ctx.font = '800 7.6px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lx = isCatFacing ? 7.4 : -7.4;
    const rxLbl = isCatFacing ? -7.4 : 7.4;
    const lyBase = isCatFacing ? 14.0 : -14.0;
    const pressDir = isCatFacing ? 0.9 : -0.9;
    ctx.fillStyle = lPress > 0.12 ? '#14161a' : 'rgba(72, 76, 86, 0.56)';
    ctx.fillText('L', lx, lyBase + lPress * pressDir);
    ctx.fillStyle = rPress > 0.12 ? '#ffffff' : 'rgba(72, 76, 86, 0.56)';
    ctx.fillText('R', rxLbl, lyBase + rPress * pressDir);

    ctx.restore(); // end mouse clip

    // Crisp outer silhouette stroke
    ctx.strokeStyle = '#2b2d34';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private drawKeyboard(ctx: CanvasRenderingContext2D): void {
    const layout = getKeyboardLayout(this.keyboardLayout);
    const theme = this.keyboardTheme;
    const finish = boardFinishes[theme];
    const ripple = this.getKeyboardRipple();
    const isCatFacing = this.keyboardOrientation === 'cat';
    const is108 = this.keyboardLayout === '108';
    const innerW = this.kbWidth - KEY_GRID_PAD_X * 2;
    const innerH = this.kbHeight - KEY_GRID_PAD_Y * 2;

    ctx.save();
    ctx.translate(this.kbCenterX, this.kbCenterY + this.kbBounce * 1.1);
    ctx.rotate(this.kbTiltRad);

    // True 3D desk trapezoid perspective: far edge (top) is narrower, near edge (bottom) is wider,
    // cleanly re-projected for BOTH cat-facing (Spacebar at narrow top) and viewer-facing (Esc/F-row at narrow top)!
    const topHalfW = (this.kbWidth * 0.955) / 2;
    const botHalfW = (this.kbWidth * 1.035) / 2;
    const halfH = this.kbHeight / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.34)';
    ctx.shadowBlur = 11;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#191a1e';
    this.trapezoidPath(ctx, topHalfW, botHalfW, -halfH + 3.5, halfH + 5.5, 6.5);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = finish.shell;
    ctx.strokeStyle = finish.edge;
    ctx.lineWidth = 1.1;
    this.trapezoidPath(ctx, topHalfW, botHalfW, -halfH, halfH, 6.5);
    ctx.fill();
    ctx.stroke();

    // Bright clean light-grey inner keybed matching ORIG 0.3s bright airy white keyboard!
    ctx.fillStyle = finish.plate;
    this.trapezoidPath(ctx, topHalfW - 5, botHalfW - 5, -halfH + 4, halfH - 4, 3.5);
    ctx.fill();

    if (theme === 'rgb') {
      const rail = ctx.createLinearGradient(-topHalfW, 0, topHalfW, 0);
      rail.addColorStop(0, '#8147e0');
      rail.addColorStop(.47, '#46cffe');
      rail.addColorStop(1, '#5169ff');
      ctx.fillStyle = rail;
      this.roundRect(ctx, -topHalfW + 12, halfH + 1, topHalfW * 2 - 24, 2, 1);
      ctx.fill();
    }

    const rowH = innerH / layout.totalRows;
    const unitW = innerW / layout.totalUnits;
    const gap = is108 ? 0.85 : 0.9;

    for (const key of layout.keys) {
      const anim = this.keyAnims.get(key.id);
      const tailPressure = this.tailStrike?.keyId === key.id ? this.tailStrike.pressure : 0;
      const press = Math.max(anim?.pressAmount ?? 0, tailPressure * 0.7);

      const rY = key.rowY ?? key.row;
      const rSpan = key.rowSpan ?? 1;
      const screenRowTop = isCatFacing ? layout.totalRows - (rY + rSpan) : rY;
      const screenUStart = isCatFacing
        ? layout.totalUnits - (key.uStart + key.uWidth)
        : key.uStart;

      const rowCenterFrac = (screenRowTop + rSpan * 0.5) / layout.totalRows;
      const depthScale = KEY_GRID_BACK_SCALE + rowCenterFrac * KEY_GRID_TAPER;

      const rawX = -innerW / 2 + screenUStart * unitW + gap * 0.5;
      const rawW = key.uWidth * unitW - gap;
      const x = rawX * depthScale;
      const w = rawW * depthScale;
      const y = -innerH / 2 + screenRowTop * rowH + gap * 0.5 + press * 2.0 + tailPressure * 1.1;
      const h = rSpan * rowH - gap - 0.8;

      const keycap = keyFinish(theme, key);
      const wave = rippleAmount(key, ripple);
      let topColor = keycap.top;
      let sideColor = keycap.side;
      let ink = keycap.ink;
      if (press > .14) {
        topColor = theme === 'rgb' ? '#76e4fb' : theme === 'voyage' ? '#e6bb63' : theme === 'terminal' ? '#ffad66'
          : this.customSkin?.accentColor ?? (this.catBreed === 'ragdoll' ? '#7ac7ff' : '#d2f244');
        sideColor = theme === 'rgb' ? '#2f9dd0' : theme === 'voyage' ? '#9d743f' : theme === 'terminal' ? '#9f562e'
          : this.customSkin?.accentSideColor ?? (this.catBreed === 'ragdoll' ? '#4690d8' : '#8cb014');
        ink = '#171c25';
      }

      ctx.fillStyle = sideColor;
      this.roundRect(ctx, x, y + 1.4, w, h, 1.8);
      ctx.fill();

      ctx.fillStyle = topColor;
      this.roundRect(ctx, x, y, w, h - 0.9, 1.8);
      ctx.fill();

      if (wave > .012 && press <= .14) {
        ctx.save();
        ctx.globalAlpha = wave * .84;
        ctx.fillStyle = screenUStart % 4 < 2 ? '#47c7f5' : '#9573ff';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = wave * 7;
        this.roundRect(ctx, x + .7, y + .45, w - 1.4, h - 1.8, 1.35);
        ctx.fill();
        ctx.restore();
      }

      // Keycap legends: rotated 180° in cat-facing mode, upright 0° in viewer-facing mode!
      const legend = key.id === 'space' ? '' : key.id === 'esc' ? 'Esc' : key.label;
      const voyageMark = theme === 'voyage';
      if (legend || voyageMark) {
        const isWideWord = legend.length >= 3;
        const fontSize = is108
          ? isWideWord
            ? 5.0
            : legend.length === 2
              ? 5.8
              : 7.2
          : isWideWord
            ? 5.6
            : legend.length === 2
              ? 6.4
              : 7.8;
        ctx.save();
        ctx.translate(x + w * 0.5, y + (h - 0.9) * 0.50);
        if (isCatFacing) {
          ctx.rotate(Math.PI);
        }
        ctx.font = `700 ${voyageMark && key.id === 'esc' ? fontSize * .84 : fontSize}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (legend) ctx.fillText(legend, voyageMark && ['esc', 'enter'].includes(key.id) ? w * .15 : 0, 0);
        if (voyageMark) paintVoyageMark(ctx, key, legend ? -w * .32 : 0, 0, key.id === 'space' ? 7 : Math.min(w, h) * .43, ink);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  /**
   * True-scale plush velvety cat arm & chubby rounded paw ball (1:1 match to reference photo & 8.3s / 13.2s / 31.0s!)
   */
  private drawPlumpCatArm(
    ctx: CanvasRenderingContext2D,
    side: 'left' | 'right',
    sx: number,
    sy: number,
    px: number,
    py: number,
    squash: number,
    withCrease: boolean,
  ): void {
    const dx = px - sx;
    const dy = py - sy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const wristDist = Math.max(6, len - 8);
    const wx = sx + ux * wristDist;
    const wy = sy + uy * wristDist;

    // True-scale plush proportions for 248px tall cat!
    const rShoulder = 14.2;
    const rWrist = 9.4;
    const pawRx = 14.5 * (1 + squash * 0.14);
    const pawRy = 11.8 * (1 - squash * 0.12);

    if (this.customSkin) {
      this.drawCustomPlumpArm(ctx, this.customSkin, side, sx, sy, px, py, squash, withCrease);
      return;
    }

    const isRagdoll = this.catBreed === 'ragdoll';
    ctx.save();

    if (isRagdoll) {
      // Seamless pure creamy snow-white Ragdoll mitten arm melting smoothly out of the white chest!
      const armGrad = ctx.createLinearGradient(sx, sy, px, py);
      armGrad.addColorStop(0.0, '#f5f1e8');
      armGrad.addColorStop(0.5, '#f9f6ef');
      armGrad.addColorStop(1.0, '#fcfaf4');

      ctx.fillStyle = armGrad;

      // Tapered snow-white arm silhouette (NO dark shadow smudge over the white chest!)
      const traceArmPath = () => {
        ctx.beginPath();
        ctx.moveTo(sx + nx * rShoulder, sy + ny * rShoulder);
        ctx.quadraticCurveTo(
          (sx + wx) * 0.5 + nx * (rShoulder * 0.84),
          (sy + wy) * 0.5 + ny * (rShoulder * 0.84),
          wx + nx * rWrist,
          wy + ny * rWrist,
        );
        ctx.lineTo(wx - nx * rWrist, wy - ny * rWrist);
        ctx.quadraticCurveTo(
          (sx + wx) * 0.5 - nx * (rShoulder * 0.84),
          (sy + wy) * 0.5 - ny * (rShoulder * 0.84),
          sx - nx * rShoulder,
          sy - ny * rShoulder,
        );
        ctx.closePath();
      };
      traceArmPath();
      ctx.fill();

      // Seamless white shoulder merge (invisible against white chest — ZERO grey shoulder blob!)
      ctx.beginPath();
      ctx.arc(sx, sy, rShoulder, 0, Math.PI * 2);
      ctx.fill();

      // Signature unique marking from user's real Ragdoll photo: adorable warm taupe-brown oval patch on viewer's RIGHT front forearm!
      if (side === 'right' && len > 26) {
        ctx.save();
        traceArmPath();
        ctx.clip();
        const spotX = sx + ux * (len * 0.64) + nx * 2.0;
        const spotY = sy + uy * (len * 0.64) + ny * 2.0;
        const armAngle = Math.atan2(dy, dx);
        ctx.fillStyle = 'rgba(134, 118, 102, 0.84)';
        ctx.shadowColor = 'rgba(134, 118, 102, 0.45)';
        ctx.shadowBlur = 2.5;
        ctx.beginPath();
        ctx.ellipse(spotX, spotY, Math.min(13.5, len * 0.16), 8.2, armAngle, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Soft subtle contact shadow ONLY under the plump round white mitten paw ball
      ctx.save();
      ctx.shadowColor = 'rgba(46, 38, 30, 0.22)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1.5;
      ctx.fillStyle = '#fcfaf4';
      ctx.beginPath();
      ctx.ellipse(px, py, pawRx, pawRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Refined warm-taupe arm side strokes that fade gently out at the shoulder and stay crisp along forearm & paw!
      ctx.lineWidth = 1.65;
      ctx.lineCap = 'round';
      for (const sgn of [-1, 1]) {
        const startFrac = withCrease ? 0.16 : 0.08;
        const esx = sx + ux * (len * startFrac) + nx * sgn * (rShoulder * (1 - startFrac * 0.16));
        const esy = sy + uy * (len * startFrac) + ny * sgn * (rShoulder * (1 - startFrac * 0.16));
        const eex = wx + nx * sgn * rWrist;
        const eey = wy + ny * sgn * rWrist;

        const edgeGrad = ctx.createLinearGradient(esx, esy, eex, eey);
        edgeGrad.addColorStop(0.0, 'rgba(93, 81, 72, 0.0)');
        edgeGrad.addColorStop(0.24, 'rgba(93, 81, 72, 0.78)');
        edgeGrad.addColorStop(1.0, 'rgba(93, 81, 72, 0.92)');

        ctx.strokeStyle = edgeGrad;
        ctx.beginPath();
        ctx.moveTo(esx, esy);
        ctx.quadraticCurveTo(
          (sx + wx) * 0.5 + nx * sgn * (rShoulder * 0.84),
          (sy + wy) * 0.5 + ny * sgn * (rShoulder * 0.84),
          eex,
          eey,
        );
        ctx.stroke();
      }

      // Crisp rounded mitten paw outline arc so the white paw reads clearly against white keyboard keys!
      const pawAng = Math.atan2(dy, dx);
      ctx.strokeStyle = 'rgba(93, 81, 72, 0.92)';
      ctx.beginPath();
      ctx.ellipse(px, py, pawRx, pawRy, 0, pawAng - Math.PI * 0.62, pawAng + Math.PI * 0.62);
      ctx.stroke();

      ctx.restore();
      return;
    }

    ctx.shadowColor = 'rgba(18, 17, 18, 0.42)';
    ctx.shadowBlur = 1.6;
    ctx.fillStyle = '#141314';

    // Arm silhouette tapering gently from shoulder to wrist
    ctx.beginPath();
    ctx.moveTo(sx + nx * rShoulder, sy + ny * rShoulder);
    ctx.quadraticCurveTo(
      (sx + wx) * 0.5 + nx * (rShoulder * 0.84),
      (sy + wy) * 0.5 + ny * (rShoulder * 0.84),
      wx + nx * rWrist,
      wy + ny * rWrist,
    );
    ctx.lineTo(wx - nx * rWrist, wy - ny * rWrist);
    ctx.quadraticCurveTo(
      (sx + wx) * 0.5 - nx * (rShoulder * 0.84),
      (sy + wy) * 0.5 - ny * (rShoulder * 0.84),
      sx - nx * rShoulder,
      sy - ny * rShoulder,
    );
    ctx.closePath();
    ctx.fill();

    // Seamless shoulder merge
    ctx.beginPath();
    ctx.arc(sx, sy, rShoulder, 0, Math.PI * 2);
    ctx.fill();

    // Plump, soft rounded black velvet paw ball pressing firmly onto the key!
    ctx.beginPath();
    ctx.ellipse(px, py, pawRx, pawRy, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;

    // Clean crisp subtle light-grey side separation lines ONLY where the arm crosses the black body (exact 2.2s / 8.3s / 13.2s!)
    if (withCrease && len > 28) {
      const startFrac = 0.18;
      const endFrac = 0.72;
      for (const sgn of [-1, 1]) {
        const csx = sx + ux * (len * startFrac) + nx * sgn * (rShoulder * 0.86);
        const csy = sy + uy * (len * startFrac) + ny * sgn * (rShoulder * 0.86);
        const cex = sx + ux * (len * endFrac) + nx * sgn * (rWrist * 1.02);
        const cey = sy + uy * (len * endFrac) + ny * sgn * (rWrist * 1.02);

        const creaseGrad = ctx.createLinearGradient(csx, csy, cex, cey);
        creaseGrad.addColorStop(0.0, 'rgba(216, 218, 222, 0.0)');
        creaseGrad.addColorStop(0.22, 'rgba(216, 218, 222, 0.65)');
        creaseGrad.addColorStop(0.84, 'rgba(216, 218, 222, 0.56)');
        creaseGrad.addColorStop(1.0, 'rgba(216, 218, 222, 0.0)');

        ctx.strokeStyle = creaseGrad;
        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(csx, csy);
        ctx.lineTo(cex, cey);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  /**
   * Real 2-segment articulated bent kitten arm (shoulder -> elbow -> curled plump paw on chest!)
   * Matches original video 8.3s (left paw), 10.6s (both paws), 23.2s, 26.2s!
   */
  private drawBentCurledArm(ctx: CanvasRenderingContext2D, paw: PawState, breath: number, alpha: number): void {
    const sh = this.getLiveShoulder(paw, breath);
    const cp = this.getLiveCurledPawPos(paw, breath);
    const sign = paw.side === 'left' ? -1 : 1;
    // Natural elbow bends slightly outward & down below shoulder before forearm curves inward-up!
    const elbowX = sh.x + sign * 8;
    const elbowY = cp.y + 8;

    if (this.customSkin) {
      this.drawCustomBentArm(ctx, this.customSkin, paw, breath, alpha);
      return;
    }

    const isRagdoll = this.catBreed === 'ragdoll';
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Continuous bent velvety arm + plump curled paw
    ctx.strokeStyle = isRagdoll ? '#f6f2ea' : '#141314';
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(sh.x, sh.y);
    ctx.quadraticCurveTo(elbowX, elbowY, cp.x, cp.y);
    ctx.stroke();

    // Signature warm taupe-brown patch on viewer's RIGHT curled forearm too!
    if (isRagdoll && paw.side === 'right') {
      ctx.save();
      ctx.fillStyle = 'rgba(134, 118, 102, 0.78)';
      ctx.beginPath();
      ctx.ellipse((elbowX + cp.x) * 0.5 + 2, (elbowY + cp.y) * 0.5 + 1, 7.5, 5.2, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = isRagdoll ? '#fcfaf4' : '#141314';
    ctx.beginPath();
    ctx.ellipse(cp.x, cp.y, 12.5, 11.0, sign * 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Clear crisp contour along the bent curled forearm & kitten paw
    const grad = ctx.createLinearGradient(elbowX, elbowY - 12, cp.x, cp.y + 12);
    if (isRagdoll) {
      grad.addColorStop(0.0, 'rgba(93, 81, 72, 0.0)');
      grad.addColorStop(0.28, 'rgba(93, 81, 72, 0.68)');
      grad.addColorStop(0.86, 'rgba(93, 81, 72, 0.78)');
      grad.addColorStop(1.0, 'rgba(93, 81, 72, 0.35)');
    } else {
      grad.addColorStop(0.0, 'rgba(214, 216, 220, 0.0)');
      grad.addColorStop(0.30, 'rgba(214, 216, 220, 0.65)');
      grad.addColorStop(0.85, 'rgba(220, 222, 226, 0.72)');
      grad.addColorStop(1.0, 'rgba(220, 222, 226, 0.25)');
    }

    ctx.strokeStyle = grad;
    ctx.lineWidth = isRagdoll ? 1.65 : 1.4;
    ctx.beginPath();
    ctx.moveTo(elbowX + sign * 8, elbowY - 16);
    ctx.quadraticCurveTo(elbowX + sign * 4, elbowY + 12, cp.x + sign * 2, cp.y + 10);
    ctx.quadraticCurveTo(cp.x - sign * 11, cp.y + 8, cp.x - sign * 12, cp.y - 4);
    ctx.stroke();

    ctx.restore();
  }

  private drawPaw(ctx: CanvasRenderingContext2D, paw: PawState, breath: number): void {
    // 1) Seated idle vertical front legs (EXACT 4 clean lines of ORIG 0.3s!) OR planted diagonal supporting leg (ORIG 2.2s!)
    if (paw.idleWeight > 0.05) {
      ctx.save();
      ctx.globalAlpha = paw.idleWeight;

      if (paw.side === 'right' && this.leftPaw.mode === 'mouse') {
        const sh = this.getLiveShoulder(paw, breath);
        const baseSp = this.spinePoint(1.0, breath);
        this.drawPlumpCatArm(ctx, 'right', sh.x - 4, sh.y + 8, baseSp.x + 28, baseSp.y - 2, 0, true);
      } else {
        // Exact 4-line seated leg silhouette from ORIG 0.3s (outer curved leg line + crisp inner center-gap line!)
        const topSp = this.spinePoint(0.66, breath);
        const midSp = this.spinePoint(0.84, breath);
        const botSp = this.spinePoint(1.0, breath);
        const sign = paw.side === 'left' ? -1 : 1;

        const outerTopX = topSp.x + sign * 41;
        const outerBotX = botSp.x + sign * 35;
        const innerTopX = topSp.x + sign * 6.5;
        const innerBotX = botSp.x + sign * 9.5;

        if (this.customSkin) {
          this.drawCustomIdleLegDetails(ctx, this.customSkin, paw, topSp, midSp, botSp, sign, outerTopX, outerBotX, innerTopX, innerBotX);
          ctx.restore();
          return;
        }

        // Signature warm taupe-brown oval leg patch on viewer's RIGHT seated front leg (1:1 match to user's real Ragdoll!)
        const isRagdoll = this.catBreed === 'ragdoll';
        if (isRagdoll && paw.side === 'right') {
          ctx.save();
          ctx.fillStyle = 'rgba(134, 118, 102, 0.80)';
          ctx.shadowColor = 'rgba(134, 118, 102, 0.40)';
          ctx.shadowBlur = 3.0;
          ctx.beginPath();
          ctx.ellipse(midSp.x + 21, midSp.y + 12, 9.5, 13.5, 0.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Garments cover the upper portions of the seated foreleg seams.
        if (hasSleeves(this.petSkin) || this.petSkin === 'magic') {
          const edge = this.spinePoint(.86, breath).y + 6;
          ctx.beginPath();
          ctx.rect(0, edge, this.logicalW, this.logicalH - edge);
          ctx.clip();
        }
        // Crisp subtle outer leg curve & inner leg-gap line (4 total lines across both legs — exact ORIG 0.3s!)
        const lineGrad = ctx.createLinearGradient(topSp.x, topSp.y, botSp.x, botSp.y);
        if (isRagdoll) {
          lineGrad.addColorStop(0.0, 'rgba(93, 81, 72, 0.0)');
          lineGrad.addColorStop(0.18, 'rgba(93, 81, 72, 0.62)');
          lineGrad.addColorStop(0.92, 'rgba(93, 81, 72, 0.68)');
          lineGrad.addColorStop(1.0, 'rgba(93, 81, 72, 0.28)');
        } else {
          lineGrad.addColorStop(0.0, 'rgba(210, 212, 216, 0.0)');
          lineGrad.addColorStop(0.18, 'rgba(210, 212, 216, 0.64)');
          lineGrad.addColorStop(0.92, 'rgba(210, 212, 216, 0.62)');
          lineGrad.addColorStop(1.0, 'rgba(210, 212, 216, 0.25)');
        }

        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = isRagdoll ? 1.55 : 1.4;
        ctx.lineCap = 'round';

        // Outer front-leg separation line (gently curves inward toward paw!)
        ctx.beginPath();
        ctx.moveTo(outerTopX, topSp.y);
        ctx.quadraticCurveTo(midSp.x + sign * 41, midSp.y, outerBotX, botSp.y - 1);
        ctx.stroke();

        // Inner front-leg gap line (tapers slightly outward toward paws, exact inverted narrow V from ORIG 0.3s!)
        ctx.beginPath();
        ctx.moveTo(innerTopX, topSp.y + 10);
        ctx.lineTo(innerBotX, botSp.y - 1);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2) Continuous bent articulated curled chest arm (8.3s / 10.6s / 23.2s / 26.2s!)
    if (paw.curlWeight > 0.05) {
      this.drawBentCurledArm(ctx, paw, breath, paw.curlWeight);
    }

    // 3) Plump velvety poking / mouse-holding cat arm!
    const activeArmWeight = Math.max(0, 1 - paw.idleWeight - paw.curlWeight);
    if (activeArmWeight > 0.05) {
      const sh = this.getLiveShoulder(paw, breath);
      const px = paw.pos.x;
      const mouseClickDrop =
        paw.mode === 'mouse'
          ? Math.max(this.mouseLeftPress, this.mouseRightPress, this.mouseMiddlePress) * 1.8
          : 0;
      const py = paw.pos.y + mouseClickDrop;

      ctx.save();
      ctx.globalAlpha = Math.min(1, activeArmWeight * 1.2);

      for (const sm of paw.smears) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, sm.alpha * activeArmWeight);
        this.drawPlumpCatArm(ctx, paw.side, sm.sx, sm.sy, sm.px, sm.py, 0, false);
        ctx.restore();
      }

      // Keep mouse-reaching arm pure velvet black in open air (ORIG 2.2s); show subtle separation lines when poking across black torso!
      this.drawPlumpCatArm(ctx, paw.side, sh.x, sh.y, px, py, paw.impactSquash, paw.mode !== 'mouse');
      ctx.restore();
    }
  }

  private drawKeyBubbles(ctx: CanvasRenderingContext2D, limit = this.bubbles.length): void {
    const now = performance.now();

    for (let i = Math.max(0, this.bubbles.length - limit); i < this.bubbles.length; i++) {
      const b = this.bubbles[i];
      const age = now - b.createdAt;
      const t = Math.min(1, age / b.lifetime);

      let scale = 1;
      if (t < 0.11) {
        const p = t / 0.11;
        scale = 0.62 + Math.sin(p * Math.PI * 0.65) * 0.44;
      } else if (t > 0.76) {
        scale = 1 - ((t - 0.76) / 0.24) * 0.1;
      }
      const alpha = t < 0.72 ? 1 : Math.max(0, 1 - (t - 0.72) / 0.28);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.scale(scale, scale);

      ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
      const textW = ctx.measureText(b.label).width;
      const boxW = b.isSpace ? 40 : Math.max(24, textW + 13);
      const boxH = 24;
      const bx = -boxW / 2;
      const by = -boxH / 2;

      ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = '#c8cac6';
      this.roundRect(ctx, bx, by + 2.2, boxW, boxH, 5.5);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(38, 40, 46, 0.42)';
      ctx.lineWidth = 1.05;
      this.roundRect(ctx, bx, by, boxW, boxH - 1.3, 5.5);
      ctx.fill();
      ctx.stroke();

      if (b.isSpace) {
        ctx.strokeStyle = '#222429';
        ctx.lineWidth = 1.55;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(-9, -1);
        ctx.lineTo(-9, 2.0);
        ctx.lineTo(9, 2.0);
        ctx.lineTo(9, -1);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#1e2025';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label, 0, -0.5);
      }

      ctx.restore();
    }
  }

  private drawMouseBadges(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    for (let i = 0; i < this.mouseBadges.length; i++) {
      const b = this.mouseBadges[i];
      const t = Math.min(1, (now - b.createdAt) / b.lifetime);
      let scale = 1;
      if (t < 0.14) {
        scale = 0.65 + Math.sin((t / 0.14) * Math.PI * 0.65) * 0.42;
      } else if (t > 0.72) {
        scale = 1 - ((t - 0.72) / 0.28) * 0.12;
      }
      const alpha = t < 0.68 ? 1 : Math.max(0, 1 - (t - 0.68) / 0.32);
      const liftY = t * 14 + (this.mouseBadges.length - 1 - i) * 18;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(b.x, b.y - liftY);
      ctx.scale(scale, scale);

      const boxW = 34;
      const boxH = 19;
      const bx = -boxW / 2;
      const by = -boxH / 2;

      ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1.5;

      ctx.fillStyle = '#22242a';
      this.roundRect(ctx, bx, by + 1.6, boxW, boxH, 5);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = b.color;
      ctx.strokeStyle = 'rgba(20, 22, 28, 0.45)';
      ctx.lineWidth = 1.0;
      this.roundRect(ctx, bx, by, boxW, boxH - 1.0, 5);
      ctx.fill();
      ctx.stroke();

      ctx.font = '800 9.5px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = b.label === 'RMB' && b.color === '#ff7b3b' ? '#ffffff' : '#14161a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, 0, -0.3);

      ctx.restore();
    }
  }

  private drawCustomCatBody(
    ctx: CanvasRenderingContext2D,
    s: ResolvedSkin,
    breath: number,
    purrShift: number,
  ): void {
    const leftPts: Vec2[] = [];
    const rightPts: Vec2[] = [];
    const bellySwell = 1 + this.typingHunch * 0.04;
    const headCenter = this.spinePoint(0.24, breath);
    const hcx = headCenter.x + purrShift;
    const hcy = headCenter.y;

    for (const slice of BODY_SLICES) {
      const sp = this.spinePoint(slice.t, breath);
      const widen = slice.t > 0.45 ? bellySwell : 1;
      const hw = slice.hw * widen;

      if (slice.t <= 0.38) {
        const tiltW = slice.t <= 0.30 ? 1.0 : (0.42 - slice.t) / 0.12;
        const ang = this.headTilt * tiltW;
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        const relY = sp.y - hcy;
        const lx0 = sp.x + purrShift - hw - hcx;
        const rx0 = sp.x + purrShift + hw - hcx;
        leftPts.push({ x: hcx + lx0 * cosA - relY * sinA, y: hcy + lx0 * sinA + relY * cosA });
        rightPts.push({ x: hcx + rx0 * cosA - relY * sinA, y: hcy + rx0 * sinA + relY * cosA });
      } else {
        leftPts.push({ x: sp.x + purrShift - hw, y: sp.y });
        rightPts.push({ x: sp.x + purrShift + hw, y: sp.y });
      }
    }

    const crownRelY = this.spinePoint(0.11, breath).y - hcy;
    const crownPt = {
      x: hcx - crownRelY * Math.sin(this.headTilt),
      y: hcy + crownRelY * Math.cos(this.headTilt),
    };
    const basePt = this.spinePoint(1.0, breath);

    ctx.save();
    ctx.shadowColor = s.isDarkBase ? 'rgba(18, 17, 18, 0.42)' : 'rgba(30, 32, 42, 0.22)';
    ctx.shadowBlur = s.isDarkBase ? 1.6 : 5;
    if (!s.isDarkBase) ctx.shadowOffsetY = 2;

    // 1) Grounded hind paws when front paws lift
    const anyFrontLifted = this.leftPaw.idleWeight < 0.7 || this.rightPaw.idleWeight < 0.7;
    if (anyFrontLifted) {
      ctx.fillStyle = s.pawColor;
      ctx.strokeStyle = s.pawOutlineColor || s.outlineColor || 'transparent';
      ctx.lineWidth = 1.85;
      for (const [fx, fy, rx, ry] of [
        [basePt.x - 42, basePt.y - 3, 14.5, 11.5],
        [basePt.x + 32, basePt.y - 1, 15.0, 11.5],
      ]) {
        ctx.beginPath();
        ctx.ellipse(fx, fy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        if (s.pawOutlineColor || s.outlineColor) {
          ctx.save();
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // 2) Unified flexible body path
    const traceBodyPath = () => {
      ctx.beginPath();
      const crownCos = Math.cos(this.headTilt);
      const crownSin = Math.sin(this.headTilt);
      ctx.moveTo(leftPts[0].x + 14 * crownCos + 6 * crownSin, leftPts[0].y + 14 * crownSin - 6 * crownCos);
      ctx.quadraticCurveTo(crownPt.x, crownPt.y - 2, rightPts[0].x - 14 * crownCos + 6 * crownSin, rightPts[0].y - 14 * crownSin - 6 * crownCos);
      ctx.lineTo(rightPts[0].x, rightPts[0].y);
      for (let i = 0; i < rightPts.length - 1; i++) {
        const p0 = rightPts[i];
        const p1 = rightPts[i + 1];
        ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5);
      }
      ctx.lineTo(rightPts[rightPts.length - 1].x, rightPts[rightPts.length - 1].y);
      ctx.quadraticCurveTo(basePt.x + purrShift, basePt.y + 6, leftPts[leftPts.length - 1].x, leftPts[leftPts.length - 1].y);
      for (let i = leftPts.length - 1; i > 0; i--) {
        const p0 = leftPts[i];
        const p1 = leftPts[i - 1];
        ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) * 0.5, (p0.y + p1.y) * 0.5);
      }
      ctx.lineTo(leftPts[0].x, leftPts[0].y);
      ctx.closePath();
    };

    traceBodyPath();
    const furGrad = ctx.createRadialGradient(hcx, hcy + 65, 18, basePt.x, basePt.y - 60, 150);
    furGrad.addColorStop(0.0, s.furColor);
    furGrad.addColorStop(1.0, s.furSecondaryColor);
    ctx.fillStyle = furGrad;
    ctx.fill();

    // 3) Clipped coat pattern markings & custom spots
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.clip();

    const midTorso = this.spinePoint(0.70, breath);
    const chestSp = this.spinePoint(0.56, breath);

    if (s.flankColor) {
      for (const sgn of [-1, 1]) {
        ctx.save();
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = s.flankColor;
        ctx.shadowColor = s.flankColor;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.ellipse(midTorso.x + purrShift + sgn * 62, midTorso.y + 6, 48, 82, sgn * -0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (s.bellyBibColor) {
      ctx.fillStyle = s.bellyBibColor;
      ctx.beginPath();
      ctx.ellipse(chestSp.x + purrShift, chestSp.y + 38, 36, 62, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (s.pattern === 'tabby' && s.stripeColor) {
      ctx.strokeStyle = s.stripeColor;
      ctx.lineCap = 'round';
      ctx.lineWidth = 4.6;
      ctx.globalAlpha = 0.65;
      for (const sgn of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const ty = midTorso.y - 26 + i * 20;
          ctx.beginPath();
          ctx.moveTo(midTorso.x + purrShift + sgn * 74, ty);
          ctx.quadraticCurveTo(midTorso.x + purrShift + sgn * 56, ty + 3, midTorso.x + purrShift + sgn * 42, ty + 7);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    if (s.pattern === 'calico') {
      const orangePatch = s.maskColor || '#ea9446';
      const darkPatch = s.calicoPatchColor || '#3c3634';
      ctx.save();
      ctx.shadowBlur = 4;
      ctx.shadowColor = orangePatch;
      ctx.fillStyle = orangePatch;
      ctx.beginPath();
      ctx.ellipse(midTorso.x + purrShift - 54, midTorso.y + 10, 38, 52, -0.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowColor = darkPatch;
      ctx.fillStyle = darkPatch;
      ctx.beginPath();
      ctx.ellipse(midTorso.x + purrShift + 56, midTorso.y - 4, 36, 56, 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Body custom spots
    for (const spot of s.spots) {
      if (spot.part !== 'body') continue;
      ctx.save();
      ctx.globalAlpha = spot.opacity ?? 0.85;
      ctx.fillStyle = spot.color;
      ctx.beginPath();
      ctx.ellipse(
        midTorso.x + purrShift + spot.x * 65,
        midTorso.y + spot.y * 65,
        Math.max(2, spot.rx),
        Math.max(2, spot.ry),
        spot.rotation || 0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }

    // Head-space patterns (rotate seamlessly with headTilt!)
    ctx.save();
    ctx.translate(hcx, hcy);
    ctx.rotate(this.headTilt);
    const maskShift = this.faceTurnX * 0.72;

    if (s.pattern === 'bicolor' && s.maskColor) {
      ctx.save();
      ctx.fillStyle = s.maskColor;
      ctx.shadowColor = s.maskColor;
      ctx.shadowBlur = 4.5;
      ctx.beginPath();
      ctx.moveTo(-74, -44);
      ctx.lineTo(74, -44);
      ctx.lineTo(70, 20);
      ctx.quadraticCurveTo(maskShift + 42, 18, maskShift + 26, 9);
      ctx.quadraticCurveTo(maskShift + 17, 0, maskShift + 13.5, -13);
      ctx.quadraticCurveTo(maskShift + 7, -21.5, maskShift, -22.5);
      ctx.quadraticCurveTo(maskShift - 7, -21.5, maskShift - 13.5, -13);
      ctx.quadraticCurveTo(maskShift - 17, 0, maskShift - 26, 9);
      ctx.quadraticCurveTo(maskShift - 42, 18, -70, 20);
      ctx.closePath();
      ctx.fill();
      if (s.foreheadBridgeColor) {
        ctx.fillStyle = s.foreheadBridgeColor;
        ctx.shadowBlur = 5.5;
        ctx.beginPath();
        ctx.ellipse(maskShift, -32, 18, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (s.pattern === 'tuxedo' && s.bellyBibColor) {
      ctx.fillStyle = s.bellyBibColor;
      ctx.beginPath();
      ctx.ellipse(maskShift, 22, 26, 15, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.pattern === 'siamese' && s.maskColor) {
      ctx.save();
      ctx.fillStyle = s.maskColor;
      ctx.shadowColor = s.maskColor;
      ctx.shadowBlur = 9;
      ctx.beginPath();
      ctx.ellipse(maskShift, 3, 42, 27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (s.pattern === 'calico') {
      const orangePatch = s.maskColor || '#ea9446';
      const darkPatch = s.calicoPatchColor || '#3c3634';
      ctx.save();
      ctx.shadowBlur = 4;
      ctx.fillStyle = orangePatch;
      ctx.shadowColor = orangePatch;
      ctx.beginPath();
      ctx.ellipse(-34 + maskShift * 0.4, -18, 34, 28, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = darkPatch;
      ctx.shadowColor = darkPatch;
      ctx.beginPath();
      ctx.ellipse(36 + maskShift * 0.4, -16, 32, 26, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (s.pattern === 'tabby' && s.stripeColor) {
      // Iconic tabby forehead "M" & cheek stripes!
      ctx.strokeStyle = s.stripeColor;
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.78;
      // Center M stripes on forehead
      ctx.beginPath();
      ctx.moveTo(maskShift - 11, -30);
      ctx.lineTo(maskShift - 8, -19);
      ctx.moveTo(maskShift, -32);
      ctx.lineTo(maskShift, -18);
      ctx.moveTo(maskShift + 11, -30);
      ctx.lineTo(maskShift + 8, -19);
      ctx.stroke();
      // Cheek tiger stripes
      ctx.lineWidth = 2.8;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sgn * 58, 6);
        ctx.lineTo(sgn * 42, 9);
        ctx.moveTo(sgn * 56, 14);
        ctx.lineTo(sgn * 41, 16);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Head custom spots
    for (const spot of s.spots) {
      if (spot.part !== 'head') continue;
      ctx.save();
      ctx.globalAlpha = spot.opacity ?? 0.85;
      ctx.fillStyle = spot.color;
      ctx.beginPath();
      ctx.ellipse(
        maskShift + spot.x * 52,
        spot.y * 36,
        Math.max(2, spot.rx),
        Math.max(2, spot.ry),
        spot.rotation || 0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }

    ctx.restore(); // end head-space patterns
    ctx.restore(); // end body clip

    if (s.outlineColor) {
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      traceBodyPath();
      ctx.strokeStyle = s.outlineColor;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // 4) Ears, face features & eyes in head-space
    ctx.save();
    ctx.translate(hcx, hcy);
    ctx.rotate(this.headTilt);

    const lTwitch = Math.sin(this.earTwitchLeft * Math.PI) * 0.12;
    const rTwitch = Math.sin(this.earTwitchRight * Math.PI) * 0.12;

    const drawCustomEar = (sideSign: -1 | 1, twitch: number) => {
      ctx.save();
      ctx.translate(sideSign * 33 + this.faceTurnX * 0.18, -28);
      ctx.rotate(sideSign * (0.08 + twitch));

      const earPath = () => {
        ctx.beginPath();
        ctx.moveTo(sideSign * 19, 20);
        ctx.bezierCurveTo(sideSign * 19, -8, sideSign * 12, -23, sideSign * 3, -21);
        ctx.bezierCurveTo(sideSign * -8, -18, sideSign * -16, -6, sideSign * -21, 8);
        ctx.closePath();
      };

      const baseEarCol =
        s.pattern === 'calico' && sideSign === -1
          ? s.maskColor || s.earOuterColor
          : s.earOuterColor;
      const earGrad = ctx.createLinearGradient(0, -23, 0, 18);
      earGrad.addColorStop(0.0, s.earTipColor || baseEarCol);
      earGrad.addColorStop(1.0, baseEarCol);
      ctx.fillStyle = earGrad;
      earPath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      if (s.outlineColor) {
        ctx.strokeStyle = s.outlineColor;
        ctx.lineWidth = 1.85;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sideSign * 19, 17);
        ctx.bezierCurveTo(sideSign * 19, -8, sideSign * 12, -23, sideSign * 3, -21);
        ctx.bezierCurveTo(sideSign * -8, -18, sideSign * -16, -6, sideSign * -19, 5);
        ctx.stroke();
      }

      if (s.earInnerColor) {
        ctx.fillStyle = s.earInnerColor;
        ctx.beginPath();
        ctx.moveTo(sideSign * 11, 10);
        ctx.bezierCurveTo(sideSign * 11, -3, sideSign * 7, -13, sideSign * 2, -11);
        ctx.bezierCurveTo(sideSign * -4, -9, sideSign * -9, -1, sideSign * -10, 8);
        ctx.closePath();
        ctx.fill();
      }

      if (s.earTuftColor) {
        ctx.strokeStyle = s.earTuftColor;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sideSign * -6, 6);
        ctx.quadraticCurveTo(sideSign * -1, 3, sideSign * 5, 6);
        ctx.moveTo(sideSign * -3, 10);
        ctx.quadraticCurveTo(sideSign * 2, 7.5, sideSign * 7, 10);
        ctx.stroke();
      }
      ctx.restore();
    };

    drawCustomEar(-1, lTwitch);
    drawCustomEar(1, rTwitch);

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    const wShift = this.faceTurnX * 0.72;

    // Blush on petting
    if (s.blushColor && this.squintAmount > 0.12) {
      ctx.save();
      ctx.globalAlpha = 0.42 * this.squintAmount;
      ctx.fillStyle = s.blushColor;
      ctx.beginPath();
      ctx.ellipse(wShift - 30, 13, 8.5, 4.6, -0.08, 0, Math.PI * 2);
      ctx.ellipse(wShift + 30, 13, 8.5, 4.6, 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Nose & mouth
    if (s.noseColor) {
      ctx.fillStyle = s.noseColor;
      ctx.beginPath();
      ctx.moveTo(wShift - 4.1, 9.6);
      ctx.quadraticCurveTo(wShift, 8.5, wShift + 4.1, 9.6);
      ctx.quadraticCurveTo(wShift + 3.2, 13.8, wShift, 14.3);
      ctx.quadraticCurveTo(wShift - 3.2, 13.8, wShift - 4.1, 9.6);
      ctx.closePath();
      ctx.fill();
    }
    if (s.mouthColor) {
      ctx.strokeStyle = s.mouthColor;
      ctx.lineWidth = 1.35;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(wShift - 5.8, 16.6);
      ctx.quadraticCurveTo(wShift - 2.9, 19.6, wShift, 16.4);
      ctx.quadraticCurveTo(wShift + 2.9, 19.6, wShift + 5.8, 16.6);
      ctx.stroke();
    }

    // Whiskers
    ctx.strokeStyle = s.whiskerColor;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    const leftLen = Math.max(8, 12 - this.faceTurnX * 0.55);
    const rightLen = Math.max(8, 12 + this.faceTurnX * 0.55);
    for (let i = 0; i < 3; i++) {
      const wy = 16 + i * 5.0;
      const slant = 2.0 + i * 1.1;
      ctx.beginPath();
      ctx.moveTo(-34 + wShift, wy);
      ctx.lineTo(-34 + wShift - leftLen, wy + slant);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(34 + wShift, wy);
      ctx.lineTo(34 + wShift + rightLen, wy + slant);
      ctx.stroke();
    }

    this.drawCustomEyes(ctx, s, wShift, -1);

    ctx.restore();
    ctx.restore();
  }

  private drawCustomEyes(ctx: CanvasRenderingContext2D, s: ResolvedSkin, cx: number, eyeY: number): void {
    const blinkVal = this.isBlinking ? 1 - Math.abs(this.blinkProgress - 1) : 0;
    const closedness = Math.max(blinkVal, this.squintAmount * 0.85, this.sleepDepth);
    const eyeXs = [cx - 23.0, cx + 23.0];
    const rx = 14.8 + this.typingHunch * 1.0;
    const ry = 13.4 - this.typingHunch * 0.5;

    for (let idx = 0; idx < 2; idx++) {
      ctx.save();
      ctx.translate(eyeXs[idx], eyeY);

      if (this.sleepDepth > .87 || (this.squintAmount > 0.38 && blinkVal < 0.3)) {
        if (s.squintGlowColor) {
          ctx.strokeStyle = s.squintGlowColor;
          ctx.lineWidth = 4.4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-12.5, 0.2);
          ctx.quadraticCurveTo(0, 2.2, 12.5, 1.8);
          ctx.stroke();
        }
        ctx.strokeStyle = s.squintColor;
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-13.5, -0.5);
        ctx.quadraticCurveTo(0, 1.4, 13.5, 1.2);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      const openRy = Math.max(1.2, ry * (1 - closedness));
      const curiousTilt = (idx === 0 ? -0.1 : 0.1) * (0.25 + this.typingHunch * 0.75);
      ctx.rotate(curiousTilt);

      const irisGrad = ctx.createLinearGradient(0, -openRy, 0, openRy);
      irisGrad.addColorStop(0.0, s.eyeColorTop);
      irisGrad.addColorStop(1.0, s.eyeColorBottom);
      ctx.fillStyle = irisGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, openRy, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.clip();
      if (openRy > 3.2) {
        const px = this.eyeLookX;
        const py = this.eyeLookY;
        ctx.fillStyle = s.pupilColor;
        ctx.beginPath();
        ctx.ellipse(px, py, 6.2, 8.8, 0, 0, Math.PI * 2);
        ctx.fill();

        if (s.eyeCatchlight) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
          ctx.beginPath();
          ctx.arc(px - 3.6, py - 4.0, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
          ctx.beginPath();
          ctx.arc(px + 3.2, py + 3.2, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

      if (s.eyeRimColor && openRy > 2.2) {
        ctx.strokeStyle = s.eyeRimColor;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, openRy, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private drawCustomPlumpArm(
    ctx: CanvasRenderingContext2D,
    s: ResolvedSkin,
    side: 'left' | 'right',
    sx: number,
    sy: number,
    px: number,
    py: number,
    squash: number,
    withCrease: boolean,
  ): void {
    const dx = px - sx;
    const dy = py - sy;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const wristDist = Math.max(6, len - 8);
    const wx = sx + ux * wristDist;
    const wy = sy + uy * wristDist;
    const rShoulder = 14.2;
    const rWrist = 9.4;
    const pawRx = 14.5 * (1 + squash * 0.14);
    const pawRy = 11.8 * (1 - squash * 0.12);

    ctx.save();
    const traceArmPath = () => {
      ctx.beginPath();
      ctx.moveTo(sx + nx * rShoulder, sy + ny * rShoulder);
      ctx.quadraticCurveTo(
        (sx + wx) * 0.5 + nx * (rShoulder * 0.84),
        (sy + wy) * 0.5 + ny * (rShoulder * 0.84),
        wx + nx * rWrist,
        wy + ny * rWrist,
      );
      ctx.lineTo(wx - nx * rWrist, wy - ny * rWrist);
      ctx.quadraticCurveTo(
        (sx + wx) * 0.5 - nx * (rShoulder * 0.84),
        (sy + wy) * 0.5 - ny * (rShoulder * 0.84),
        sx - nx * rShoulder,
        sy - ny * rShoulder,
      );
      ctx.closePath();
    };

    ctx.fillStyle = s.armColor;
    traceArmPath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx, sy, rShoulder, 0, Math.PI * 2);
    ctx.fill();

    // Custom arm spots
    const armPart = side === 'left' ? 'leftArm' : 'rightArm';
    const armSpots = s.spots.filter((sp) => sp.part === armPart);
    if (armSpots.length > 0 && len > 24) {
      const armAng = Math.atan2(dy, dx);
      ctx.save();
      traceArmPath();
      ctx.clip();
      for (const sp of armSpots) {
        const frac = Math.max(0.1, Math.min(0.9, sp.x));
        ctx.globalAlpha = sp.opacity ?? 0.85;
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.ellipse(
          sx + ux * (len * frac) + nx * sp.y,
          sy + uy * (len * frac) + ny * sp.y,
          Math.max(2, sp.rx),
          Math.max(2, sp.ry),
          armAng + (sp.rotation || 0),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }

    // Mitten paw ball
    ctx.save();
    if (!s.isDarkBase) {
      ctx.shadowColor = 'rgba(36, 32, 30, 0.22)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1.5;
    }
    ctx.fillStyle = s.pawColor;
    ctx.beginPath();
    ctx.ellipse(px, py, pawRx, pawRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const edgeColor = s.pawOutlineColor || s.outlineColor;
    if (edgeColor) {
      ctx.lineWidth = 1.65;
      ctx.lineCap = 'round';
      for (const sgn of [-1, 1]) {
        const startFrac = withCrease ? 0.16 : 0.08;
        const esx = sx + ux * (len * startFrac) + nx * sgn * (rShoulder * (1 - startFrac * 0.16));
        const esy = sy + uy * (len * startFrac) + ny * sgn * (rShoulder * (1 - startFrac * 0.16));
        ctx.strokeStyle = edgeColor;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(esx, esy);
        ctx.quadraticCurveTo(
          (sx + wx) * 0.5 + nx * sgn * (rShoulder * 0.84),
          (sy + wy) * 0.5 + ny * sgn * (rShoulder * 0.84),
          wx + nx * sgn * rWrist,
          wy + ny * sgn * rWrist,
        );
        ctx.stroke();
      }
      const pawAng = Math.atan2(dy, dx);
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = edgeColor;
      ctx.beginPath();
      ctx.ellipse(px, py, pawRx, pawRy, 0, pawAng - Math.PI * 0.62, pawAng + Math.PI * 0.62);
      ctx.stroke();
    } else if (s.armCreaseColor && withCrease && len > 28) {
      for (const sgn of [-1, 1]) {
        const csx = sx + ux * (len * 0.18) + nx * sgn * (rShoulder * 0.86);
        const csy = sy + uy * (len * 0.18) + ny * sgn * (rShoulder * 0.86);
        const cex = sx + ux * (len * 0.72) + nx * sgn * (rWrist * 1.02);
        const cey = sy + uy * (len * 0.72) + ny * sgn * (rWrist * 1.02);
        ctx.strokeStyle = s.armCreaseColor;
        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(csx, csy);
        ctx.lineTo(cex, cey);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawCustomBentArm(
    ctx: CanvasRenderingContext2D,
    s: ResolvedSkin,
    paw: PawState,
    breath: number,
    alpha: number,
  ): void {
    const sh = this.getLiveShoulder(paw, breath);
    const cp = this.getLiveCurledPawPos(paw, breath);
    const sign = paw.side === 'left' ? -1 : 1;
    const elbowX = sh.x + sign * 8;
    const elbowY = cp.y + 8;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = s.armColor;
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.moveTo(sh.x, sh.y);
    ctx.quadraticCurveTo(elbowX, elbowY, cp.x, cp.y);
    ctx.stroke();

    const armPart = paw.side === 'left' ? 'leftArm' : 'rightArm';
    for (const sp of s.spots) {
      if (sp.part !== armPart) continue;
      ctx.save();
      ctx.globalAlpha = alpha * (sp.opacity ?? 0.82);
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.ellipse((elbowX + cp.x) * 0.5, (elbowY + cp.y) * 0.5, Math.min(8, sp.rx), Math.min(6, sp.ry), -0.3 * sign, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = s.pawColor;
    ctx.beginPath();
    ctx.ellipse(cp.x, cp.y, 12.5, 11.0, sign * 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = s.pawOutlineColor || s.legLineColor;
    ctx.lineWidth = 1.55;
    ctx.beginPath();
    ctx.moveTo(elbowX + sign * 8, elbowY - 16);
    ctx.quadraticCurveTo(elbowX + sign * 4, elbowY + 12, cp.x + sign * 2, cp.y + 10);
    ctx.quadraticCurveTo(cp.x - sign * 11, cp.y + 8, cp.x - sign * 12, cp.y - 4);
    ctx.stroke();
    ctx.restore();
  }

  private drawCustomIdleLegDetails(
    ctx: CanvasRenderingContext2D,
    s: ResolvedSkin,
    paw: PawState,
    topSp: Vec2,
    midSp: Vec2,
    botSp: Vec2,
    sign: -1 | 1,
    outerTopX: number,
    outerBotX: number,
    innerTopX: number,
    innerBotX: number,
  ): void {
    const armPart = paw.side === 'left' ? 'leftArm' : 'rightArm';
    for (const sp of s.spots) {
      if (sp.part !== armPart) continue;
      ctx.save();
      ctx.globalAlpha = sp.opacity ?? 0.82;
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.ellipse(midSp.x + sign * 21, midSp.y + (sp.x - 0.5) * 28, Math.max(3, sp.rx * 0.8), Math.max(3, sp.ry * 1.1), 0.2 * sign, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Optional cute white mittens at the bottom of idle seated legs when pawColor differs from furColor!
    if (s.pawColor !== s.furColor) {
      ctx.save();
      ctx.fillStyle = s.pawColor;
      ctx.beginPath();
      ctx.ellipse(botSp.x + sign * 22, botSp.y - 4, 13.5, 9.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.strokeStyle = s.legLineColor;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(outerTopX, topSp.y);
    ctx.quadraticCurveTo(midSp.x + sign * 41, midSp.y, outerBotX, botSp.y - 1);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(innerTopX, topSp.y + 10);
    ctx.lineTo(innerBotX, botSp.y - 1);
    ctx.stroke();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  private trapezoidPath(
    ctx: CanvasRenderingContext2D,
    topHalfW: number,
    botHalfW: number,
    topY: number,
    botY: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(-topHalfW + r, topY);
    ctx.lineTo(topHalfW - r, topY);
    ctx.quadraticCurveTo(topHalfW, topY, topHalfW + 1, topY + r);
    ctx.lineTo(botHalfW, botY - r);
    ctx.quadraticCurveTo(botHalfW, botY, botHalfW - r, botY);
    ctx.lineTo(-botHalfW + r, botY);
    ctx.quadraticCurveTo(-botHalfW, botY, -botHalfW, botY - r);
    ctx.lineTo(-topHalfW - 1, topY + r);
    ctx.quadraticCurveTo(-topHalfW, topY, -topHalfW + r, topY);
    ctx.closePath();
  }
}
