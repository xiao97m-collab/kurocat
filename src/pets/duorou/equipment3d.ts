import { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { KeyboardAndMouse3D } from './keyboard3d';

const renderWidth = 310;
const renderHeight = 116;
const pixelsPerUnit = 112;
const pixelRatio = 2;

function createLayer(width: number, height: number, x: number, y: number, z: number) {
  const halfWidth = renderWidth / (2 * pixelsPerUnit);
  const halfHeight = renderHeight / (2 * pixelsPerUnit);
  const camera = new OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 20);
  camera.position.set(x, y + 4.7, z + 4.3);
  camera.lookAt(x, y, z);
  camera.updateMatrixWorld();

  const image = document.createElement('canvas');
  image.width = width * pixelRatio;
  image.height = height * pixelRatio;
  return { camera, image, ctx: image.getContext('2d')!, width, height };
}

/** Draw the original 3D models into the existing body → equipment → paw layers. */
export class DuorouEquipment3D {
  private readonly scene = new Scene();
  private readonly renderer = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  private readonly desk = new KeyboardAndMouse3D(this.scene);
  private readonly keyboard = createLayer(renderWidth, renderHeight, 0.24, 0.191, 1.08);
  private readonly mouse = createLayer(76, 76, -1.16, 0.077, 0.96);
  private lastTime: number | null = null;
  private keyboardAnimation = 0.02;
  private mouseAnimation = 0.02;
  private leftDown = false;
  private rightDown = false;
  private scrollFlash = 0;

  constructor() {
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(renderWidth, renderHeight, false);
    // The Canvas transform already applies the tilt used by 多肉's paw atlas.
    this.desk.boardGroup.rotation.set(0, 0, 0);
  }

  isAvailable(): boolean {
    return !this.renderer.getContext().isContextLost();
  }

  update(now: number, keys: ReadonlyMap<string, { pressAmount: number }>, left: boolean, right: boolean, scroll: number): void {
    const dt = this.lastTime === null ? 1 / 60 : Math.min(0.034, (now - this.lastTime) / 1000);
    this.lastTime = now;

    for (const [id, animation] of keys) {
      const key = this.desk.getKeyById(id);
      const down = animation.pressAmount > 0.5;
      if (key && key.down !== down) {
        this.desk.setKeyDown(id, down);
        this.keyboardAnimation = 1;
      }
    }

    if (scroll > this.scrollFlash) {
      this.desk.pulseScrollWheel();
      this.mouseAnimation = 0.4;
    }
    if (left !== this.leftDown || right !== this.rightDown) this.mouseAnimation = 0.4;
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
    const heightScale = item === 'mouse' ? 1.12 : 1;
    ctx.drawImage(image, -width / 2, -height * heightScale / 2, width, height * heightScale);
  }

  private renderLayer(layer: ReturnType<typeof createLayer>): void {
    this.renderer.render(this.scene, layer.camera);
    const { ctx, image } = layer;
    const { width, height } = image;
    const x = (this.renderer.domElement.width - width) / 2;
    const y = (this.renderer.domElement.height - height) / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.renderer.domElement, x, y, width, height, 0, 0, width, height);
  }
}
