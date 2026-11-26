import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { KuroCatEngine, type KeyboardOrientation } from './catEngine';
import { catAudio } from './audio';
import { DEFAULT_BUILTIN_CATS, type CatSkinConfig } from './catSkins';
import type { KeyboardLayoutId } from './keyboardLayout';
import { isKeyboardTheme, type KeyboardTheme } from './keyboardTheme';
import type { loadDuorou } from './pets/duorou';
import type { PetEquipment3D } from './pets/duorou/equipment3d';
import { isPetSkin, supportsWardrobe, type PetSkin } from './pets/wardrobe';
import { createLandingPainter, isLandingBreed, loadLandingAtlas } from './pets/landing-motion';

const duorouId = 'duorou';
const goldenId = 'golden';
const isMac = /Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent);

interface AppSettings {
  x: number | null;
  y: number | null;
  scale: number;
  alwaysOnTop: boolean;
  clickThroughLocked: boolean;
  followTyping: boolean;
  showKeyBubbles: boolean;
  soundEnabled: boolean;
  autostart: boolean;
  catBreed: string;
  mcpEnabled: boolean;
  mcpPort: number;
  keyboardLayout: KeyboardLayoutId;
  keyboardOrientation: KeyboardOrientation;
  keyboardTheme: KeyboardTheme;
  weekdaySign: boolean | null;
  blueScarf: boolean;
  petSkin: PetSkin | null;
  duorouEquipment3d: boolean;
}

type InputEvent =
  | { kind: 'keyDown'; vk: number; scan: number; repeat: boolean }
  | { kind: 'keyUp'; vk: number; scan: number }
  | { kind: 'mouseDown'; button: string }
  | { kind: 'mouseUp'; button: string }
  | { kind: 'mouseWheel'; delta: number }
  | { kind: 'mouseMove'; x: number; y: number; nx: number; ny: number };

interface WindowCursorInfo {
  relX: number;
  relY: number;
  insideWindow: boolean;
  overCat: boolean;
  altOverride?: boolean;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  assetName: string | null;
  downloadUrl: string | null;
  assetSha256: string | null;
  assetSize: number | null;
  installKind: string;
  notesSummary: string;
}

interface UpdateProgressEvent {
  stage: string;
  message: string;
  info: UpdateInfo | null;
}

let appVersion = '1.0.0';
let latestUpdateInfo: UpdateInfo | null = null;
let updateBusy = false;
let dismissedVersion: string | null = null;
let toastAutoHideTimer: number | null = null;
let sliderDragging = false;
let altOverride = false;
let lastKnownLockState: boolean | null = null;

let settings: AppSettings = {
  x: null,
  y: null,
  scale: 1,
  alwaysOnTop: true,
  clickThroughLocked: false,
  followTyping: false,
  showKeyBubbles: true,
  soundEnabled: true,
  autostart: false,
  catBreed: 'black',
  mcpEnabled: true,
  mcpPort: 27420,
  keyboardLayout: '65',
  keyboardOrientation: 'cat',
  keyboardTheme: 'classic',
  weekdaySign: null,
  blueScarf: false,
  petSkin: null,
  duorouEquipment3d: false,
};

let catList: CatSkinConfig[] = [...DEFAULT_BUILTIN_CATS];

const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
const menuEl = document.getElementById('context-menu') as HTMLDivElement;
const typingFollowButton = menuEl.querySelector<HTMLButtonElement>('[data-action="toggle-typing-follow"]')!;
const breedPillsEl = document.getElementById('breed-pills') as HTMLDivElement;
const keyboardLayoutEl = document.getElementById('keyboard-layout-options') as HTMLDivElement;
const petSkinEl = document.getElementById('pet-skin-options') as HTMLDivElement;
const scarfButton = menuEl.querySelector<HTMLButtonElement>('[data-action="toggle-scarf"]')!;
const equipmentEl = document.getElementById('pet-equipment-options') as HTMLDivElement;
const scaleSliderEl = document.getElementById('scale-slider') as HTMLInputElement;
const scaleValueEl = document.getElementById('scale-value') as HTMLButtonElement;
const updateToastEl = document.getElementById('update-toast') as HTMLDivElement;
const updateToastTextEl = document.getElementById('update-toast-text') as HTMLSpanElement;
const btnToastInstallEl = document.getElementById('btn-toast-install') as HTMLButtonElement;
const btnToastOpenEl = document.getElementById('btn-toast-open') as HTMLButtonElement;
const btnToastCloseEl = document.getElementById('btn-toast-close') as HTMLButtonElement;
const engine = new KuroCatEngine(canvas);
type DesktopPet = Awaited<ReturnType<typeof loadDuorou>> | Awaited<ReturnType<typeof import('./pets/corgi').loadCorgi>>
  | Awaited<ReturnType<typeof import('./pets/golden').loadGolden>>;
const petLoaders: Record<string, () => Promise<DesktopPet>> = {
  duorou: () => import('./pets/duorou').then(module => module.loadDuorou(engine)),
  corgi: () => import('./pets/corgi').then(module => module.loadCorgi(engine)),
  golden: () => import('./pets/golden').then(module => module.loadGolden(engine)),
};
const petLoads = new Map<string, Promise<DesktopPet>>();
let activePet: DesktopPet | null = null;
let activePetId = '';
let equipment3d: PetEquipment3D | null = null;
let equipmentLoad: Promise<void> | null = null;

function syncPetEquipment(): void {
  const enabled = settings.duorouEquipment3d;
  engine.setPetEquipment3d(enabled ? equipment3d : null);
  if (!enabled || equipment3d || equipmentLoad) return;

  equipmentLoad = import('./pets/duorou/equipment3d').then(({ PetEquipment3D }) => {
    if (!settings.duorouEquipment3d) return;
    equipment3d = new PetEquipment3D();
    engine.setPetEquipment3d(equipment3d);
  }).catch(error => {
    console.error('Failed to load 3D equipment:', error);
    if (settings.duorouEquipment3d) {
      showUpdateToast('3D 键鼠不可用，已切回 2D', { autoHideMs: 4200 });
      void applySettingsPatch({ duorouEquipment3d: false });
    }
  }).finally(() => { equipmentLoad = null; });
}

function selectDesktopPet(id: string): void {
  if (id === activePetId) return;
  activePetId = id;
  activePet = null;
  engine.setPetPainter(null);
  const loader = petLoaders[id];
  if (!loader) return;

  let load = petLoads.get(id);
  if (!load) {
    load = loader();
    petLoads.set(id, load);
  }
  void load.then(pet => {
    if (id !== activePetId) return;
    pet.reset();
    activePet = pet;
    engine.setPetPainter(pet.draw);
  }).catch(error => {
    petLoads.delete(id);
    console.error('Failed to load desktop pet:', error);
    if (id !== activePetId) return;
    showUpdateToast('角色加载失败，已切回小黑猫', { autoHideMs: 4200 });
    void applySettingsPatch({ catBreed: 'black' });
  });
}

function renderBreedPills(): void {
  if (!breedPillsEl) return;
  breedPillsEl.innerHTML = '';
  for (const cat of catList) {
    const btn = document.createElement('button');
    btn.className = 'breed-pill';
    btn.dataset.breed = cat.id;
    const emoji = cat.emoji ? `${cat.emoji} ` : '🐱 ';
    btn.textContent = `${emoji}${cat.name}`;
    const accent = cat.accentColor || '#c8f538';
    btn.style.setProperty('--pill-accent', accent);
    btn.classList.toggle('active', cat.id === settings.catBreed);
    breedPillsEl.appendChild(btn);
  }
}

function updateScaleSliderVisual(scaleVal: number): void {
  const pctNum = Math.round(Math.max(20, Math.min(150, scaleVal * 100)));
  if (scaleSliderEl) {
    scaleSliderEl.value = String(pctNum);
    const fillPct = ((pctNum - 20) / (150 - 20)) * 100;
    scaleSliderEl.style.setProperty('--pct', `${fillPct.toFixed(1)}%`);
  }
  if (scaleValueEl) {
    scaleValueEl.textContent = `${pctNum}%`;
  }
}

function syncMenuUI(): void {
  const setCheck = (id: string, on: boolean) => {
    const el = document.getElementById(id);
    if (el) el.textContent = on ? '✓' : '';
  };
  setCheck('chk-bubbles', settings.showKeyBubbles);
  setCheck('chk-lock', settings.clickThroughLocked);
  setCheck('chk-sound', settings.soundEnabled);
  setCheck('chk-top', settings.alwaysOnTop);
  setCheck('chk-typing-follow', settings.followTyping);
  setCheck('chk-autostart', settings.autostart);
  setCheck('chk-mcp', settings.mcpEnabled);
  const weekdaySign = settings.weekdaySign ?? settings.catBreed === duorouId;
  setCheck('chk-weekday-sign', weekdaySign);
  setCheck('chk-scarf', settings.blueScarf);
  const theme = isKeyboardTheme(settings.keyboardTheme) ? settings.keyboardTheme : 'classic';
  menuEl.querySelectorAll<HTMLButtonElement>('[data-keyboard-theme]').forEach(btn => {
    const active = btn.dataset.keyboardTheme === theme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  if (!sliderDragging) {
    updateScaleSliderVisual(settings.scale);
  }

  const isDuorou = settings.catBreed === duorouId;
  const isGolden = settings.catBreed === goldenId;
  const compactOnly = isDuorou || isGolden;
  const hasWardrobe = supportsWardrobe(settings.catBreed);
  const skin = isPetSkin(settings.petSkin) ? settings.petSkin : settings.blueScarf ? 'classic' : 'plain';
  petSkinEl.hidden = !hasWardrobe;
  scarfButton.hidden = compactOnly || hasWardrobe;
  petSkinEl.querySelectorAll<HTMLButtonElement>('[data-pet-skin]').forEach(btn => {
    const active = btn.dataset.petSkin === skin;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const kbLayout: KeyboardLayoutId = !compactOnly && settings.keyboardLayout === '108' ? '108' : '65';
  const kbOrient: KeyboardOrientation = !isDuorou && settings.keyboardOrientation === 'viewer' ? 'viewer' : 'cat';
  keyboardLayoutEl.hidden = isDuorou;
  equipmentEl.querySelectorAll<HTMLButtonElement>('[data-pet-equipment]').forEach((btn) => {
    const active = (btn.dataset.petEquipment === '3d') === Boolean(settings.duorouEquipment3d);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-kblayout]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kblayout === kbLayout);
    btn.disabled = compactOnly;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-kborient]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kborient === kbOrient);
    btn.disabled = isDuorou;
  });

  const activeCat = catList.find((c) => c.id === settings.catBreed) ?? catList[0];
  renderBreedPills();

  const headerEl = document.getElementById('menu-header');
  if (headerEl && activeCat) {
    const emoji = activeCat.emoji || '🐱';
    headerEl.textContent = `${emoji} KuroCat ${activeCat.name}`;
    headerEl.style.color = activeCat.accentColor || '#c8f538';
  }

  engine.showKeyBubbles = settings.showKeyBubbles;
  engine.keyboardTheme = theme;
  engine.petDecorations = { weekdaySign, blueScarf: !compactOnly && !hasWardrobe && settings.blueScarf };
  engine.petSkin = hasWardrobe ? skin : 'plain';
  engine.setCatAppearance(compactOnly ? 'black' : activeCat?.id || 'black', compactOnly ? null : activeCat);
  const layoutChanged = engine.keyboardLayout !== kbLayout || engine.keyboardOrientation !== kbOrient;
  engine.setKeyboardConfig(kbLayout, kbOrient);
  if (layoutChanged) activePet?.reset();
  selectDesktopPet(settings.catBreed);
  syncPetEquipment();
  if (!sliderDragging) {
    engine.setRenderScale(settings.scale);
  }
  catAudio.setEnabled(settings.soundEnabled && settings.catBreed === 'black');
}

function closeContextMenu(): void {
  if (!menuEl.classList.contains('hidden')) {
    menuEl.classList.add('hidden');
    void invoke('set_menu_open', { open: false });
  }
}

function openContextMenu(clientX: number, clientY: number): void {
  syncMenuUI();
  menuEl.classList.remove('hidden');
  void invoke('set_menu_open', { open: true });

  const rect = menuEl.getBoundingClientRect();
  const maxX = Math.max(8, window.innerWidth - rect.width - 8);
  const maxY = Math.max(8, window.innerHeight - rect.height - 8);
  menuEl.style.left = `${Math.max(8, Math.min(clientX, maxX))}px`;
  menuEl.style.top = `${Math.max(8, Math.min(clientY, maxY))}px`;
}

async function applySettingsPatch(patch: Partial<AppSettings>): Promise<void> {
  settings = { ...settings, ...patch };
  syncMenuUI();
  settings = await invoke<AppSettings>('update_settings', { patch: settings });
  syncMenuUI();
}

async function copyMcpConfig(): Promise<void> {
  const hint = document.getElementById('mcp-copy-hint');
  try {
    const jsonText = await invoke<string>('get_mcp_config');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(jsonText);
    } else {
      const ta = document.createElement('textarea');
      ta.value = jsonText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (hint) {
      hint.textContent = '✓ 已复制';
      hint.classList.add('copied');
      setTimeout(() => {
        hint.textContent = '扩展接口';
        hint.classList.remove('copied');
      }, 1800);
    }
  } catch (err) {
    console.error('Failed to copy MCP config:', err);
  }
}

async function createDesktopShortcut(): Promise<void> {
  const hint = document.getElementById('shortcut-hint');
  try {
    await invoke<string>('create_desktop_shortcut');
    if (hint) {
      hint.textContent = '✓ 已创建';
      hint.classList.add('copied');
      setTimeout(() => {
        hint.textContent = 'KuroCat';
        hint.classList.remove('copied');
      }, 1800);
    }
  } catch (err) {
    console.error('Failed to create desktop shortcut:', err);
  }
}

function setUpdateHint(text: string, mode: 'default' | 'ready' | 'error' = 'default'): void {
  const hint = document.getElementById('update-hint');
  if (!hint) return;
  hint.textContent = text;
  hint.classList.remove('update-ready', 'update-error');
  if (mode === 'ready') hint.classList.add('update-ready');
  else if (mode === 'error') hint.classList.add('update-error');
}

function hideUpdateToast(): void {
  if (toastAutoHideTimer !== null) {
    window.clearTimeout(toastAutoHideTimer);
    toastAutoHideTimer = null;
  }
  if (!updateToastEl.classList.contains('hidden')) {
    updateToastEl.classList.add('hidden');
    void invoke('set_update_banner_open', { open: false });
  }
}

function showUpdateToast(
  text: string,
  options: { showInstall?: boolean; showOpen?: boolean; autoHideMs?: number; busy?: boolean } = {},
): void {
  if (toastAutoHideTimer !== null) {
    window.clearTimeout(toastAutoHideTimer);
    toastAutoHideTimer = null;
  }
  updateToastTextEl.textContent = text;
  btnToastInstallEl.classList.toggle('hidden', !options.showInstall);
  btnToastInstallEl.disabled = Boolean(options.busy);
  btnToastOpenEl.classList.toggle('hidden', !options.showOpen);
  updateToastEl.classList.remove('hidden');
  void invoke('set_update_banner_open', { open: true });

  if (options.autoHideMs && options.autoHideMs > 0) {
    toastAutoHideTimer = window.setTimeout(() => {
      hideUpdateToast();
    }, options.autoHideMs);
  }
}

function handleUpdateProgressEvent(ev: UpdateProgressEvent, fromManual = false): void {
  if (ev.info) {
    latestUpdateInfo = ev.info;
    appVersion = ev.info.currentVersion || appVersion;
  }

  switch (ev.stage) {
    case 'checking':
      updateBusy = true;
      setUpdateHint('检测中...');
      showUpdateToast('🔍 正在检查新版本...', { busy: true });
      break;
    case 'available':
      updateBusy = false;
      if (latestUpdateInfo?.hasUpdate) {
        const ver = latestUpdateInfo.latestVersion;
        setUpdateHint(`⬆ v${ver}`, 'ready');
        if (fromManual || dismissedVersion !== ver) {
          showUpdateToast(`✨ 发现新版本 v${ver}`, {
            showInstall: Boolean(latestUpdateInfo.downloadUrl),
            showOpen: !latestUpdateInfo.downloadUrl,
          });
        }
      }
      break;
    case 'up_to_date':
      updateBusy = false;
      setUpdateHint(`✓ v${appVersion}`);
      showUpdateToast(`✓ 已是最新版本 v${appVersion}`, { autoHideMs: 2600 });
      break;
    case 'downloading':
    case 'verifying':
    case 'installing':
      updateBusy = true;
      setUpdateHint('更新中...', 'ready');
      showUpdateToast(`⏳ ${ev.message}`, { busy: true });
      break;
    case 'error':
      updateBusy = false;
      setUpdateHint('检查失败', 'error');
      showUpdateToast(`⚠ ${ev.message}`, {
        showOpen: true,
        autoHideMs: 5200,
      });
      break;
  }
}

async function triggerInstallUpdate(): Promise<void> {
  if (updateBusy || !latestUpdateInfo || !latestUpdateInfo.hasUpdate) return;
  updateBusy = true;
  closeContextMenu();
  showUpdateToast(`⏳ 正在下载 v${latestUpdateInfo.latestVersion}...`, { busy: true });
  setUpdateHint('下载中...', 'ready');
  try {
    await invoke('install_update', { info: latestUpdateInfo });
  } catch (err) {
    updateBusy = false;
    const msg = typeof err === 'string' ? err : String(err);
    setUpdateHint('更新失败', 'error');
    showUpdateToast(`⚠ ${msg}`, { showOpen: true, autoHideMs: 6500 });
  }
}

async function triggerManualUpdateCheck(): Promise<void> {
  if (updateBusy) return;
  // If we already know an update is ready, clicking the menu item immediately starts installing it!
  if (latestUpdateInfo?.hasUpdate && latestUpdateInfo.downloadUrl) {
    await triggerInstallUpdate();
    return;
  }
  updateBusy = true;
  setUpdateHint('检测中...');
  closeContextMenu();
  showUpdateToast('🔍 正在检查新版本...', { busy: true });
  try {
    const info = await invoke<UpdateInfo>('check_for_update');
    handleUpdateProgressEvent(
      {
        stage: info.hasUpdate ? 'available' : 'up_to_date',
        message: info.hasUpdate
          ? `发现新版本 v${info.latestVersion}`
          : `已是最新版本 v${info.currentVersion}`,
        info,
      },
      true,
    );
  } catch (err) {
    const msg = typeof err === 'string' ? err : String(err);
    handleUpdateProgressEvent({ stage: 'error', message: msg, info: null }, true);
  }
}

const shortcutModifiers = new Set([0x5b, 0x5c, 0xa2, 0xa3]);
const heldShortcutModifiers = new Set<number>();
let typingProbeAfter = 0;
let typingTransition = false;
let landingKeys: number[] | null = null;

function isTypingKey(vk: number): boolean {
  return (vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)
    || (vk >= 0x60 && vk <= 0x6f) || (vk >= 0xba && vk <= 0xc0)
    || (vk >= 0xdb && vk <= 0xde) || vk === 0x20 || vk === 0x08;
}

function canFollowTyping(): boolean {
  return isMac && settings.followTyping && heldShortcutModifiers.size === 0
    && menuEl.classList.contains('hidden') && updateToastEl.classList.contains('hidden')
    && !canvas.classList.contains('pet-dragging');
}

async function followTyping(vk: number): Promise<void> {
  const now = performance.now();
  if (!isTypingKey(vk) || !canFollowTyping() || typingTransition || now < typingProbeAfter) return;
  typingProbeAfter = now + 300;
  typingTransition = true;
  const breed = settings.catBreed;
  const layout = engine.keyboardLayout;
  const keys = [vk];
  landingKeys = isLandingBreed(breed) ? keys : null;
  let fadeOut: Animation | undefined;
  let fadeIn: Animation | undefined;
  try {
    if (!await invoke<boolean>('typing_follow_target', { moveWindow: false }) || !canFollowTyping()) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      await invoke('typing_follow_target', { moveWindow: true });
      return;
    }
    const prepared = isLandingBreed(breed) ? loadLandingAtlas(breed, layout).catch(error => {
      console.debug('Could not load landing animation:', error);
      return null;
    }) : null;
    fadeOut = canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: 'forwards' });
    await fadeOut.finished;
    const moved = canFollowTyping() && await invoke<boolean>('typing_follow_target', { moveWindow: true });
    const atlas = moved && await prepared;
    const valid = () => settings.followTyping && settings.catBreed === breed
      && engine.keyboardLayout === layout && !canvas.classList.contains('pet-dragging');
    if (atlas && isLandingBreed(breed) && valid()) {
      const reveal = () => fadeOut?.cancel();
      await new Promise<void>(done => {
        engine.setLandingPainter(createLandingPainter(engine, atlas, breed, keys, valid, reveal, done));
      });
      return;
    }
    fadeIn = canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
    fadeOut.cancel();
    await fadeIn.finished;
  } catch (error) {
    console.debug('Could not follow active input:', error);
  } finally {
    landingKeys = null;
    fadeOut?.cancel();
    fadeIn?.cancel();
    typingTransition = false;
  }
}

async function bootstrap(): Promise<void> {
  engine.start();

  // Hide Windows-only desktop shortcut button on macOS
  if (isMac) {
    typingFollowButton.hidden = false;
    menuEl.querySelector('[data-action="toggle-top"] > span')!.textContent = '始终置顶（含全屏）';
    const shortcutBtn = document.getElementById('btn-desktop-shortcut');
    if (shortcutBtn) shortcutBtn.style.display = 'none';
  }

  try {
    const [loadedSettings, loadedCats, loadedVer] = await Promise.all([
      invoke<AppSettings>('get_settings'),
      invoke<CatSkinConfig[]>('get_cats'),
      invoke<string>('get_app_version'),
    ]);
    settings = loadedSettings;
    lastKnownLockState = settings.clickThroughLocked;
    if (Array.isArray(loadedCats) && loadedCats.length > 0) {
      catList = loadedCats;
    }
    if (loadedVer) {
      appVersion = loadedVer;
      setUpdateHint(`v${appVersion}`);
    }
    syncMenuUI();
  } catch (err) {
    console.error('Failed to load settings or cats:', err);
  }

  await listen<UpdateProgressEvent>('kuro-update-status', (ev) => {
    handleUpdateProgressEvent(ev.payload, false);
  });

  btnToastInstallEl.addEventListener('click', (e) => {
    e.stopPropagation();
    void triggerInstallUpdate();
  });

  btnToastOpenEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const url = latestUpdateInfo?.releaseUrl || 'https://github.com/xiao97m-collab/kurocat/releases/latest';
    void invoke('open_release_page', { url });
  });

  btnToastCloseEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (latestUpdateInfo?.hasUpdate) {
      dismissedVersion = latestUpdateInfo.latestVersion;
    }
    hideUpdateToast();
  });

  if (scaleSliderEl) {
    scaleSliderEl.addEventListener('pointerdown', () => {
      sliderDragging = true;
    });
    scaleSliderEl.addEventListener('input', () => {
      sliderDragging = true;
      const nextScale = Math.max(0.2, Math.min(1.5, Number(scaleSliderEl.value) / 100));
      updateScaleSliderVisual(nextScale);
      engine.setRenderScale(nextScale);
    });
    const commitSliderScale = () => {
      sliderDragging = false;
      const nextScale = Math.max(0.2, Math.min(1.5, Number(scaleSliderEl.value) / 100));
      void applySettingsPatch({ scale: nextScale });
    };
    scaleSliderEl.addEventListener('change', commitSliderScale);
    scaleSliderEl.addEventListener('pointerup', () => {
      sliderDragging = false;
    });
  }

  if (scaleValueEl) {
    scaleValueEl.addEventListener('click', (e) => {
      e.stopPropagation();
      sliderDragging = false;
      updateScaleSliderVisual(1.0);
      void applySettingsPatch({ scale: 1.0 });
    });
  }

  await listen<AppSettings>('kuro-settings', (ev) => {
    const prevLock = lastKnownLockState;
    settings = ev.payload;
    lastKnownLockState = settings.clickThroughLocked;
    syncMenuUI();
    if (prevLock !== null && prevLock !== settings.clickThroughLocked) {
      if (settings.clickThroughLocked) {
        showUpdateToast('🔒 已锁定穿透（按住 Alt 点击或 ^ 托盘解锁）', { autoHideMs: 4200 });
      } else {
        showUpdateToast('🔓 已解除穿透，可直接拖动或右键', { autoHideMs: 2200 });
      }
    }
  });

  await listen<CatSkinConfig[]>('kuro-cats', (ev) => {
    if (Array.isArray(ev.payload) && ev.payload.length > 0) {
      catList = ev.payload;
      syncMenuUI();
    }
  });

  await listen<InputEvent>('kuro-input', (ev) => {
    const p = ev.payload;
    switch (p.kind) {
      case 'keyDown':
        engine.onKeyDown(p.vk, p.repeat);
        activePet?.keyDown(p.vk, p.repeat, performance.now());
        if (shortcutModifiers.has(p.vk)) heldShortcutModifiers.add(p.vk);
        else if (!p.repeat && isTypingKey(p.vk)) {
          if (landingKeys && canFollowTyping() && landingKeys.length < 40) landingKeys.push(p.vk);
          else void followTyping(p.vk);
        }
        break;
      case 'keyUp':
        engine.onKeyUp(p.vk);
        heldShortcutModifiers.delete(p.vk);
        break;
      case 'mouseMove':
        if (activePet && 'mouseMove' in activePet) {
          activePet.mouseMove(p.nx, p.ny, p.x, p.y, performance.now());
        } else if (engine.onGlobalMouseMove(p.nx, p.ny, p.x, p.y)) {
          activePet?.mouseActivity(performance.now());
        }
        break;
      case 'mouseDown':
        engine.onMouseDown(p.button);
        activePet?.mouseActivity(performance.now(), p.button, true);
        break;
      case 'mouseUp':
        engine.onMouseUp(p.button);
        activePet?.mouseActivity(performance.now(), p.button, false);
        break;
      case 'mouseWheel':
        engine.onMouseWheel();
        activePet?.mouseActivity(performance.now());
        break;
    }
  });

  await listen<WindowCursorInfo>('kuro-cursor', (ev) => {
    const c = ev.payload;
    altOverride = Boolean(c.altOverride);
    engine.onWindowCursor(c.relX, c.relY, c.overCat);
    activePet?.cursor(c.relX, c.relY, c.insideWindow, performance.now(), c.overCat);
    const interactive = !settings.clickThroughLocked || altOverride;
    canvas.classList.toggle('pet-hover', c.overCat && interactive);
  });

  // Left-click drag to reposition transparent window
  canvas.addEventListener('mousedown', async (e) => {
    if (e.button === 0) {
      closeContextMenu();
      if (settings.clickThroughLocked && !altOverride && !e.altKey) return;
      canvas.classList.add('pet-dragging');
      void invoke('set_dragging', { dragging: true });
      try {
        await getCurrentWindow().startDragging();
      } finally {
        canvas.classList.remove('pet-dragging');
        void invoke('set_dragging', { dragging: false });
        void invoke('save_window_pos');
      }
    }
  });

  // Right-click opens sleek dark glass settings menu
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (settings.clickThroughLocked && !altOverride && !e.altKey) return;
    openContextMenu(e.clientX, e.clientY);
  });

  window.addEventListener('blur', () => closeContextMenu());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContextMenu();
  });

  menuEl.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-action], [data-scale], [data-breed], [data-kblayout], [data-kborient], [data-pet-equipment], [data-keyboard-theme], [data-pet-skin]',
    );
    if (!target) return;

    const equipment = target.dataset.petEquipment;
    if (equipment === '2d' || equipment === '3d') {
      void applySettingsPatch({ duorouEquipment3d: equipment === '3d' });
      closeContextMenu();
      return;
    }

    const skin = target.dataset.petSkin;
    if (supportsWardrobe(settings.catBreed) && isPetSkin(skin)) {
      void applySettingsPatch({ petSkin: skin });
      return;
    }

    const theme = target.dataset.keyboardTheme;
    if (isKeyboardTheme(theme)) {
      void applySettingsPatch({ keyboardTheme: theme });
      return;
    }

    const kbLayoutAttr = target.dataset.kblayout;
    if (kbLayoutAttr === '65' || kbLayoutAttr === '108') {
      void applySettingsPatch({ keyboardLayout: kbLayoutAttr });
      closeContextMenu();
      return;
    }

    const kbOrientAttr = target.dataset.kborient;
    if (kbOrientAttr === 'cat' || kbOrientAttr === 'viewer') {
      void applySettingsPatch({ keyboardOrientation: kbOrientAttr });
      closeContextMenu();
      return;
    }

    const breedAttr = target.dataset.breed;
    if (breedAttr) {
      void applySettingsPatch({ catBreed: breedAttr });
      closeContextMenu();
      return;
    }

    const scaleAttr = target.dataset.scale;
    if (scaleAttr) {
      void applySettingsPatch({ scale: Number(scaleAttr) });
      closeContextMenu();
      return;
    }

    switch (target.dataset.action) {
      case 'toggle-weekday-sign':
        void applySettingsPatch({ weekdaySign: !(settings.weekdaySign ?? settings.catBreed === duorouId) });
        break;
      case 'toggle-scarf':
        void applySettingsPatch({ blueScarf: !settings.blueScarf });
        break;
      case 'toggle-bubbles':
        void applySettingsPatch({ showKeyBubbles: !settings.showKeyBubbles });
        break;
      case 'toggle-lock':
        void applySettingsPatch({ clickThroughLocked: !settings.clickThroughLocked });
        closeContextMenu();
        break;
      case 'toggle-sound':
        void applySettingsPatch({ soundEnabled: !settings.soundEnabled });
        break;
      case 'toggle-top':
        void applySettingsPatch({ alwaysOnTop: !settings.alwaysOnTop });
        break;
      case 'toggle-typing-follow':
        void applySettingsPatch({ followTyping: !settings.followTyping });
        closeContextMenu();
        break;
      case 'toggle-autostart':
        void applySettingsPatch({ autostart: !settings.autostart });
        break;
      case 'toggle-mcp':
        void applySettingsPatch({ mcpEnabled: !settings.mcpEnabled });
        break;
      case 'copy-mcp':
        void copyMcpConfig();
        break;
      case 'desktop-shortcut':
        void createDesktopShortcut();
        break;
      case 'check-update':
        void triggerManualUpdateCheck();
        break;
      case 'reset-pos':
        void invoke('reset_position');
        closeContextMenu();
        break;
      case 'quit':
        void invoke('quit_app');
        break;
    }
  });
}

void bootstrap();
