type Hand = 'left' | 'right';
type Point = { x: number; y: number };
type Drag = { hand: Hand; contact: Point; reach: number };
type FramePainter = (ctx: CanvasRenderingContext2D, frame: number) => void;

const width = 864;
const height = 478;
const lift = 96;
const pawData = {
  // Coordinates measured in the uncropped source, before the common registration.
  left: { tip: [360, 451], points: [[308, 333], [424, 333], [416, 366], [397, 429], [397, 453], [314, 453], [315, 417], [319, 390]] },
  right: { tip: [468, 455], points: [[419, 333], [542, 333], [522, 365], [505, 392], [508, 456], [420, 456], [427, 420], [426, 364]] },
};

function surface(w = width, h = height) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d')!;
}

export function createTypingComposite(paintFrame: FramePainter, neutralFrame: number) {
  const neutral = surface();
  const upper = surface();
  const body = surface();
  const front = surface();
  const mask = surface();
  paintFrame(neutral, neutralFrame);

  // Head and shoulders retain the video motion. The feather ends above the feet
  // and before the hindquarters, which come exclusively from the neutral plate.
  const horizontal = mask.createLinearGradient(365, 0, 491, 0);
  horizontal.addColorStop(0, '#fff');
  horizontal.addColorStop(1, 'transparent');
  mask.fillStyle = horizontal;
  mask.fillRect(0, 0, width, height);
  const vertical = mask.createLinearGradient(0, 273, 0, 339);
  vertical.addColorStop(0, '#fff');
  vertical.addColorStop(1, 'transparent');
  mask.globalCompositeOperation = 'destination-in';
  mask.fillStyle = vertical;
  mask.fillRect(0, 0, width, height);

  function makePaw(hand: Hand) {
    const { tip, points } = pawData[hand];
    const polygon = points.map(([x, y]) => [x - 100, y - 1]);
    const [x, y] = [Math.min(...polygon.map(pt => pt[0])), Math.min(...polygon.map(pt => pt[1]))];
    const w = Math.max(...polygon.map(pt => pt[0])) - x;
    const h = Math.max(...polygon.map(pt => pt[1])) - y;
    const path = new Path2D();
    polygon.forEach(([u, v]) => path.lineTo(u, v));
    path.closePath();
    const paw = surface(w, h);
    paw.translate(-x, -y);
    paw.clip(path);
    paw.drawImage(neutral.canvas, 0, 0);
    return { path, texture: paw.canvas, x, y, w, h, tip: { x: tip[0] - 100, y: tip[1] - 1 } };
  }

  const paws = { left: makePaw('left'), right: makePaw('right') };

  function assemble(frame: number, drag: Drag | null) {
    body.clearRect(0, 0, width, height);
    front.clearRect(0, 0, width, height);
    body.drawImage(neutral.canvas, 0, 0);
    if (frame !== neutralFrame) {
      upper.clearRect(0, 0, width, height);
      paintFrame(upper, frame);
      upper.globalCompositeOperation = 'destination-in';
      upper.drawImage(mask.canvas, 0, 0);
      upper.globalCompositeOperation = 'source-over';
      body.globalCompositeOperation = 'destination-out';
      body.drawImage(mask.canvas, 0, 0);
      body.globalCompositeOperation = 'lighter';
      body.drawImage(upper.canvas, 0, 0);
      body.globalCompositeOperation = 'source-over';
    }
    if (!drag || drag.reach <= 0) return;
    const paw = paws[drag.hand];
    const dx = (drag.contact.x - paw.tip.x) * drag.reach;
    const contactY = drag.contact.y + lift;
    const heightAboveKey = Math.sin(Math.PI * drag.reach) * 25;
    const dy = (contactY - paw.tip.y) * drag.reach - heightAboveKey;
    body.save();
    body.clip(paw.path);
    body.clearRect(paw.x, paw.y, paw.w, paw.h);
    body.restore();

    // Preserve width and blend the displacement in from the shoulder. The toe
    // stops at the cap instead of moving the carcass or the planted feet.
    const weight = (y: number) => Math.min(1, (y / (paw.tip.y - paw.y)) ** 2);
    front.save();
    front.beginPath();
    front.rect(0, 0, width, paw.tip.y + dy + 1);
    front.clip();
    for (let y = 0; y < paw.h; y += 2) {
      const end = Math.min(y + 2, paw.h);
      const startY = y + dy * weight(y);
      const endY = end + dy * weight(end);
      if (endY <= startY) continue;
      front.drawImage(paw.texture, 0, y, paw.w, end - y,
        paw.x + dx * weight(y), paw.y + startY, paw.w, endY - startY + .8);
    }
    front.restore();
    body.drawImage(front.canvas, 0, 0);
  }

  return { assemble, body: body.canvas, paw: front.canvas, padding: lift };
}
