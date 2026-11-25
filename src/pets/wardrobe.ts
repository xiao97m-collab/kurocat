export const PET_SKINS = ['plain', 'classic', 'explorer', 'magic', 'winter', 'sakura', 'summer'] as const;
export type PetSkin = typeof PET_SKINS[number];
type WardrobeBreed = 'cat' | 'corgi';
type WardrobePose = 'rest' | 'ready' | 'left' | 'right' | 'mouse-touch' | 'mouse-key' | 'brace' | 'flinch';
type Sleeved = 'summer' | 'sakura';
type Garment = Sleeved | 'magic';
type Scarf = 'classic' | 'explorer' | 'winter';
type Paint = string | CanvasGradient;
type Palette = { lit: string; mid: string; shade: string; seam: string; trim: string };
export type Arm = [shoulderX: number, shoulderY: number, cuffX: number, cuffY: number];
export type Fitting = [left: number, right: number, top: number, lowLeft: number, lowRight: number, bottom: number, arms: Arm[]];
type Sleeve = { x: number; y: number; angle: number; length: number; cuff: number; shoulder: number };
type Mount = { eyes: [number, number, number, number]; neck: [number, number, number]; back: [number, number] };

export function isPetSkin(value: unknown): value is PetSkin {
  return typeof value === 'string' && PET_SKINS.some(skin => skin === value);
}

export function supportsWardrobe(breed: string): boolean {
  return breed === 'black' || breed === 'corgi';
}

export function hasSleeves(skin: PetSkin): skin is Sleeved {
  return skin === 'summer' || skin === 'sakura';
}

function hasGarment(skin: PetSkin): skin is Garment {
  return hasSleeves(skin) || skin === 'magic';
}

function hasScarf(skin: PetSkin): skin is Scarf {
  return skin === 'classic' || skin === 'explorer' || skin === 'winter';
}

// Landmarks use the original atlas canvas, regardless of the sprite crop.
// Eyes define the head axis; neck and back are picked on their own silhouettes.
const landmarks: Record<WardrobeBreed, Record<WardrobePose, Mount>> = {
  cat: {
    rest:          { eyes: [172.6, 134.5, 218.6, 134.5], neck: [195.5, 176, -.05], back: [260, 220] },
    ready:         { eyes: [172.4, 134.7, 218.5, 134.7], neck: [195.5, 176, -.05], back: [260, 220] },
    left:          { eyes: [178.1, 137.6, 224.2, 138.2], neck: [199, 179, -.04], back: [263, 222] },
    right:         { eyes: [181.9, 139.0, 227.9, 142.5], neck: [199.5, 181, .01], back: [264, 223] },
    'mouse-touch': { eyes: [128.5, 149.5, 174.2, 144.1], neck: [170, 189, -.12], back: [242, 218] },
    'mouse-key':   { eyes: [138.2, 147.8, 184.0, 143.0], neck: [175.5, 187, -.10], back: [247, 220] },
    brace:         { eyes: [170.6, 177.9, 220.0, 177.9], neck: [195, 217, -.05], back: [263, 232] },
    flinch:        { eyes: [173.6, 180.5, 222.9, 180.5], neck: [198.5, 219, -.05], back: [267, 233] },
  },
  corgi: {
    rest:          { eyes: [166.6, 278.0, 225.8, 269.8], neck: [254, 293, -.46], back: [312, 213] },
    ready:         { eyes: [179.6, 222.3, 238.8, 214.4], neck: [214, 261, -.09], back: [282, 259] },
    left:          { eyes: [179.5, 231.9, 238.8, 224.7], neck: [215, 268, -.09], back: [283, 263] },
    right:         { eyes: [185.4, 231.0, 244.6, 224.0], neck: [224, 268, -.09], back: [288, 260] },
    'mouse-touch': { eyes: [154.7, 224.7, 213.9, 216.5], neck: [199, 259, -.12], back: [272, 261] },
    'mouse-key':   { eyes: [143.0, 233.6, 202.2, 225.4], neck: [187, 268, -.13], back: [270, 266] },
    brace:         { eyes: [178.2, 242.1, 240.7, 235.5], neck: [215, 275, -.09], back: [289, 266] },
    flinch:        { eyes: [181.2, 243.4, 243.5, 236.9], neck: [216, 277, -.09], back: [291, 266] },
  },
};


// Measured directly on the pose art: shoulder span, lower side seam, sleeve axes.
const tailoring: Record<'cat' | 'corgi', Partial<Record<WardrobePose, Fitting>>> = {
  cat: {
    rest:          [142,249,186,124,271,269, [[170,210,172,275], [221,210,220,275]]],
    ready:         [142,249,186,124,271,269, [[170,210,172,275], [221,210,220,275]]],
    left:          [145,252,188,125,273,271, [[164,207,169,260], [224,205,237,268]]],
    right:         [145,253,190,125,274,271, [[159,207,166,271], [227,211,224,260]]],
    'mouse-touch': [116,223,193,116,266,270, [[133,214,105,251], [212,216,226,268]]],
    'mouse-key':   [121,228,193,119,269,270, [[140,214,109,251], [211,213,205,268]]],
    brace:         [139,252,221,122,275,276, [[164,243,172,272], [225,242,231,273]]],
    flinch:        [142,255,223,122,275,277, [[166,245,173,274], [226,245,233,274]]],
  },
  corgi: {
    ready:         [144,270,258,139,298,309, [[171,273,177,301], [247,271,247,301]]],
    left:          [143,272,265,137,299,312, [[171,277,174,307], [249,275,249,314]]],
    right:         [149,278,265,143,305,311, [[170,278,178,313], [254,277,253,303]]],
    'mouse-touch': [117,245,258,128,285,308, [[129,287,88,307], [220,279,222,302]]],
    'mouse-key':   [109,237,266,123,281,311, [[124,294,84,309], [202,288,189,314]]],
    brace:         [127,273,273,117,300,300, [[142,277,121,288], [260,278,285,289]]],
    flinch:        [129,275,275,119,301,302, [[144,279,121,289], [263,280,286,291]]],
  },
};


export function createWardrobePainter(ctx: CanvasRenderingContext2D) {
  function gradient(x0: number, y0: number, x1: number, y1: number, stops: Array<[number, string]>) {
    const paint = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([offset, color]) => paint.addColorStop(offset, color));
    return paint;
  }

  function ellipse(x: number, y: number, rx: number, ry: number, fill: Paint, stroke?: string, width = 1) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = width;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function rounded(x: number, y: number, w: number, h: number, r: number, fill: Paint, stroke?: string, width = 1) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = width;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function pack(x: number, y: number, compact: boolean) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-.14);
    if (compact) ctx.scale(.86, .75);
    const leather = gradient(-20, -10, 27, 45, [[0, '#cd9b61'], [.55, '#aa6d3c'], [1, '#6a3f2a']]);
    rounded(-21, -12, 57, 74, 19, leather, '#553628', 2.5);
    rounded(8, 19, 29, 34, 9, '#a97446', '#73492c', 2);
    rounded(7, 17, 31, 13, 5, '#d7a774', '#895737', 1.6);
    rounded(19, 23, 6, 21, 2, '#774a31');
    rounded(18, 31, 8, 6, 2, '#d5a86f', '#633f2c');
    rounded(-25, -22, 66, 27, 12, '#d9a977', '#7c5134', 2);
    ellipse(31, -8, 10, 12, '#e8bc86', '#8f5a36', 1.7);
    ellipse(31, -8, 6, 8, '#c18752', '#9d623b', 1.3);
    ellipse(31, -8, 2.7, 4, '#edc28b');
    rounded(12, -22, 6, 28, 2, '#986039');
    ctx.restore();
  }

  function goggles(corgi: boolean) {
    ctx.save();
    ctx.translate(0, corgi ? -40 : -29.5);
    if (corgi) ctx.scale(1.03, 1.02);
    rounded(-49, -4, 98, 13, 5, '#875131', '#422a22', 2);
    rounded(-44, -2, 88, 3, 1.5, '#b07849');
    rounded(-10, -2, 20, 8, 3, '#d49653', '#644126', 1.7);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(21 * side, 0);
      ctx.rotate(side * .10);
      const brass = gradient(0, -15, 0, 16, [[0, '#ffe0a5'], [.43, '#d5a266'], [1, '#975b32']]);
      const glass = gradient(-9, -11, 8, 10, [[0, '#714f40'], [.4, '#423434'], [1, '#201d22']]);
      ellipse(0, 2, 20, 15, '#7b4930', '#3b2820', 1.9);
      ellipse(0, 0, 19, 14, brass, '#a16a3c', 1.2);
      ellipse(0, 0, 14.2, 10, glass, '#5f392e', 1.4);
      ctx.beginPath();
      ctx.ellipse(-2, 0, 10.4, 6.4, 0, 3.85, 4.96);
      ctx.strokeStyle = '#f7d4ac';
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ellipse(6, 5, 2.1, 1.3, '#9d7963');
      ctx.restore();
    }
    ctx.restore();
  }

  function compass(pressed: boolean, needle: number) {
    ctx.save();
    ctx.translate(0, -29);
    ctx.scale(pressed ? .97 : 1, pressed ? .92 : 1);
    ellipse(0, 24, 23, 5.5, 'rgba(27,18,13,.19)');
    const metal = gradient(-19, -22, 19, 26, [[0, '#ffe2a2'], [.42, '#d1a15a'], [.7, '#85502d'], [1, '#e3ad66']]);
    const dial = gradient(-10, -17, 13, 19, [[0, '#fff4cf'], [1, '#eacb8c']]);
    ellipse(0, 1, 24, 25, metal, '#653f2a', 2.1);
    ellipse(0, 0, 19.5, 20.5, dial, '#98683d', 1.4);
    for (let tick = 0; tick < 12; tick += 1) {
      const angle = tick * Math.PI / 6;
      ctx.save();
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -17.2);
      ctx.lineTo(0, tick % 3 === 0 ? -13.1 : -15.2);
      ctx.strokeStyle = '#80603b';
      ctx.lineWidth = tick % 3 === 0 ? 1.55 : .8;
      ctx.stroke();
      ctx.restore();
    }
    ctx.rotate(.45 + needle);
    for (const [direction, fill] of [[-1, '#ab3e32'], [1, '#3c666e']] as const) {
      ctx.beginPath();
      ctx.moveTo(0, direction * 14);
      ctx.lineTo(-4.7, 0);
      ctx.lineTo(4.7, 0);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ellipse(0, 0, 2.5, 2.5, '#f7e2aa', '#8a6748');
    ctx.restore();
  }

  function star(x: number, y: number, radius: number, fill: Paint, stroke?: string, width = 1) {
    ctx.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const angle = Math.PI * point / 5 - Math.PI / 2;
      const distance = point % 2 ? radius * .46 : radius;
      ctx.lineTo(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  function wizardHat(corgi: boolean, lowStance: boolean) {
    ctx.translate(corgi ? 1 : -3, corgi ? lowStance ? -57 : -72 : -36);
    const felt = gradient(-43, -70, 60, 30, [[0, '#7362ac'], [.52, '#4c3b81'], [1, '#292348']]);
    const edge = '#31254e';
    const gold = '#e9bb6c';

    ctx.save();
    ctx.rotate(.12);
    ellipse(0, 0, corgi ? 63 : 69, 13, felt, edge, 2.8);
    ctx.beginPath();
    ctx.moveTo(-46, -3);
    ctx.bezierCurveTo(-31, -21, -26, -46, -6, -66);
    ctx.bezierCurveTo(7, -80, 23, -72, 38, -54);
    ctx.bezierCurveTo(46, -44, 51, -44, 57, -54);
    ctx.bezierCurveTo(58, -35, 45, -32, 33, -41);
    ctx.quadraticCurveTo(23, -23, 44, -1);
    ctx.quadraticCurveTo(-4, 8, -46, -3);
    ctx.fillStyle = felt;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-36, -11);
    ctx.quadraticCurveTo(-2, 3, 35, -8);
    ctx.strokeStyle = '#b2788e';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, corgi ? 62 : 68, 12, 0, 0, Math.PI);
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2.8;
    ctx.stroke();
    star(7, -34, 14, '#ffe0a0', '#be884b', 1.9);
    star(-22, -21, 4, '#b6a3e2');
    ctx.restore();
  }

  function starWand(pressed: boolean, motion: number) {
    ctx.save();
    ctx.translate(-1, -34);
    ctx.rotate(-.46 + motion * .19);
    const handle = gradient(-5, 0, 4, 0, [[0, '#a97747'], [.5, '#f1cc8b'], [1, '#925938']]);
    rounded(-3.0, 8, 6, 24, 2.6, handle, '#583c4d', 1.3);
    ellipse(0, 30, 3.6, 3.6, '#e4b663', '#784746', 1.3);
    if (pressed) ellipse(0, 0, 27, 27, 'rgba(246,199,119,.24)');
    star(0, 0, pressed ? 22 : 20, '#6e51a0', '#835c59', 3);
    star(0, 0, pressed ? 20.5 : 19, '#7d5bbb', '#ecbc71', 2.1);
    star(0, 0, 11, pressed ? '#fff2bf' : '#ffce82', '#ac7667', 1.0);
    ctx.restore();
  }

  function shape(d: string, fill: Paint | null, stroke?: string, width = 1) {
    const path = new Path2D(d);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }
    return path;
  }

  function pompom(x: number, y: number) {
    ctx.save();
    ctx.translate(x, y);
    const yarn = gradient(-10, -14, 12, 16, [[0, '#fff5dd'], [1, '#d5b994']]);
    shape('M0 -17 Q7 -19 10 -13 Q18 -13 17 -5 Q22 1 17 7 Q17 14 9 14 Q5 21 -2 17 Q-10 19 -13 12 Q-20 8 -17 2 Q-22 -5 -14 -10 Q-12 -17 -5 -15 Q-2 -18 0 -17Z',
      yarn, '#b79069', 1.7);
    shape('M-10 2 Q-8 -6 -2 -7 M-4 9 Q3 3 8 3 M6 -11 Q13 -8 12 -2', null, '#cfaf86', 1.1);
    ctx.restore();
  }

  function knitHat(corgi: boolean, compact: boolean) {
    ctx.translate(0, corgi ? (compact ? -44 : -57) : -15);
    if (corgi) ctx.scale(.95, .94);
    const crown = gradient(-31, -56, 31, 10, [[0, '#fff0d7'], [.57, '#ead5b7'], [1, '#ccad88']]);
    // Knitted ear points on the cat, with the Corgi's taller ears beside its cap.
    if (!corgi) {
      shape('M-55 -23 Q-58 -43 -52 -55 Q-49 -64 -43 -58 L-19 -39 M22 -38 Q38 -61 48 -58 Q55 -58 56 -27',
        '#e4c6a3', '#b38b68', 2);
      shape('M-48 -49 Q-50 -40 -46 -29 L-30 -37Z M29 -37 Q43 -49 47 -49 Q51 -42 47 -28Z', '#f2dac0');
    }
    pompom(55, -48);
    shape('M-58 -8 Q-55 -38 -26 -46 Q8 -56 40 -39 Q58 -25 63 -8 Q34 -26 1 -26 Q-35 -26 -58 -8Z',
      crown, '#b99571', 2.3);
    for (const offset of [-30,-12,7,26,42]) {
      shape(`M${offset - 5} -24 Q${offset + 1} -32 ${offset} ${-43 + offset ** 2 / 233}`, null, '#d6b991', 1.5);
    }
    const brim = 'M-65 10 Q-64 -12 -39 -24 Q-17 -34 5 -33 Q41 -33 59 -13 Q69 -3 66 12 Q62 18 55 12 Q42 -10 7 -14 Q-31 -14 -52 9 Q-57 16 -63 14Z';
    shape(brim, gradient(0, -26, 0, 15, [[0, '#fff7e7'], [1, '#e4cba9']]), '#baa07e', 2.2);
    ctx.save();
    ctx.clip(new Path2D(brim));
    for (let x = -61; x <= 67; x += 11) {
      shape(`M${x} -36 Q${x + 4} -19 ${x} 22`, null, '#d7bb98', 1);
    }
    ctx.restore();
  }

  function flower(x: number, y: number, size: number, petal: string, edge: string, heart: string, notch = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 21, size / 21);
    for (let i = 0; i < 5; i += 1) {
      const outline = notch
        ? 'M0 1 C-8 -3 -13 -13 -8 -19 Q-4 -24 0 -19 Q4 -24 8 -19 C13 -13 8 -3 0 1Z'
        : 'M0 1 C-9 -3 -13 -17 -5 -21 C4 -25 11 -16 8 -9 Q5 -2 0 1Z';
      shape(outline, petal, edge, 1.35);
      ctx.rotate(Math.PI * 2 / 5);
    }
    ellipse(0, 0, 3.3, 3.3, heart);
    for (let i = 0; i < 5; i += 1) {
      ellipse(0, -6, 1.25, 1.25, heart);
      ctx.rotate(Math.PI * 2 / 5);
    }
    ctx.restore();
  }

  function cherryClip(corgi: boolean, compact: boolean) {
    const x = corgi ? 56 : 50;
    const y = corgi ? (compact ? -64 : -73) : -42;
    flower(x + 20, y + 10, 11, '#f3a2af', '#b95e78', '#f2c482', true);
    flower(x, y, 24, '#ffbcc9', '#cc7189', '#f6cb86', true);
  }

  function strawHat(corgi: boolean, compact: boolean) {
    ctx.translate(-1, corgi ? (compact ? -65 : -76) : -40);
    ctx.rotate(.25);
    if (corgi) ctx.scale(.92, .92);
    const straw = gradient(-50, -46, 59, 30, [[0, '#ffe1a1'], [.54, '#edb772'], [1, '#d49356']]);
    ellipse(0, 5, 84, 21, straw, '#b9814b', 2.5);
    ellipse(0, 5.7, 78.6, 17.8, 'rgba(0,0,0,0)', '#f4cc88', 1.45);
    shape('M-45 0 Q-43 -23 -26 -36 Q-6 -49 17 -39 Q37 -31 43 -6 Q10 13 -45 0Z', straw, '#ba834d', 2);
    shape('M-43 -8 Q-8 4 43 -10 L44 -1 Q-1 14 -45 1Z', '#a76546', '#905437', 1.4);
    shape('M-31 -23 Q5 -13 33 -23 M-26 -30 Q2 -22 25 -28 M-60 16 Q-2 35 65 15', null, '#cd9a60', 1.22);
    ctx.save();
    ctx.translate(14, -22);
    ctx.rotate(-.1);
    rounded(-9,-7,18,6,2.5,'#4d3531');
    for (const side of [-1,1]) {
      ctx.save();
      ctx.translate(side * 19, -3);
      ctx.rotate(side * .12);
      rounded(-15,-10,30,21,8,'#241f24','#fff0bd',2);
      shape('M-8 -4 Q-4 -8 3 -6', null, '#a6a3a5', 1.7);
      ctx.restore();
    }
    ctx.restore();
  }

  function coconut(pressed: boolean, motion: number) {
    ctx.save();
    ctx.translate(0, -29);
    ctx.scale(pressed ? 1.03 : 1, pressed ? .96 : 1);
    ellipse(1, 23, 24, 4.5, 'rgba(37,27,22,.17)');
    const shell = gradient(-16,-15,22,22,[[0,'#dca568'],[.53,'#ac6c3b'],[1,'#72462c']]);
    shape('M-24 -7 Q-25 9 -13 20 Q-3 27 11 22 Q25 17 25 -5 Q23 -14 0 -14 Q-23 -14 -24 -7Z',
      shell, '#77462d', 2);
    shape('M-17 -5 Q-16 12 -6 19 M2 3 Q3 15 0 21 M15 -4 Q16 10 10 17', null, '#be8653', 1.2);
    ellipse(0,-8,24,9,'#f8dfa9','#95603b',1.8);
    ellipse(0,-8.4,19.5,6.2,'#fff4cf');
    ctx.save();
    ctx.translate(7,-9);
    ctx.rotate(Math.max(-.85, Math.min(.85, motion)) * .24);
    shape('M0 0 L3 -17 Q3.5 -19 6 -20 L15 -24', null, '#9d4d4b', 4.8);
    shape('M0 0 L3 -17 Q3.5 -19 6 -20 L15 -24', null, '#ed8879', 2.7);
    ctx.restore();
    shape('M-15 -11 Q-24 -23 -31 -19 Q-32 -9 -15 -11Z', '#91b870', '#5c855c', 1.45);
    shape('M-15 -11 Q-23 -16 -29 -17', null, '#638b5b', 1);
    ctx.restore();
  }

  const cloth: Record<Garment,Palette> = {
    summer: { lit:'#a8d8c8', mid:'#63aca0', shade:'#34716a', seam:'#3a7772', trim:'#a7d4bf' },
    sakura: { lit:'#ffc2d1', mid:'#e997ae', shade:'#ac587a', seam:'#a45c7c', trim:'#ffe8e8' },
    magic:  { lit:'#8974b8', mid:'#614d97', shade:'#362953', seam:'#40305e', trim:'#e4ba73' },
  };
  const scarves: Record<Scarf,Palette> = {
    classic: { lit:'#71aacf', mid:'#3d7ca8', shade:'#214a72', seam:'#224d75', trim:'#a2c6e1' },
    explorer:{ lit:'#edb87b', mid:'#bd824b', shade:'#85502e', seam:'#71462d', trim:'#e9b97e' },
    winter: { lit:'#fff3dd', mid:'#e7ceae', shade:'#ad8864', seam:'#b59774', trim:'#f7e8ca' },
  };

  let foreground: { normalizedHead: Path2D; pronePaw: Path2D } | undefined;

  function corgiForeground() {
    if (foreground) return foreground;
    const sourceHead = new Path2D('M231 732 C170 706 132 625 122 535 C115 475 126 421 152 398 C173 379 202 379 237 388 C288 403 342 439 377 470 L415 506 C476 471 565 458 626 468 C676 398 755 323 833 295 C865 283 893 289 906 317 C930 360 925 425 914 478 C907 531 884 595 858 633 C913 692 932 751 923 797 C917 839 885 873 858 883 C810 902 753 906 709 905 C642 918 582 926 517 926 C467 927 410 926 372 921 C314 920 271 912 245 910 C216 890 211 860 206 829 C201 797 214 757 231 732 Z');
    const normalizedHead = new Path2D();
    normalizedHead.addPath(sourceHead, new DOMMatrix()
    .rotate(Math.atan2(33,249) * 180 / Math.PI)
    .scale(60 / Math.hypot(249,33))
    .translate(-566.5,-738.5));
    const pronePaw = new Path2D('M232 313 C232 302 242 296 253 298 C266 298 271 305 269 314 C267 322 256 324 247 323 C238 324 232 320 232 313Z');
    foreground = { normalizedHead, pronePaw };
    return foreground;
  }

  function fabricFill(palette: Palette, x: number, y: number, w: number, h: number) {
    return gradient(x - w * .46, y, x + w * .62, y + h * .35, [
      [0,palette.shade], [.24,palette.mid], [.48,palette.lit], [.71,palette.mid], [1,palette.shade],
    ]);
  }

  function drawFabricPattern(theme: Garment, clip: Path2D, x: number, y: number, width: number, height: number) {
    ctx.save();
    ctx.clip(clip);
    if (theme === 'summer' || theme === 'sakura') {
      const centers = [[.14,.34],[.35,.64],[.24,.82],[.68,.32],[.83,.55],[.59,.82],[.91,.85]];
      for (const [fx,fy] of centers) {
        const px = x + width * fx;
        const py = y + height * fy;
        const side = Math.abs(fx - .50);
        const r = (theme === 'summer' ? 13 : 9) - 10 * side;
        ctx.save();
        ctx.translate(px,py);
        ctx.scale(1 - side * .54, .84 + fy * .12);
        if (theme === 'summer') {
          shape('M-3 5 Q-12 16 -19 12 Q-15 3 -3 5Z','#b1d2a6','#75a58c',.9);
          flower(0,0,r,fx < .43 ? '#f9e9cc' : '#ffd0b9','#e39482','#cc796f');
        } else {
          flower(0,0,r,'#ffe0e6','#e9a5b8','#f6c783',true);
        }
        ctx.restore();
      }
    } else if (theme === 'magic') {
      for (const [fx,fy,r] of [[.22,.42,6],[.38,.75,4],[.70,.31,4],[.83,.65,7],[.67,.85,4]]) {
        star(x + width*fx, y + height*fy, r, '#e3bd80');
      }
    }
    ctx.restore();
  }

  function sleeveFit(axis: Arm, theme: Sleeved, corgi: boolean, low: boolean): Sleeve {
    const [x,y,fx,fy] = axis;
    const dx = fx - x;
    const dy = fy - y;
    const cuff = (theme === 'sakura' ? 18 : 14) * (low ? .83 : 1);
    const shoulder = (corgi ? 15 : 19) * (low ? .92 : 1);
    return { x, y, angle: Math.atan2(dy,dx), length: Math.hypot(dx,dy), cuff, shoulder };
  }

  function paintSleeve({x,y,angle,length,cuff,shoulder}: Sleeve, theme: Sleeved) {
    const palette = cloth[theme];
    const dye = gradient(0,-shoulder,0,shoulder,[[0,palette.shade],[.42,palette.mid],[.69,palette.lit],[1,palette.mid]]);
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(angle);
    const fabric = shape(`M-12 ${-shoulder+3} Q0 ${-shoulder-4} ${length*.36} ${-shoulder+1}
      Q${length*.71} ${-cuff-2} ${length} ${-cuff}
      Q${length+7} 0 ${length} ${cuff}
      Q${length*.53} ${cuff+3} -12 ${shoulder-2}Z`, dye, palette.seam, 1.9);
    ctx.save();
    ctx.clip(fabric);
    flower(length*.57,0,theme==='summer' ? 8 : 6,theme==='summer'?'#ffe3bd':'#ffe0e6',
      theme==='summer'?'#d89178':'#e4a1b2','#e5a477',theme==='sakura');
    ctx.restore();
    shape(`M${length-2} ${-cuff+2.1} Q${length+9} 0 ${length-2} ${cuff-2.1} Q${length+4} 0 ${length-2} ${-cuff+2.1}Z`,
      palette.shade);
    shape(`M${length-4.5} ${-cuff+1} Q${length+2} 0 ${length-4.5} ${cuff-1}`, null, palette.trim, 1.5);
    shape(`M${length*.27} ${-shoulder+4} Q${length*.52} ${-cuff+5} ${length*.69} ${-cuff+3}`, null, palette.seam, 1.1);
    ctx.restore();
  }

  function silkBow(x: number, y: number, scale: number) {
    ctx.save();
    ctx.translate(x,y);
    ctx.scale(scale,scale);
    shape('M-2 -1 C-22 -17 -27 6 -5 4 C-14 14 -2 16 0 7 C7 19 17 14 7 4 C29 9 25 -15 3 -1Z',
      '#efb46f','#ad724c',1.7);
    ellipse(1,2,5.7,4.5,'#ffe1a4','#ae7851',1.3);
    ctx.restore();
  }

  function keepForearmsClear(sleeves: Sleeve[]) {
    const visibleCloth = new Path2D();
    visibleCloth.rect(0,0,420,440);
    for (const {x,y,angle,length,cuff} of sleeves) {
      const width = cuff - 2;
      const opening = new Path2D(`M${length-1} ${-width} Q${length+52} ${-width} ${length+78} ${-width+2}
        L${length+78} ${width-2} Q${length+53} ${width} ${length-1} ${width}Z`);
      visibleCloth.addPath(opening,new DOMMatrix().translate(x,y).rotate(angle * 180 / Math.PI));
    }
    ctx.clip(visibleCloth,'evenodd');
  }

  function dressUpright(profile: Fitting, theme: Garment, corgi: boolean, low: boolean, paintArms = true) {
    const [left,right,top,lowLeft,lowRight,bottom,arms] = profile;
    const width = right-left;
    const cx = (left+right)*.5;
    const height = bottom-top;
    const palette = cloth[theme];
    const hasSleeves = theme === 'summer' || theme === 'sakura';
    const sleeves = hasSleeves ? arms.filter(axis => Math.hypot(axis[2]-axis[0],axis[3]-axis[1]) > 5)
      .map(axis => sleeveFit(axis,theme,corgi,low)) : [];
    const neckline = theme === 'magic' ? 12 : 16;
    const shoulderWidth = corgi ? 6 : 2;
    const hemLift = theme === 'magic' ? 6 : 0;
    const edge = `M${left+shoulderWidth} ${top} Q${cx} ${top + neckline} ${right-shoulderWidth} ${top-2}
      Q${right+12} ${top+height*.40} ${lowRight+2} ${bottom-12}
      Q${cx+11} ${bottom+13-hemLift} ${lowLeft-2} ${bottom-10}
      Q${left-9} ${top+height*.39} ${left+shoulderWidth} ${top}Z`;
    ctx.save();
    if (hasSleeves) keepForearmsClear(sleeves);
    const piece = shape(edge,fabricFill(palette,cx,top,width,height),palette.seam,2.5);
    drawFabricPattern(theme,piece,lowLeft,top,lowRight-lowLeft,height);
    shape(`M${lowLeft+2} ${bottom-12} Q${cx+9} ${bottom+9-hemLift} ${lowRight-3} ${bottom-13}`, null, palette.trim, theme==='magic' ? 3.4 : 1.75);
    for (const side of [-1,1]) {
      const end = side<0 ? lowLeft : lowRight;
      shape(`M${cx+side*width*.30} ${top+height*.42} Q${end-side*9} ${bottom-21} ${end-side*17} ${bottom-6}`,
        null, palette.seam, 1.25);
    }

    if (theme === 'summer') {
      const y = top + Math.min(27,height*.44);
      shape(`M${left+5} ${top-2} Q${cx-11} ${top+6} ${cx} ${y-4}
        L${cx-14} ${y+3} L${left+13} ${top+19} L${left-2} ${top+22}Z
        M${right-5} ${top-4} Q${cx+10} ${top+6} ${cx} ${y-4}
        L${cx+14} ${y+4} L${right-11} ${top+17} L${right+2} ${top+19}Z`,
        '#92c7b9', palette.seam, 1.9);
      shape(`M${cx} ${y} Q${cx+2} ${bottom-14} ${cx+4} ${bottom-1}`, null, palette.seam, 1.9);
      for (const progress of [.49,.73,.89]) ellipse(cx+4,top+height*progress,2.2,2.1,'#f2e8cb');
    }
    if (theme === 'sakura') {
      const y = top+height*(low ? .40 : .60);
      ctx.save();
      ctx.clip(piece);
      shape(`M${left+1} ${top-1} Q${cx-10} ${top+10} ${cx+18} ${y+8}
        L${cx+7} ${y+12} Q${cx-22} ${top+22} ${left-2} ${top+9}Z`,
        '#f9d9e1','#d0849d',1.5);
      shape(`M${right-2} ${top-3} Q${cx+14} ${top+5} ${cx-16} ${y+7}
        L${cx-6} ${y+11} Q${cx+29} ${top+18} ${right+1} ${top+9}Z`,
        '#fff0e9','#c97b99',1.6);
      shape(`M${lowLeft+3} ${y-2} Q${cx} ${y+19} ${lowRight-2} ${y-4}
        L${lowRight-1} ${y+9} Q${cx} ${y+33} ${lowLeft+1} ${y+11}Z`,
        '#b76786','#92476e',1.5);
      silkBow(cx+5,y+14,low ? .67 : .84);
      ctx.restore();
    }
    if (theme === 'magic') {
      shape(`M${left+2} ${top+1} Q${cx} ${top+27} ${right-3} ${top-1}`, null, '#b39ed2', 3.1);
      shape(`M${cx} ${top+23} Q${cx+5} ${top+height*.63} ${cx-2} ${bottom+2}`, null, '#4d396f', 2.3);
      ellipse(cx,top+17,9.7,8.2,'#77578d','#e0ba79',2);
      star(cx,top+17,6,'#ffd993');
    }
    ctx.restore();
    if (hasSleeves && paintArms) for (const sleeve of sleeves) paintSleeve(sleeve,theme);
  }

  function dressProne(theme: Garment) {
    // The longer cut is built around the ribs and hindquarters of the prone Corgi.
    const palette = cloth[theme];
    const back = theme === 'summer' ? 326 : 336;
    const outline = `M201 226 Q231 209 268 214 Q309 217 ${back-8} 244
      Q${back+8} 268 ${back} 293 Q${back-4} 307 ${back-18} 309
      Q291 318 248 307 Q222 312 185 303 Q193 273 201 226Z`;
    const panel = shape(outline,fabricFill(palette,268,216,133,100),palette.seam,2.3);
    drawFabricPattern(theme,panel,218,220,118,90);
    shape(`M249 306 Q286 317 ${back-19} 306 Q${back-8} 302 ${back-2} 292`, null, palette.trim, 2.5);
    shape('M261 241 Q279 257 277 279 Q276 295 266 306 M293 239 Q311 257 311 275 Q309 291 301 301', null, palette.seam, 1.6);
    if (theme === 'summer') {
      shape('M250 236 Q264 242 277 254 L266 268 L245 251Z','#b5d8c6','#438880',1.6);
      shape('M258 267 Q279 286 267 309',null,'#59887e',1.15);
    } else if (theme === 'sakura') {
      shape('M287 224 Q311 251 311 280 Q311 293 303 309 L317 307 Q327 286 322 264 Q313 237 300 229Z',
        '#af6080','#955171',1.6);
      shape('M297 231 Q321 261 318 286 Q317 298 311 307',null,'#e7a6b5',1.3);
      silkBow(310,262,.79);
    } else if (theme === 'magic') {
      star(301,256,10,'#f0ca85');
      shape('M253 226 Q269 252 268 272',null,'#cfafe6',1.6);
    }
    if (theme === 'summer' || theme === 'sakura') {
      paintSleeve(sleeveFit([155,295,136,312],theme,true,true),theme);
      paintSleeve(sleeveFit([273,281,256,304],theme,true,true),theme);
    }
  }

  function wrapScarf(theme: Scarf, x: number, y: number, tilt: number, width: number, compact: boolean) {
    const palette = scarves[theme];
    const length = theme === 'classic' ? 30 : theme === 'explorer' ? 37 : 43;
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(tilt);
    ctx.scale(width/110, compact ? .64 : 1);
    const wrap = fabricFill(palette,0,0,104,24);
    if (theme === 'explorer') {
      shape('M-55 -3 Q-56 -10 -47 -14 Q-1 -23 49 -11 Q57 -8 56 -2 Q28 -7 0 -4 Q-30 -10 -55 -3Z',
        palette.shade,palette.seam,1.3);
    }
    ctx.save();
    ctx.translate(theme === 'classic' ? 31 : 35, theme === 'winter' ? 11 : 8);
    ctx.rotate(-.32);
    shape(`M-10 -2 Q1 -5 11 -1 Q9 12 13 ${length} Q3 ${length+5} -12 ${length} Q-6 15 -10 -2Z`,
      fabricFill(palette,0,0,22,length),palette.seam,1.8);
    shape(`M-8 ${length-6} Q3 ${length-2} 12 ${length-5}`,null,palette.trim,1.4);
    for (const dx of [-7,-1,5,10]) shape(`M${dx} ${length} l1 5`,null,palette.trim,1.8);
    ctx.restore();
    const band = 'M-55 -5 Q-52 -10 -46 -8 Q-18 5 5 3 Q31 3 49 -10 Q55 -12 57 -6 Q56 9 50 13 Q24 25 2 23 Q-28 25 -52 12 Q-56 8 -55 -5Z';
    shape(band,wrap,palette.seam,2);
    shape('M-50 0 Q-14 17 13 12 Q32 11 51 -2 M-45 10 Q-11 27 36 14',null,palette.trim,1.18);
    if (theme === 'winter') {
      for (const x of [-40,-26,-12,2,16,30,43]) shape(`M${x} 4 q2 8 0 13`,null,palette.seam,.8);
    } else {
      rounded(32,5,18,11,4,palette.mid,palette.seam,1.3);
    }
    ctx.restore();
  }

  function wrapProneScarf(theme: Scarf) {
    const palette = scarves[theme];
    const classic = theme === 'classic';
    const band = classic
      ? 'M240 305 Q258 297 263 279 Q268 268 275 272 Q281 276 276 288 Q267 306 250 312 Q244 312 240 305Z'
      : 'M246 302 Q261 285 262 260 Q264 246 274 246 Q288 248 288 264 Q286 282 274 299 Q265 309 254 312 Q248 313 246 302Z';
    ctx.save();
    ctx.translate(classic ? -8 : 0,classic ? 4 : 0);
    shape('M279 271 Q292 277 308 285 L300 298 Q289 293 275 287Z',palette.mid,palette.seam,1.8);
    shape('M300 289 l6 2 M298 292 l6 3 M295 294 l6 3',null,palette.trim,1.7);
    ctx.restore();
    shape(band,fabricFill(palette,271,248,35,64),palette.seam,2);
    shape(classic
      ? 'M272 276 Q273 288 263 297 Q253 304 248 306'
      : 'M276 250 Q287 267 271 291 Q264 300 254 305 M268 252 Q271 270 262 283',null,palette.trim,1.5);
    if (theme === 'winter') {
      shape('M265 263 l19 4 M264 272 l16 4 M260 281 l16 5 M255 289 l15 6',null,palette.seam,1.1);
    }
  }

  function explorerStraps(mount: Pick<Mount,'neck' | 'back'>, corgi: boolean, pose: WardrobePose) {
    const [x,y] = mount.neck;
    const [backX,backY] = mount.back;
    const low = pose === 'brace' || pose === 'flinch';
    if (corgi && pose === 'rest') {
      shape(`M${backX+2} ${backY+17} Q${backX-42} 227 ${x+13} 264 Q${x+4} 277 ${x+7} 301`,null,'#69462e',12);
      shape(`M${backX+2} ${backY+17} Q${backX-42} 227 ${x+13} 264 Q${x+4} 277 ${x+7} 301`,null,'#ba8856',7.4);
      return;
    }
    const bend = corgi ? 13 : 24;
    const endY = y + (low ? 58 : corgi ? 46 : 86);
    const strap = `M${x+39} ${y-1} C${x+35} ${y+22} ${x+bend+1} ${endY-18} ${x+bend+5} ${endY-8}
      Q${backX-3} ${endY-1} ${backX+11} ${backY+31}`;
    shape(strap,null,'#5d3d2a',10.4);
    shape(strap,null,'#a67347',6.5);
    shape(`M${x+37} ${y+6} Q${x+31} ${y+26} ${x+bend+4} ${endY-15}`,null,'#d8a471',1.15);
    rounded(x+29,y+20,11,8,2,'#cc9e6b','#694831',1.2);
  }

  function repaintCorgiForeground(paintSprite: () => void, mount: Mount, pose: WardrobePose) {
    const { normalizedHead, pronePaw } = corgiForeground();
    const [lX,lY,rX,rY] = mount.eyes;
    const angle = Math.atan2(rY-lY,rX-lX) * 180 / Math.PI;
    const mask = new Path2D();
    mask.addPath(normalizedHead,new DOMMatrix().translate((lX+rX)*.5,(lY+rY)*.5)
      .rotate(angle).scale(Math.hypot(rX-lX,rY-lY)/60));
    if (pose === 'rest') mask.addPath(pronePaw);
    if (pose === 'brace' || pose === 'flinch') {
      const paws = [[110,296,15,9],[169,313,14,10],[236,315,14,10],[302,298,15,9]];
      for (const [x,y,w,h] of paws) {
        mask.moveTo(x + w,y);
        mask.ellipse(x,y,w,h,0,0,Math.PI * 2);
        mask.closePath();
      }
    }
    ctx.save();
    ctx.clip(mask);
    paintSprite();
    ctx.restore();
  }


  function hat(skin: PetSkin, x: number, y: number, angle: number, corgi: boolean, compact: boolean) {
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(angle);
    switch (skin) {
      case 'explorer': goggles(corgi); break;
      case 'magic': wizardHat(corgi,compact); break;
      case 'winter': knitHat(corgi,compact); break;
      case 'sakura': cherryClip(corgi,compact); break;
      case 'summer': strawHat(corgi,compact); break;
    }
    ctx.restore();
  }

  function prop(skin: PetSkin, x: number, y: number, left: number, right: number, offsetX: number): boolean {
    if (skin !== 'explorer' && skin !== 'magic' && skin !== 'summer') return false;
    const nudge = (left - right) * .69 + Math.max(-.32,Math.min(.32,offsetX / 34));
    const pressed = Math.max(left,right) > .2;
    ctx.save();
    ctx.translate(x,y+28);
    if (skin === 'explorer') compass(pressed,nudge);
    else if (skin === 'magic') starWand(pressed,nudge);
    else coconut(pressed,nudge);
    ctx.restore();
    return true;
  }

  function body(skin: PetSkin, fitting: Fitting, corgi: boolean) {
    if (hasGarment(skin)) dressUpright(fitting,skin,corgi,false,false);
  }

  function sleeve(skin: PetSkin, arm: Arm, corgi: boolean) {
    if (hasSleeves(skin) && Math.hypot(arm[2]-arm[0],arm[3]-arm[1]) > 5) {
      paintSleeve(sleeveFit(arm,skin,corgi,false),skin);
    }
  }

  function prone(skin: PetSkin) {
    if (hasGarment(skin)) dressProne(skin);
  }

  function scarf(skin: PetSkin, x: number, y: number, angle: number, width: number, compact: boolean, prone = false) {
    if (!hasScarf(skin)) return;
    if (prone) wrapProneScarf(skin);
    else wrapScarf(skin,x,y,angle,width,compact);
  }

  function landing(skin: PetSkin, breed: WardrobeBreed, pose: WardrobePose, wide: boolean,
    pivotX: number, pivotY: number, paintSprite: () => void) {
    if (skin === 'plain') { paintSprite(); return; }
    const mount = landmarks[breed][pose];
    const [nx,ny,tilt] = mount.neck;
    const [bx,by] = mount.back;
    const corgi = breed === 'corgi';
    const proneCorgi = corgi && pose === 'rest';
    const low = pose === 'brace' || pose === 'flinch';
    const compact = corgi && (low || proneCorgi);
    const dx = wide ? corgi ? 76 : 82 : 0;
    const dy = wide ? corgi ? 3 : -16 : 0;
    const paintAtlas = () => {
      ctx.save();
      ctx.translate(pivotX-dx,pivotY-dy);
      paintSprite();
      ctx.restore();
    };
    ctx.save();
    ctx.translate(dx-pivotX,dy-pivotY);
    if (skin === 'explorer') pack(bx-5,by+7,compact);
    paintAtlas();
    if (hasGarment(skin)) {
      const fit = tailoring[breed][pose];
      if (proneCorgi) dressProne(skin);
      else if (fit) dressUpright(fit,skin,corgi,low);
    }
    if (skin === 'explorer') explorerStraps(mount,corgi,pose);
    scarf(skin,nx,ny-2,tilt,skin === 'classic' ? 100 : 107,low,proneCorgi);
    if (corgi) repaintCorgiForeground(paintAtlas,mount,pose);
    const [lx,ly,rx,ry] = mount.eyes;
    ctx.translate((lx+rx)/2,(ly+ry)/2);
    const scale = Math.hypot(rx-lx,ry-ly) / (corgi ? 60 : 46);
    ctx.scale(scale,scale);
    hat(skin,0,0,Math.atan2(ry-ly,rx-lx),corgi,compact);
    ctx.restore();
  }

  return { hat, prop, body, sleeve, prone, scarf, pack, explorerStraps, landing };
}
