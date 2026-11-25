import type { KuroCatEngine } from '../../catEngine';
import { resolveKeyByVk } from '../../keyboardLayout';
import { drawSleepIndicator } from '../sleep-indicator';
import proneImage from './assets/prone.png';
import uprightImage from './assets/upright-torso.png';

type Point = { x: number; y: number };
type Strike = { direction: Point; from: Point; at: number; key: string; contacted: boolean };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const chords = new Set(['lshift', 'rshift', 'lctrl', 'rctrl', 'lalt', 'ralt', 'lwin', 'rwin', 'caps']);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

const pronePaws = [
  new Path2D('M235 946 C231 922 247 906 268 898 C291 888 315 896 335 912 C354 924 369 946 366 963 C363 976 348 984 333 979 C321 988 310 984 299 982 C279 989 257 975 249 966 C242 961 237 954 235 946 Z'),
  new Path2D('M705 889 C711 863 727 840 750 829 C773 817 798 819 825 829 C846 839 863 857 866 880 C869 903 859 917 845 923 C833 930 816 934 801 927 C787 937 767 934 752 930 C737 931 721 926 713 915 C707 908 704 900 705 889 Z'),
];
const standPaws = [
  new Path2D('M356 1118 C357 1091 382 1066 426 1066 C458 1065 487 1074 499 1091 C510 1106 513 1123 506 1144 C498 1161 480 1170 460 1168 C445 1173 428 1168 416 1168 C385 1174 363 1161 359 1140 C356 1132 355 1124 356 1118 Z'),
  new Path2D('M685 1119 C687 1094 712 1071 755 1068 C784 1066 809 1075 827 1094 C836 1109 840 1135 826 1153 C814 1167 795 1171 779 1169 C764 1176 750 1172 737 1168 C708 1173 686 1160 687 1139 C684 1131 685 1122 685 1119 Z'),
];
const eyeMasks = [
  ['M342 766 C379 742 467 721 510 730 C527 752 493 790 451 802 C412 813 362 801 344 778 Z', 'M337 766 C379 734 473 714 511 730', 442, 755],
  ['M623 714 C657 693 746 684 783 704 C800 717 770 744 739 758 C704 774 649 765 630 742 Q620 729 623 714 Z', 'M623 716 C660 687 752 680 790 702', 691, 722],
] as const;

const artScale = [.238, .204];
const artPawCenters = [[{ x: 301, y: 938 }, { x: 787, y: 888 }], [{ x: 433, y: 1118 }, { x: 763, y: 1120 }]];
const ink = '#795035';

async function loadArt(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const layer = document.createElement('canvas');
  layer.width = img.naturalWidth;
  layer.height = img.naturalHeight;
  const g = layer.getContext('2d')!;
  g.filter = 'saturate(.76) brightness(1.075)';
  g.drawImage(img, 0, 0);
  return layer;
}

function fill(ctx: CanvasRenderingContext2D, path: Path2D, color: string) {
  ctx.fillStyle = color;
  ctx.fill(path);
}

function line(ctx: CanvasRenderingContext2D, path: string, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.stroke(new Path2D(path));
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}


export async function loadCorgi(engine: KuroCatEngine) {
  const pawTips: [Point, Point] = [{ x: 134, y: 321 }, { x: 249, y: 314 }];
  const taps: [Strike, Strike] = [
    { direction: { x: 156, y: 326 }, from: pawTips[0], at: -1e5, key: '', contacted: true },
    { direction: { x: 243, y: 326 }, from: pawTips[1], at: -1e5, key: '', contacted: true },
  ];
  const reachLean: Point = { x: 0, y: 0 };

  const art = await Promise.all([loadArt(proneImage), loadArt(uprightImage)]);
  const heldMouse = new Set<string>();
  const recent: number[] = [];
  let pointer: Point | null = null;
  let gaze: Point = { x: 0, y: 0 };
  let mouseGrip = 0;
  let mouseMoveAt = -1e5;
  let mouseSample: { x: number; y: number; nx: number; ny: number } | null = null;
  let standing = false;
  let uprightSince = 0;
  let pose = 0;
  let lastFrame = performance.now();
  let fastSince = 0;
  let slowSince = 0;
  let lastStrike = -1e5;
  let blinkAt = lastFrame + 3800;
  let sleepSince: number | null = null;

  function drawFaceEyes(ctx: CanvasRenderingContext2D, blink: number) {
    for (const [shape, lid, x, y] of eyeMasks) {
      const aperture = new Path2D(shape);
      const irisX = x + gaze.x * 36;
      const irisY = y + gaze.y * 18;
      ctx.save();
      ctx.clip(aperture);
      const eye = ctx.createLinearGradient(x, y - 30, x, y + 35);
      eye.addColorStop(0, '#fff1d3');
      eye.addColorStop(1, '#fff7e2');
      ctx.fillStyle = eye;
      ctx.fillRect(x - 135, y - 90, 270, 180);
      ellipse(ctx, irisX, irisY, 31, 33, ink);
      ellipse(ctx, irisX + 10, irisY - 14, 6.5, 6.5, '#fff8e8');
      if (blink > .02) {
        ctx.fillStyle = '#eeb77c';
        ctx.fillRect(x - 130, y - 85, 260, blink * 145);
      }
      ctx.restore();
      line(ctx, lid, '#95633a', 8);
    }
  }

  const loafBody = new Path2D('M119 906 C102 894 94 868 95 846 C94 793 134 747 192 704 L247 677 L375 471 C450 414 538 396 591 396 C640 394 672 401 699 414 L775 464 C818 459 875 463 915 469 C1025 480 1111 545 1161 632 C1196 694 1208 771 1181 841 C1188 863 1176 889 1163 898 C1154 905 1134 904 1113 907 C1023 910 931 909 859 906 C824 907 786 903 749 903 C692 914 662 923 612 928 C520 935 447 936 380 923 C263 923 187 923 119 906 Z');
  const headArt = new Path2D('M231 732 C170 706 132 625 122 535 C115 475 126 421 152 398 C173 379 202 379 237 388 C288 403 342 439 377 470 L415 506 C476 471 565 458 626 468 C676 398 755 323 833 295 C865 283 893 289 906 317 C930 360 925 425 914 478 C907 531 884 595 858 633 C913 692 932 751 923 797 C917 839 885 873 858 883 C810 902 753 906 709 905 C642 918 582 926 517 926 C467 927 410 926 372 921 C314 920 271 912 245 910 C216 890 211 860 206 829 C201 797 214 757 231 732 Z');
  const uprightTorso = new Path2D('M249 1062 C204 1029 205 962 222 907 C237 853 274 805 319 774 C397 720 446 709 603 718 C760 713 835 728 912 766 C967 800 1012 878 1021 944 C1031 1000 1011 1047 989 1077 C992 1106 980 1124 960 1135 C930 1145 886 1141 840 1138 C761 1143 692 1144 621 1144 C550 1144 475 1143 376 1138 C328 1140 273 1146 251 1124 C234 1105 238 1082 249 1062 Z');
  const mouthMask = new Path2D('M568 849 C582 834 626 830 648 839 C663 844 661 865 646 876 C620 884 579 878 567 867 Q562 859 568 849 Z');
  const angerMark = new Path2D('M-11 -29 Q-8 -11 -25 -9 M11 -29 Q8 -11 25 -9 M-25 10 Q-8 11 -11 28 M25 10 Q8 11 11 28');
  const loafWithHead = new Path2D(loafBody);
  loafWithHead.addPath(headArt);

  function coverOriginalPaws(ctx: CanvasRenderingContext2D, state: 0 | 1) {
    const paws = state === 0 ? pronePaws : standPaws;
    for (let i = 0; i < 2; i++) {
      ctx.save();
      const center = artPawCenters[state][i];
      ctx.translate(center.x, center.y);
      ctx.scale(1.118, 1.118);
      ctx.translate(-center.x, -center.y);
      fill(ctx, paws[i], state === 0 ? '#fff9e2' : '#edba86');
      ctx.restore();
    }
  }

  function drawLoaf(ctx: CanvasRenderingContext2D, alpha: number) {
    if (alpha <= .002) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(62, 319);
    ctx.scale(artScale[0], artScale[0]);
    ctx.translate(0, -929);
    ctx.clip(loafBody);
    // The rump and hind paw stay planted. Reveal coat where the upper body moves away.
    const fur = ctx.createLinearGradient(210, 600, 945, 860);
    fur.addColorStop(0, '#edb583');
    fur.addColorStop(.57, '#ca8956');
    fur.addColorStop(1, '#ca8956');
    ctx.fillStyle = fur;
    ctx.fillRect(85, 380, 1120, 559);
    ctx.clip(loafWithHead, 'evenodd');
    ctx.drawImage(art[0], 0, 0);
    ctx.restore();
  }

  function drawUprightTorso(ctx: CanvasRenderingContext2D, stance: number, lean: number, dip: number, alpha: number) {
    if (alpha <= .002) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(92, 319);
    ctx.transform(1, 0, -lean / 65, 1, 0, 0);
    ctx.scale(artScale[1], artScale[1] * (mix(.56, 1, stance) - dip * .003));
    ctx.translate(0, -1145);
    ctx.clip(uprightTorso);
    ctx.drawImage(art[1], 0, 0);
    // A small fill at the shoulders covers the old portrait beneath the shared head.
    fill(ctx, new Path2D('M315 781 C399 732 447 713 602 716 C745 713 825 722 901 758 L872 856 C803 899 733 871 699 854 C654 876 572 884 519 853 C449 883 372 868 328 851 Z'), '#ecb880');
    coverOriginalPaws(ctx, 1);
    ctx.restore();
  }

  function drawSharedHead(ctx: CanvasRenderingContext2D, stance: number, lean: number, dip: number, blink: number, now: number, hurry: number) {
    ctx.save();
    ctx.translate(mix(62, 75, stance) + lean, 319 - stance * 56 + dip);
    ctx.scale(artScale[0], artScale[0]);
    ctx.translate(0, -929);
    ctx.save();
    ctx.clip(headArt);
    ctx.drawImage(art[0], 0, 0);
    coverOriginalPaws(ctx, 0);
    drawFaceEyes(ctx, blink);
    if (hurry > .01) {
      ctx.save();
      ctx.globalAlpha = hurry;
      ctx.save();
      ctx.clip(mouthMask);
      ctx.drawImage(art[0], 437, 830, 109, 57, 559, 830, 109, 57);
      ctx.restore();
      line(ctx, 'M579 863 Q592 840 608 851 Q620 862 640 855', '#976638', 9);
      line(ctx, 'M375 696 Q425 686 475 715 M651 696 Q691 668 743 665', '#9a6137', 11);
      ctx.restore();
    }
    ctx.restore();

    if (hurry > .01) {
      const pop = Math.sin(Math.PI * smooth((now - uprightSince - 180) / 240)) * .20;
      ctx.save();
      ctx.globalAlpha = hurry;
      ctx.translate(924, 554);
      ctx.rotate(.19);
      ctx.scale(1.14 + pop, 1.14 + pop);
      ctx.lineCap = 'round';
      ctx.lineWidth = 11;
      ctx.strokeStyle = '#bd4e3e';
      ctx.stroke(angerMark);
      ctx.restore();
    }
    ctx.restore();
  }

  function straightArm(ctx: CanvasRenderingContext2D, shoulder: Point, tip: Point, width: number) {
    const dx = tip.x - shoulder.x;
    const dy = tip.y - shoulder.y;
    const length = Math.hypot(dx, dy);
    if (length < 5) return;
    const root = width / 2;
    const wrist = root * .73;
    const end = Math.max(1, length - 3);
    const shape = new Path2D();
    shape.moveTo(0, -root);
    shape.lineTo(end, -wrist);
    shape.quadraticCurveTo(end + wrist, -wrist, end + wrist, 0);
    shape.quadraticCurveTo(end + wrist, wrist, end, wrist);
    shape.lineTo(0, root);
    shape.bezierCurveTo(-root * 1.25, root, -root * 1.25, -root, 0, -root);
    ctx.save();
    ctx.translate(shoulder.x, shoulder.y);
    ctx.rotate(Math.atan2(dy, dx));
    fill(ctx, shape, '#ecb57f');
    ctx.restore();
  }

  function paintPawCutout(ctx: CanvasRenderingContext2D, id: number, tip: Point, tilt: number, drive: number) {
    const center = artPawCenters[0][id];
    const size = artScale[0];
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(tilt);
    ctx.scale(size * (1 + drive * .08), size * (1 - drive * .10));
    ctx.translate(-center.x, -center.y);
    ctx.clip(pronePaws[id]);
    ctx.drawImage(art[0], 0, 0);
    ctx.restore();
  }

  function strokeAt(now: number, tap: Strike, stance: number) {
    const age = now - tap.at;
    const flight = mix(55, 36, stance);
    const hold = mix(36, 28, stance);
    const settle = mix(125, 82, stance);
    const attacking = age < flight;
    const contact = age >= flight && age <= flight + hold;
    const drive = attacking ? smooth(age / flight) : 1 - smooth((age - flight - hold) / settle);
    return { drive, attacking, contact };
  }

  function updateStance(now: number, dt: number) {
    while (recent.length && now - recent[0] > 1120) recent.shift();
    const latest = recent.at(-1) ?? -1e5;
    const tenth = recent.at(-10);
    const cadence = tenth === undefined ? Infinity : latest - tenth;
    // Ten strokes span nine intervals. A small tolerance avoids flicker at a true 100 ms cadence.
    const fast = cadence <= 920 && now - latest < 150;
    const count = recent.filter(time => now - time <= 1000).length;
    const speed = fast ? Math.max(10, count) : count;
    if (fast) {
      fastSince ||= now;
      slowSince = 0;
      if (!standing && now - fastSince >= 290) {
        standing = true;
        uprightSince = now;
      }
    } else {
      fastSince = 0;
      if (speed <= 6) {
        slowSince ||= now;
        if (standing && now - slowSince >= 410) standing = false;
      } else {
        slowSince = 0;
      }
    }
    if (now - lastStrike >= 1120) standing = false;
    const riseDelay = reducedMotion.matches ? 45 : 90;
    pose += (Number(standing && now - uprightSince >= riseDelay) - pose) * (1 - Math.exp(-dt * (reducedMotion.matches ? 19 : standing ? 11 : 8)));
  }

  return {
    reset() {
      recent.length = 0;
      heldMouse.clear();
      for (const tap of taps) tap.at = -1e5;
      const wide = engine.keyboardLayout === '108';
      pawTips[0] = { x: wide ? 210 : 134, y: wide ? 324 : 321 };
      pawTips[1] = { x: wide ? 325 : 249, y: wide ? 317 : 314 };
      reachLean.x = reachLean.y = 0;
      pose = 0;
      standing = false;
      uprightSince = 0;
      fastSince = slowSince = 0;
      lastStrike = mouseMoveAt = -1e5;
      sleepSince = null;
      mouseGrip = 0;
      mouseSample = null;
      pointer = null;
      lastFrame = performance.now();
      blinkAt = lastFrame + 3800;
    },
    keyDown(vk: number, repeat: boolean, now: number) {
      const spec = resolveKeyByVk(vk, engine.keyboardLayout);
      if (!spec || repeat || chords.has(spec.id)) return;
      recent.push(now);
      lastStrike = now;
      const where = engine.getPetKeyTarget(spec);
      const mid = engine.keyboardLayout === '108' ? 290 : 214;
      const side = mouseGrip > .7 ? 1 : spec.id === 'space' ? Number(taps[0].at > taps[1].at) : Number(where.x > mid);
      taps[side] = { direction: where, from: pawTips[side], at: now, key: spec.id, contacted: false };
    },
    mouseMove(nx: number, ny: number, x: number, y: number, now: number) {
      if (mouseSample && Math.hypot(x - mouseSample.x, y - mouseSample.y) < 2) return;
      mouseSample = { x, y, nx, ny };
      mouseMoveAt = now;
    },
    mouseActivity(now: number, button?: string, pressed = false) {
      mouseMoveAt = now;
      if (button) {
        if (pressed) heldMouse.add(button);
        else heldMouse.delete(button);
      }
    },
    cursor(rx: number, ry: number) {
      const { w, h } = engine.getLogicalSize();
      pointer = { x: rx * w, y: ry * h };
    },
    draw(ctx: CanvasRenderingContext2D, now: number, sleepReady: boolean) {
      const dt = clamp((now - lastFrame) / 1000, 0, .045);
      lastFrame = now;
      updateStance(now, dt);
      const motion = reducedMotion.matches ? .28 : 1;
      const wide = engine.keyboardLayout === '108';
      const deskX = wide ? 76 : 0;
      const deskY = wide ? 3 : 0;
      const strokes = taps.map(tap => strokeAt(now, tap, pose));
      const chest = smooth(pose / .88);
      const headRise = smooth((pose - .15) / .85);
      const age = now - uprightSince;
      const brace = standing ? smooth(age / 44) * (1 - smooth((age - 100) / 115)) : 0;
      const gripWanted = heldMouse.size > 0 || now - mouseMoveAt < 620;
      mouseGrip += (Number(gripWanted) - mouseGrip) * (1 - Math.exp(-dt * (gripWanted ? 17 : 10)));
      if (mouseSample && mouseGrip > .94) {
        engine.onGlobalMouseMove(mouseSample.nx, mouseSample.ny, mouseSample.x, mouseSample.y);
      }

      const baseShoulders = [
        { x: mix(127, 168, chest), y: mix(306, 288, chest) },
        { x: mix(252, 251, chest), y: mix(306, 288, chest) },
      ];
      const main = strokes[0].drive >= strokes[1].drive ? 0 : 1;
      const lead = strokes[main].drive * (main === 0 ? 1 - mouseGrip : 1);
      const mainGoal = taps[main].direction;
      const mainShoulder = baseShoulders[main];
      const biasX = clamp((mainGoal.x - mainShoulder.x - deskX) * .39, wide ? -79 : -32, wide ? 79 : 32) * lead;
      const reachDrop = clamp((mainGoal.y - 332) * .29, 0, 14) * lead;
      reachLean.x += (biasX - reachLean.x) * (1 - Math.exp(-36 * dt));
      reachLean.y += (reachDrop - reachLean.y) * (1 - Math.exp(-33 * dt));
      const lean = reachLean.x * (1 - mouseGrip * .48) - (wide ? 90 : 25) * mouseGrip;
      const dip = reachLean.y + brace * 3.9 + mouseGrip * 2.7 +
        Math.max(...strokes.map(tap => tap.drive)) * mix(.3, 4.2, chest) * motion;
      const head = { x: mix(202, 213, headRise) + lean, y: mix(273, 223, headRise) + dip };
      const targetX = pointer ? clamp((pointer.x - head.x - deskX) / 116, -1, 1) : 0;
      const targetY = pointer ? clamp((pointer.y - head.y - deskY + 12) / 86, -1, 1) : 0;
      const response = 1 - Math.exp(-dt * 15);
      gaze.x += (targetX - gaze.x) * response;
      gaze.y += (targetY - gaze.y) * response;
      if (now > blinkAt + 185) blinkAt = now + 4900;
      sleepSince = sleepReady ? (sleepSince ?? now) : null;
      const blink = sleepReady ? 1 : now >= blinkAt ? Math.sin(Math.PI * clamp((now - blinkAt) / 185, 0, 1)) : 0;

      const uprightArt = smooth((pose - .10) / .46);
      const hurry = smooth((headRise - .38) / .40);
      ctx.save();
      ctx.translate(deskX, deskY);
      drawLoaf(ctx, 1 - uprightArt);
      drawUprightTorso(ctx, chest, lean, dip, uprightArt);
      ctx.save();
      ctx.translate(mix(269, 218, chest) + lean * .82, mix(286, 265, headRise) + dip);
      ctx.rotate(mix(-.54, 0, chest));
      engine.paintPetScarf(ctx, 0, 0, mix(104, 110, chest), mix(.77, .87, chest));
      ctx.restore();
      drawSharedHead(ctx, headRise, lean, dip, blink, now, hurry);
      if (sleepSince !== null) drawSleepIndicator(ctx, head.x + 59, head.y - 103, now - sleepSince);
      ctx.restore();
      engine.paintPetEquipment(ctx, 'mouse');
      engine.paintPetEquipment(ctx, 'keyboard', hurry > .5 ? 3 : undefined);
      engine.paintWeekdaySign(ctx, undefined, undefined, .80);
      const mouse = engine.getPetMouse();
      const mousePalm = { x: mouse.base[0] + mouse.offset[0] + 2, y: mouse.base[1] + mouse.offset[1] - 13 };

      for (const i of [0, 1]) {
        const grip = i === 0 ? smooth(mouseGrip) : 0;
        const stroke = strokes[i];
        const tap = taps[i];
        const braceSupport = brace * (1 - grip);
        const rest = {
          x: mix(i === 0 ? 134 : 249, i === 0 ? 180 : 247, chest) + deskX + lean + (i === 0 ? -2.2 : 2.2) * braceSupport,
          y: mix(i === 0 ? 321 : 314, 317, chest) + deskY + dip * .36 + braceSupport * 7,
        };
        const base = baseShoulders[i];
        const shoulder = {
          x: base.x + deskX + lean + clamp((tap.direction.x - base.x - deskX) * .14, -12, 12) * stroke.drive - grip * 21,
          y: base.y + deskY + dip * .78 + braceSupport * 2.8,
        };
        const dx = tap.direction.x - shoulder.x;
        const dy = tap.direction.y - shoulder.y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const toeOffset = 8.8;
        const travel = Math.min(distance - toeOffset, mix(70, 78, chest) + (wide ? 19 : 0));
        const contact = {
          x: shoulder.x + dx / distance * travel,
          y: shoulder.y + dy / distance * travel,
        };
        const origin = stroke.attacking ? tap.from : rest;
        const reach = stroke.drive * (1 - grip);
        const tip = {
          x: mix(mix(origin.x, contact.x, reach), mousePalm.x, grip),
          y: mix(mix(origin.y, contact.y, reach), mousePalm.y, grip),
        };
        const extend = Math.max(grip, reach, braceSupport, clamp(Math.hypot(tip.x - rest.x, tip.y - rest.y) / 14, 0, 1));
        const alignment = Math.atan2(tip.y - shoulder.y, tip.x - shoulder.x) - Math.PI / 2;
        const tilt = clamp(alignment, -1.37, 1.37) * extend;
        if (extend > .04) straightArm(ctx, shoulder, tip, mix(20, 18.5, chest));
        paintPawCutout(ctx, i, tip, tilt, stroke.contact ? reach : reach * .47);
        pawTips[i] = tip;

        if (stroke.contact && grip < .25 && !tap.contacted) {
          tap.contacted = true;
          engine.showPetKeyContact(tap.key);
        }
      }
    },
  };
}
