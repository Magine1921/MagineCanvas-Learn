import { Container, Graphics } from 'pixi.js';
import type { PixiCanvasConfig } from './types';
import { DEFAULT_PIXI_CANVAS_CONFIG } from './types';

/**
 * 背景网格渲染器。
 *
 * AI-CanvasPro 风格：极淡的等距网格线提供空间参考。
 * 性能说明：网格是一次性绘制的静态 Graphics，之后不参与每帧更新。
 * 仅当画布世界范围变化时重建。
 */
export class PixiGridRenderer {
  private _graphics: Graphics;
  private _config: PixiCanvasConfig;
  private _canvasWidth = 4000;
  private _canvasHeight = 3000;
  private _built = false;

  constructor(config?: Partial<PixiCanvasConfig>) {
    this._config = { ...DEFAULT_PIXI_CANVAS_CONFIG, ...config };
    this._graphics = new Graphics();
    this._graphics.zIndex = -10;
    this._graphics.label = 'grid';
  }

  attach(parent: Container): void {
    parent.addChild(this._graphics);
  }

  /** 设置画布世界范围并重建网格 */
  setCanvasSize(width: number, height: number): void {
    if (this._built && this._canvasWidth === width && this._canvasHeight === height) return;
    this._canvasWidth = width;
    this._canvasHeight = height;
    this._build();
  }

  /** 强制重建网格 */
  rebuild(): void {
    this._built = false;
    this._build();
  }

  destroy(): void {
    this._graphics.destroy();
  }

  // ---- private ----

  private _build(): void {
    const g = this._graphics;
    g.clear();
    const step = this._config.gridSize;
    const cw = this._canvasWidth;
    const ch = this._canvasHeight;
    const alpha = 0.06;

    // 竖线
    for (let x = 0; x <= cw; x += step) {
      g.moveTo(x, 0);
      g.lineTo(x, ch);
    }
    // 横线
    for (let y = 0; y <= ch; y += step) {
      g.moveTo(0, y);
      g.lineTo(cw, y);
    }

    g.stroke({ width: 1, color: this._config.gridColor, alpha });
    this._built = true;
  }
}
