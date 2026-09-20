import { Container } from 'pixi.js';
import type { ViewportState, VisibleBounds, PixiCanvasConfig } from './types';
import { DEFAULT_PIXI_CANVAS_CONFIG } from './types';

/**
 * 视口/相机管理。
 * 维护一个 world Container，通过修改其 transform（position + scale）
 * 实现 pan/zoom。所有节点/边/网格作为 world 的子节点。
 *
 * 职责：
 * - 管理 world.x, world.y, world.scale（pan/zoom 状态）
 * - 提供 screenToWorld / worldToScreen 坐标转换
 * - 计算当前可见区域边界（供 culling 使用）
 * - 缩放时间向光标点（保持用户焦点不变）
 * - 约束 zoom 在 [minZoom, maxZoom] 区间
 */
export class PixiViewport {
  readonly world: Container;
  readonly config: PixiCanvasConfig;

  private _screenWidth = 1;
  private _screenHeight = 1;
  private _zoom = 1;
  private _targetZoom = 1;
  private _targetX = 0;
  private _targetY = 0;

  /** 每帧 lerp 速率（0-1，越大越快）。不使用动画时设为 1 */
  private _lerpRate = 1;

  constructor(config?: Partial<PixiCanvasConfig>) {
    this.config = { ...DEFAULT_PIXI_CANVAS_CONFIG, ...config };
    this.world = new Container();
    this.world.sortableChildren = true;
    this.world.label = 'viewport-world';
  }

  // ---- 尺寸 ----

  get screenWidth() {
    return this._screenWidth;
  }
  get screenHeight() {
    return this._screenHeight;
  }

  /** 调用放 resizer 通知视口尺寸变化 */
  resize(width: number, height: number): void {
    this._screenWidth = width;
    this._screenHeight = height;
  }

  // ---- zoom ----

  get zoom() {
    return this._zoom;
  }

  /** 实时缩放到目标值（立即设置，无动画） */
  setZoom(value: number): void {
    this._zoom = this._clampZoom(value);
    this._targetZoom = this._zoom;
    this.world.scale.set(this._zoom);
  }

  /** 以屏幕坐标 (sx, sy) 为中心缩放到目标值（保持该屏幕点不动） */
  zoomAt(screenX: number, screenY: number, targetZoom: number, animate = false): void {
    const oldZoom = this._zoom;
    const newZoom = this._clampZoom(targetZoom);

    // 计算 world 坐标平移以保持 (screenX, screenY) 处内容不动
    const worldX = (this.world.x - screenX) / oldZoom;
    const worldY = (this.world.y - screenY) / oldZoom;

    const newWorldX = screenX + worldX * newZoom;
    const newWorldY = screenY + worldY * newZoom;

    if (animate) {
      this._targetX = newWorldX;
      this._targetY = newWorldY;
      this._targetZoom = newZoom;
      this._lerpRate = 0.18;
    } else {
      this._zoom = newZoom;
      this._targetZoom = newZoom;
      this.world.x = newWorldX;
      this.world.y = newWorldY;
      this._targetX = newWorldX;
      this._targetY = newWorldY;
      this.world.scale.set(newZoom);
      this._lerpRate = 1;
    }
  }

  /** 滚轮缩放：以鼠标位置为中心 */
  zoomByWheel(screenX: number, screenY: number, deltaY: number): void {
    const factor = deltaY > 0 ? 0.92 : 1.08;
    const newZoom = this._clampZoom(this._zoom * factor);
    this.zoomAt(screenX, screenY, newZoom, false);
  }

  // ---- pan ----

  /** 平移视口（增量，屏幕像素） */
  panBy(dx: number, dy: number): void {
    this.world.x += dx;
    this.world.y += dy;
    this._targetX = this.world.x;
    this._targetY = this.world.y;
  }

  /** 设置绝对视口位置 */
  setPosition(x: number, y: number): void {
    this.world.x = x;
    this.world.y = y;
    this._targetX = x;
    this._targetY = y;
  }

  /** 居中显示世界坐标区域 */
  fitBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    padding = 0.15,
  ): void {
    if (this._screenWidth <= 0 || this._screenHeight <= 0) return;

    const boundsW = maxX - minX;
    const boundsH = maxY - minY;
    if (boundsW <= 0 || boundsH <= 0) return;

    const padW = boundsW * padding;
    const padH = boundsH * padding;

    const availableW = this._screenWidth;
    const availableH = this._screenHeight;

    const scaleX = availableW / (boundsW + padW * 2);
    const scaleY = availableH / (boundsH + padH * 2);
    const newZoom = this._clampZoom(Math.min(scaleX, scaleY));

    const centerX = minX + boundsW / 2;
    const centerY = minY + boundsH / 2;

    this._zoom = newZoom;
    this._targetZoom = newZoom;
    this.world.scale.set(newZoom);
    this.world.x = this._screenWidth / 2 - centerX * newZoom;
    this.world.y = this._screenHeight / 2 - centerY * newZoom;
    this._targetX = this.world.x;
    this._targetY = this.world.y;
    this._lerpRate = 1;
  }

  // ---- 可见区域 ----

  getVisibleBounds(): VisibleBounds {
    const z = this._zoom;
    const pad = this.config.viewportPadding;
    const minX = -this.world.x / z - pad;
    const minY = -this.world.y / z - pad;
    const maxX = (this._screenWidth - this.world.x) / z + pad;
    const maxY = (this._screenHeight - this.world.y) / z + pad;
    return { minX, minY, maxX, maxY };
  }

  /** 判断世界坐标中的矩形的可见性 */
  isRectVisible(x: number, y: number, w: number, h: number): boolean {
    const b = this.getVisibleBounds();
    return !(x + w < b.minX || x > b.maxX || y + h < b.minY || y > b.maxY);
  }

  // ---- 坐标转换 ----

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const z = this._zoom;
    return {
      x: (sx - this.world.x) / z,
      y: (sy - this.world.y) / z,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const z = this._zoom;
    return {
      x: wx * z + this.world.x,
      y: wy * z + this.world.y,
    };
  }

  // ---- 每帧更新（lerp 平滑） ----

  tick(): void {
    if (this._lerpRate >= 1) return;

    const r = this._lerpRate;
    this.world.x += (this._targetX - this.world.x) * r;
    this.world.y += (this._targetY - this.world.y) * r;
    this._zoom += (this._targetZoom - this._zoom) * r;
    this.world.scale.set(this._zoom);

    // 接近目标时 snap 到位
    const dx = Math.abs(this._targetX - this.world.x);
    const dy = Math.abs(this._targetY - this.world.y);
    const dz = Math.abs(this._targetZoom - this._zoom);
    if (dx < 0.05 && dy < 0.05 && dz < 0.0005) {
      this.world.x = this._targetX;
      this.world.y = this._targetY;
      this._zoom = this._targetZoom;
      this.world.scale.set(this._zoom);
      this._lerpRate = 1;
    }
  }

  /** 设置 lerp 速率（0-1）。1 表示无动画 */
  setLerpRate(rate: number): void {
    this._lerpRate = Math.max(0, Math.min(1, rate));
  }

  get isAnimating(): boolean {
    return this._lerpRate < 1;
  }

  // ---- private ----

  private _clampZoom(z: number): number {
    return Math.max(this.config.minZoom, Math.min(this.config.maxZoom, z));
  }
}
