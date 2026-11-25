const glyphs = ['日', '一', '二', '三', '四', '五', '六'];
const labels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const width = 88;
const height = 43;

export function createWeekdayLamp() {
  const surface = document.createElement('canvas');
  const ratio = 3;
  surface.width = width * ratio;
  surface.height = height * ratio;
  const ctx = surface.getContext('2d')!;
  ctx.scale(ratio, ratio);
  let weekday = -1;
  let nextCheck = 0;

  function panel(x: number, y: number, w: number, h: number, radius: number, fill: string, outline?: string) {
    const top = Math.min(y, y + h);
    const bottom = Math.max(y, y + h);
    const right = x + w;
    const r = Math.min(radius, w / 2, (bottom - top) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, top);
    ctx.arcTo(right, top, right, bottom, r);
    ctx.arcTo(right, bottom, x, bottom, r);
    ctx.arcTo(x, bottom, x, top, r);
    ctx.arcTo(x, top, right, top, r);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = .75;
      ctx.stroke();
    }
  }

  function paint(day: number): void {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.shadowColor = '#3beff49c';
    ctx.shadowBlur = 6 * ratio;
    panel(5, 4, 78, 33, 6, '#152333');
    ctx.restore();
    panel(5, 4, 78, 33, 6, '#0b1727', '#62cce4');
    panel(8, 7, 72, 27, 4, '#122035', '#26435c');
    panel(29, 36, 30, 4, 1.8, '#27384d', '#466580');

    ctx.fillStyle = '#56dfb0';
    ctx.beginPath();
    ctx.arc(16.3, 13, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#90d5d5';
    ctx.font = '700 5.5px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('LIVE', 21.2, 13);
    ctx.fillStyle = '#91a9c6';
    ctx.textAlign = 'right';
    ctx.fillText(labels[day], 73, 13);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e5faff';
    ctx.font = '700 13px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`星期${glyphs[day]}`, 13, 24);
    for (let i = 0; i < 7; i++) {
      panel(59 + i * 2.2, 29, 1.28, -2, .6, i === day ? '#65eff3' : '#344e70');
    }
  }

  return (target: CanvasRenderingContext2D, x: number, y: number, now: number, scale = 1): void => {
    if (now >= nextCheck) {
      nextCheck = now + 1000;
      const day = new Date().getDay();
      if (day !== weekday) {
        weekday = day;
        paint(day);
      }
    }
    target.drawImage(surface, x, y, width * scale, height * scale);
  };
}
