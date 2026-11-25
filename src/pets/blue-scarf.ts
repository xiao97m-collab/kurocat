const band = ('M-63 -5 C-44 7 -20 11 0 12 C26 12 46 7 63 -6 L59 8 C42 23 24 29 1 30 C-27 29 -48 23 -60 12 Z');
const tail = ('M22 19 C33 15 45 18 51 24 L58 51 L49 50 L45 56 L39 54 L35 59 L28 55 L18 25 Z');
const upperFold = ('M-56 4 C-26 16 20 25 54 5');
const lowerFold = ('M-48 17 C-17 29 22 33 45 17');
const fringe = ('M30 48L33 55 M37 46L41 54 M44 43L48 51 M50 40L55 48');

let paths: Path2D[] | undefined;

export function drawBlueScarf(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height = 1): void {
  const [bandPath, tailPath, upperPath, lowerPath, fringePath] = paths ??= [band, tail, upperFold, lowerFold, fringe].map(path => new Path2D(path));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(width / 126, width / 126 * height);
  const fabric = ctx.createLinearGradient(-28, 0, 29, 48);
  fabric.addColorStop(0, '#4d89b8');
  fabric.addColorStop(.56, '#2f6fa1');
  fabric.addColorStop(1, '#245481');
  ctx.fillStyle = fabric;
  ctx.fill(tailPath);
  ctx.fill(bandPath);
  ctx.strokeStyle = '#97c5e3';
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.stroke(upperPath);
  ctx.stroke(fringePath);
  ctx.strokeStyle = '#1b4f79';
  ctx.lineWidth = 2.5;
  ctx.stroke(lowerPath);
  ctx.restore();
}
