import { type Camera, OrthographicCamera, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import type { KeyboardLayoutId } from '../../keyboardLayout';
import type { KeyboardOrientation } from '../../catEngine';
import { KeyboardAndMouse3D } from './keyboard3d';

const renderWidth = 472;
const renderHeight = 168;
const pixelsPerUnit = 112;
const pixelRatio = 2;
const vertical = 4.7 / Math.hypot(4.7, 4.3);
const horizontal = 4.3 / Math.hypot(4.7, 4.3);

function createLayer<C extends Camera>(camera: C, width: number, height: number) {
  const image = document.createElement('canvas');
  image.width = width * pixelRatio;
  image.height = height * pixelRatio;
  return { camera, image, ctx: image.getContext('2d')!, width, height };
}

/** Draw the 3D equipment in the same canvas coordinates as the 2D paw targets. */
export class PetEquipment3D {
  private readonly scene = new Scene();
  private readonly renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  private readonly desk = new KeyboardAndMouse3D(this.scene);
  private readonly keyboard = createLayer(new PerspectiveCamera(), renderWidth, renderHeight);
  private readonly mouse = createLayer(
    new OrthographicCamera(-renderWidth / (2 * pixelsPerUnit), renderWidth / (2 * pixelsPerUnit),
      renderHeight / (2 * pixelsPerUnit), -renderHeight / (2 * pixelsPerUnit), 0.1, 20),
    90, 94,
  );
  private gridWidth = 0;
  private gridHeight = 0;
  private keyboardOffsetY = 0;
  private mouseScaleX = 1;
  private mouseScaleY = 1;
  private mouseOffsetX = 0;
  private mouseOffsetY = 0;
  private lastTime: number | null = null;
  private keyboardAnimation = 0;
  private mouseAnimation = 0;
  private leftDown = false;
  private rightDown = false;
  private scrollFlash = 0;

  constructor() {
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(renderWidth, renderHeight, false);
    // The pet canvas already provides the keyboard's in-plane rotation.
    this.desk.boardGroup.rotation.set(0, 0, 0);
  }

  isAvailable(): boolean {
    return !this.renderer.getContext().isContextLost();
  }

  configure(layout: KeyboardLayoutId, orientation: KeyboardOrientation, gridWidth: number, gridHeight: number,
    backScale: number, taper: number, mouseWidth: number, mouseHeight: number): void {
    if (this.gridWidth === gridWidth && this.gridHeight === gridHeight &&
        this.desk.getLayoutId() === layout && this.desk.getOrientation() === orientation) return;

    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.desk.rebuildBoard(layout, orientation);

    const grid = this.desk.keyGrid();
    const camera = this.keyboard.camera;
    // Match the 2D key-top plane's top-to-bottom widening.
    const middleScale = backScale + taper / 2;
    const halfSpread = taper / (2 * middleScale);
    const distance = horizontal * grid.length / (2 * halfSpread);
    const fitX = gridWidth * middleScale / grid.width;
    const fitY = gridHeight * (1 - halfSpread ** 2) / (grid.length * vertical);
    const focal = 2 * fitY * distance / renderHeight;
    camera.fov = 2 * Math.atan(1 / focal) * 180 / Math.PI;
    camera.aspect = focal * renderWidth / (2 * fitX * distance);
    camera.position.copy(grid.center).add(new Vector3(0, distance * vertical, distance * horizontal));
    camera.lookAt(grid.center);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    this.keyboardOffsetY = -gridHeight * halfSpread / 2;

    const mouseCamera = this.mouse.camera;
    const center = this.desk.mouseGroup.getWorldPosition(new Vector3());
    center.y += .06;
    mouseCamera.position.copy(center).add(new Vector3(0, 4.7, 4.3));
    mouseCamera.lookAt(center);
    mouseCamera.updateMatrixWorld();
    const outline = this.desk.mouseShellBounds(mouseCamera);
    const size = outline.getSize(new Vector2());
    const mid = outline.getCenter(new Vector2());
    this.mouseScaleX = mouseWidth / (size.x * renderWidth / 2);
    this.mouseScaleY = mouseHeight / (size.y * renderHeight / 2);
    this.mouseOffsetX = -mid.x * renderWidth / 2 * this.mouseScaleX;
    this.mouseOffsetY = mid.y * renderHeight / 2 * this.mouseScaleY;
    this.keyboardAnimation = 1;
    this.mouseAnimation = .4;
    this.lastTime = null;
  }

  update(now: number, keys: ReadonlyMap<string, { pressAmount: number }>, left: boolean, right: boolean, scroll: number,
    tailKey?: string, tailPressure = 0): void {
    if (now === this.lastTime) return;
    const dt = this.lastTime === null ? 1 / 60 : Math.max(0, Math.min(0.034, (now - this.lastTime) / 1000));
    this.lastTime = now;

    for (const [id, animation] of keys) {
      const key = this.desk.getKeyById(id);
      const down = Math.max(animation.pressAmount, id === tailKey ? tailPressure : 0) > .5;
      if (key && key.down !== down) {
        this.desk.setKeyDown(id, down);
        this.keyboardAnimation = 1;
      }
    }

    if (scroll > this.scrollFlash) {
      this.desk.pulseScrollWheel();
      this.mouseAnimation = .4;
    }
    if (left !== this.leftDown || right !== this.rightDown) this.mouseAnimation = .4;
    this.leftDown = left;
    this.rightDown = right;
    this.scrollFlash = scroll;

    this.desk.update(dt, left, right, 0, 0);
    if (this.keyboardAnimation > 0) {
      this.desk.boardGroup.visible = true;
      this.desk.mouseGroup.visible = false;
      this.renderLayer(this.keyboard);
      this.keyboardAnimation -= dt;
    }
    if (this.mouseAnimation > 0) {
      this.desk.boardGroup.visible = false;
      this.desk.mouseGroup.visible = true;
      this.renderLayer(this.mouse);
      this.mouseAnimation -= dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, item: 'keyboard' | 'mouse'): void {
    const { image, width, height } = this[item];
    if (item === 'keyboard') {
      ctx.drawImage(image, -width / 2, this.keyboardOffsetY - height / 2, width, height);
    } else {
      const w = width * this.mouseScaleX;
      const h = height * this.mouseScaleY;
      ctx.drawImage(image, this.mouseOffsetX - w / 2, this.mouseOffsetY - h / 2, w, h);
    }
  }

  private renderLayer(layer: { camera: Camera; image: HTMLCanvasElement; ctx: CanvasRenderingContext2D }): void {
    this.renderer.render(this.scene, layer.camera);
    const { ctx, image } = layer;
    const { width, height } = image;
    const x = (this.renderer.domElement.width - width) / 2;
    const y = (this.renderer.domElement.height - height) / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.renderer.domElement, x, y, width, height, 0, 0, width, height);
  }
}
