const weekdayGlyphs = ['日', '一', '二', '三', '四', '五', '六'];
const glyphs: Record<string, string> = {
  星: 'M4 2H15V8H4Z M4 5H15 M5 11L2 15 M4 13H16 M5 17H15 M10 10.5V21 M2 21H17',
  期: 'M3 2V14 M9 2V14 M1 4H11 M3 7H9 M3 10H9 M1 14H11 M4.5 16.5L2 20.5 M7.5 16.5L9.5 19 M11.5 20.5Q13 17.5 13 12V2.5H18V19Q18 21 16.5 21H15 M13 8H18 M13 13H18',
  日: 'M3.5 3.5H15.5V20H3.5Z M3.5 11.5H15.5',
  一: 'M2 12H17',
  二: 'M4 6H15 M2 19H17',
  三: 'M3 4H16 M4.5 11.5H14.5 M1.5 20H17.5',
  四: 'M2 4H17V20H2Z M7 4.5V9.5Q7 13 4 15 M11.5 4.5V11.5Q11.5 13 13 13H15',
  五: 'M2 4H17 M9 4L5.5 20 M4 11H14L13 20 M1.5 20H17.5',
  六: 'M8 2L11 6 M1.5 9H17.5 M6.5 13L2 20 M12 13L17 20',
};

const width = 72;
const height = 34;
const resolution = 3;

export function createWeekdayLamp() {
  const image = document.createElement('canvas');
  image.width = width * resolution;
  image.height = height * resolution;
  const ctx = image.getContext('2d')!;
  ctx.scale(resolution, resolution);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let weekday = -1;
  let nextCheck = 0;

  function paint(day: number): void {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < 3; i++) {
      const left = 5 + i * 21;
      const center = left + 9.5;
      ctx.fillStyle = '#19171a';
      ctx.beginPath();
      ctx.ellipse(center, 29, 4, 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5d4937';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(center, 28.5);
      ctx.lineTo(center, 14);
      ctx.stroke();

      ctx.save();
      ctx.translate(left, 4);
      const tube = new Path2D(glyphs[['星', '期', weekdayGlyphs[day]][i]]);
      ctx.strokeStyle = '#6d3a16';
      ctx.lineWidth = 2.55;
      ctx.stroke(tube);

      ctx.shadowColor = 'rgba(255, 131, 32, 0.72)';
      ctx.shadowBlur = 3.8 * resolution;
      ctx.strokeStyle = '#ff991f';
      ctx.lineWidth = 1.58;
      ctx.stroke(tube);

      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffe4a6';
      ctx.lineWidth = 0.65;
      ctx.stroke(tube);
      ctx.restore();
    }
  }

  return (target: CanvasRenderingContext2D, x: number, y: number, now: number): void => {
    if (now >= nextCheck) {
      nextCheck = now + 1000;
      const day = new Date().getDay();
      if (day !== weekday) {
        weekday = day;
        paint(weekday);
      }
    }
    target.drawImage(image, x, y, width, height);
  };
}
