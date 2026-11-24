export function drawSleepIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, age: number): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#354a62';
  ctx.fillStyle = '#eef7ff';
  const arrival = Math.min(age / 240, 1);
  for (let i = 0; i < 3; i++) {
    const progress = (age / 2400 + i / 3) % 1;
    const dx = x + progress * 25;
    const dy = y - progress * 32;
    ctx.globalAlpha = arrival * Math.sin(progress * Math.PI) * .9;
    ctx.font = `600 ${12 + progress * 8}px system-ui`;
    ctx.strokeText('z', dx, dy);
    ctx.fillText('z', dx, dy);
  }
  ctx.restore();
}
