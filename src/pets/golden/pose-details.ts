export function createGripPainter() {
  const plate = document.createElement('canvas');
  const sceneWidth = 420, sceneHeight = 440, resolution = 2;
  plate.width = sceneWidth * resolution;
  plate.height = sceneHeight * resolution;
  const source = plate.getContext('2d')!;
  source.scale(resolution, resolution);
  const left = 14, right = 117, top = 272, wrist = 309, bottom = 348;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const w = right - left, h = bottom - top;
  // The wrist stays small for the pixel deformation. The face keeps its
  // full-density pixels across the rest of the plate.
  const wristPlate = document.createElement('canvas');
  wristPlate.width = w;
  wristPlate.height = h;
  const wristPixels = wristPlate.getContext('2d', { willReadFrequently: true })!;
  const moved = wristPixels.createImageData(w, h);
  const clamp = (n: number, end: number) => Math.max(0, Math.min(end, n));

  return function paintGrip(ctx: CanvasRenderingContext2D, draw: (area: CanvasRenderingContext2D) => void,
    dx: number, dy: number, equipment: () => void, mouseX: number, mouseY: number) {
    source.clearRect(0, 0, sceneWidth, sceneHeight);
    draw(source);
    wristPixels.clearRect(0, 0, w, h);
    wristPixels.drawImage(plate, left * resolution, top * resolution,
      w * resolution, h * resolution, 0, 0, w, h);
    const original = wristPixels.getImageData(0, 0, w, h).data;
    const result = moved.data;
    function weight(x: number, y: number) {
      return ease(clamp((w - x) / 46, 1)) * ease(clamp(y / (wrist - top), 1));
    }
    // Inverse-map the wrist patch. The deformation tapers to zero at the chest
    // and shoulder, so the right forepaw follows the mouse against a fixed body.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let amount = weight(x, y);
        amount = weight(x - dx * amount, y - dy * amount);
        amount = weight(x - dx * amount, y - dy * amount);
        const sx = clamp(x - dx * amount, w - 1);
        const sy = clamp(y - dy * amount, h - 1);
        const ix = Math.floor(sx), iy = Math.floor(sy);
        const u = sx - ix, v = sy - iy;
        const a = 4 * (iy * w + ix), b = a + (ix < w - 1 ? 4 : 0);
        const c = a + (iy < h - 1 ? 4 * w : 0), d = c + b - a;
        const wa = original[a + 3] * (1 - u) * (1 - v);
        const wb = original[b + 3] * u * (1 - v);
        const wc = original[c + 3] * (1 - u) * v;
        const wd = original[d + 3] * u * v;
        const alpha = wa + wb + wc + wd;
        const i = (y * w + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          result[i + channel] = alpha ? (original[a + channel] * wa + original[b + channel] * wb
            + original[c + channel] * wc + original[d + channel] * wd) / alpha : 0;
        }
        result[i + 3] = alpha;
      }
    }
    wristPixels.putImageData(moved, 0, 0);
    source.clearRect(left, top, w, h);
    source.drawImage(wristPlate, left, top);
    ctx.drawImage(plate, 0, 0, sceneWidth, sceneHeight);
    equipment();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(mouseX, mouseY - 5, 17, 15, 0, 0, 2 * Math.PI);
    ctx.clip();
    ctx.drawImage(wristPlate, left, top);
    ctx.restore();
  };
}

export function drawFishDream(ctx: CanvasRenderingContext2D, elapsed: number, opacity = 1) {
  const t = elapsed / 1000;
  const appear = Math.min(1, Math.max(0, (t - .28) / .7));
  if (appear <= 0 || opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity * appear * appear * (3 - 2 * appear);
  ctx.translate(113, 211 + Math.sin(t * 2.2) * 3 + (1 - appear) * 7);
  ctx.strokeStyle = '#b89774';
  ctx.lineWidth = 1.2;
  ctx.fillStyle = '#fff7e8';
  function bubble(x: number, y: number, w: number, h: number) {
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, -.08, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  bubble(-31, 34, 2.8, 2.3);
  bubble(-24, 26, 4, 3.2);
  bubble(0, 0, 28, 20);

  ctx.translate(Math.sin(t * 2.7) * 2, Math.cos(t * 2.5) * 1.4);
  ctx.rotate(-.23 + Math.sin(t * 3) * .12);
  const gold = ctx.createLinearGradient(0, -7, 0, 8);
  gold.addColorStop(0, '#d59b5e');
  gold.addColorStop(1, '#ac633e');
  ctx.fillStyle = gold;
  ctx.strokeStyle = '#854d36';
  ctx.lineWidth = 1.05;
  ctx.lineJoin = 'round';
  const tail = Math.sin(t * 7) * 1.3;
  ctx.beginPath();
  ctx.moveTo(-17, 0);
  ctx.bezierCurveTo(-11, -8, 1, -7, 9, -2);
  ctx.lineTo(16, -6 + tail);
  ctx.lineTo(14, tail);
  ctx.lineTo(17, 5 + tail);
  ctx.lineTo(9, 2);
  ctx.bezierCurveTo(1, 7, -10, 7, -17, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-8, -4);
  ctx.quadraticCurveTo(-4, 0, -8, 4);
  ctx.moveTo(-2, -3);
  ctx.lineTo(0, 1);
  ctx.moveTo(2, -2.5);
  ctx.lineTo(4, 1.5);
  ctx.stroke();
  ctx.fillStyle = '#51342c';
  ctx.beginPath();
  ctx.arc(-12, -1, 1.05, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}
