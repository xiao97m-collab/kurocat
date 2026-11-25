import type { KeySpec } from './keyboardLayout';

export const keyboardThemeIds = ['classic', 'voyage', 'rgb', 'terminal'] as const;
export type KeyboardTheme = typeof keyboardThemeIds[number];
export type KeyRipple = { key: KeySpec; age: number };

interface BoardFinish {
  shell: string;
  edge: string;
  plate: string;
  trim: string;
}

export const boardFinishes: Record<KeyboardTheme, BoardFinish> = {
  classic: { shell: '#24262c', edge: '#363840', plate: '#d4d6d1', trim: '#363840' },
  voyage: { shell: '#1b3142', edge: '#b89555', plate: '#243f51', trim: '#d9b679' },
  rgb: { shell: '#121823', edge: '#40567e', plate: '#19314c', trim: '#52d9ed' },
  terminal: { shell: '#17181a', edge: '#36383c', plate: '#242629', trim: '#55545a' },
};

export function isKeyboardTheme(value: string | undefined): value is KeyboardTheme {
  return keyboardThemeIds.some(theme => theme === value);
}

export function keyFinish(theme: KeyboardTheme, key: KeySpec) {
  const mod = key.accent === 'mod';
  if (theme === 'voyage') {
    if (key.id === 'esc' || key.id === 'enter') return { top: '#a7372b', side: '#742520', ink: '#fff1d2' };
    if (key.id === 'space') return { top: '#d9b26d', side: '#977044', ink: '#3b4650' };
    return mod ? { top: '#31546b', side: '#21374a', ink: '#f7e2ba' }
      : { top: '#f3e4c6', side: '#b7a383', ink: '#23394c' };
  }
  if (theme === 'rgb') {
    return mod || key.id === 'esc' ? { top: '#24334f', side: '#286384', ink: '#bdefff' }
      : { top: '#273a52', side: '#237e9f', ink: '#d5e8ff' };
  }
  if (theme === 'terminal') {
    if (key.id === 'esc' || key.id === 'enter') return { top: '#ea8139', side: '#a34b23', ink: '#221b19' };
    return mod ? { top: '#303135', side: '#1d1e20', ink: '#adadb1' }
      : { top: '#35363a', side: '#222325', ink: '#ece9e0' };
  }
  if (key.accent === 'orange') return { top: '#f4a524', side: '#c27a10', ink: '#ffffff' };
  return mod ? { top: '#efefeb', side: '#c7c9c3', ink: '#2c2f36' }
    : { top: '#f8f8f5', side: '#d0d2cc', ink: '#2c2f36' };
}

export function rippleAmount(key: KeySpec, ripple: KeyRipple | null): number {
  if (!ripple || ripple.age < 0 || ripple.age > 900) return 0;
  const cx = key.uStart + key.uWidth / 2;
  const ox = ripple.key.uStart + ripple.key.uWidth / 2;
  const dy = (key.rowY ?? key.row) - (ripple.key.rowY ?? ripple.key.row);
  const distance = Math.hypot(cx - ox, dy * .9);
  const radius = ripple.age * .030;
  return Math.exp(-(((distance - radius) / 2.05) ** 2)) * (1 - ripple.age / 900);
}

export function paintVoyageMark(ctx: CanvasRenderingContext2D, key: KeySpec, x: number, y: number, size: number, ink: string): void {
  if (!['space', 'esc', 'enter'].includes(key.id)) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.lineWidth = .09;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.beginPath();
  if (key.id === 'space') {
    for (let i = -2; i <= 2; i++) {
      const left = i * .72 - .35;
      ctx.moveTo(left, .03);
      ctx.quadraticCurveTo(left + .18, -.24, left + .36, .03);
      ctx.quadraticCurveTo(left + .54, .30, left + .72, .03);
    }
  } else if (key.id === 'enter') {
    ctx.moveTo(0, -.49);
    ctx.lineTo(.15, -.13);
    ctx.lineTo(.49, 0);
    ctx.lineTo(.14, .13);
    ctx.lineTo(0, .49);
    ctx.lineTo(-.14, .13);
    ctx.lineTo(-.49, 0);
    ctx.lineTo(-.14, -.13);
    ctx.closePath();
  } else {
    ctx.moveTo(-.56, .14);
    ctx.quadraticCurveTo(0, .43, .56, .14);
    ctx.moveTo(-.34, .22);
    ctx.lineTo(-.27, -.19);
    ctx.quadraticCurveTo(0, -.53, .27, -.19);
    ctx.lineTo(.34, .22);
    ctx.moveTo(-.31, .03);
    ctx.quadraticCurveTo(0, .16, .31, .03);
  }
  ctx.stroke();
  ctx.restore();
}
