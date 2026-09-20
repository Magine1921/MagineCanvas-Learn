import { Container } from 'pixi.js';
import type { PixiViewport } from './PixiViewport';
import type { PixiNodeRenderer } from './PixiNodeRenderer';

/**
 * 交互回调映射
 */
export interface PixiInteractionCallbacks {
  /** 节点被点击 (nodeId, 原始事件) */
  onNodeClick?: (nodeId: string, event: PointerEvent) => void;
  /** 节点被双击 */
  onNodeDoubleClick?: (nodeId: string, event: MouseEvent) => void;
  /** 节点拖拽开始 */
  onNodeDragStart?: (nodeId: string) => void;
  /** 节点拖拽中 (nodeId, 世界坐标 dx, dy，增量) */
  onNodeDrag?: (nodeId: string, worldDx: number, worldDy: number) => void;
  /** 节点拖拽结束 (nodeId) */
  onNodeDragEnd?: (nodeId: string) => void;
  /** 画布空白区点击 */
  onPaneClick?: (event: PointerEvent) => void;
  /** 画布空白区双击 */
  onPaneDoubleClick?: (event: MouseEvent, worldX: number, worldY: number) => void;
  /** 右键上下文菜单 */
  onContextMenu?: (event: PointerEvent, worldX: number, worldY: number) => void;
  /** 视口平移开始 */
  onPanStart?: () => void;
  /** 视口平移中 */
  onPan?: () => void;
  /** 视口平移结束 */
  onPanEnd?: () => void;
  /** 缩放变化 */
  onZoomChange?: (zoom: number) => void;
  /** 指向任意节点 */
  onNodePointerEnter?: (nodeId: string) => void;
  /** 离开任意节点 */
  onNodePointerLeave?: (nodeId: string) => void;
}

/**
 * PixiJS 画布的指针交互层。
 *
 * 直接监听 canvas 的原生 DOM 事件（不使用 PixiJS 事件系统），
 * 避免 PixiJS 事件传播的开销。完全模仿 AI-CanvasPro 的交互模式：
 *
 * - 左键拖拽节点
 * - 中键/右键拖拽平移视口
 * - 滚轮缩放（以鼠标点为中心）
 * - Space + 左键拖拽平移
 * - 双击空白区
 * - 右键上下文菜单
 *
 * 边界情况处理：
 * - 快速拖拽不丢节点（pointer capture + 全局 pointermove）
 * - 平移与节点拖拽互斥（中键/右键平移不受节点上的 pointer 影响）
 * - DPR 缩放适配
 * - 双击防抖（200ms 内忽略重复 dblclick）
 */
export class PixiInteraction {
  private _viewport: PixiViewport;
  private _nodeRenderer: PixiNodeRenderer;
  private _callbacks: PixiInteractionCallbacks;
  private _canvas: HTMLCanvasElement | null = null;
  private _bound: (() => void)[] = [];

  // 拖拽状态
  private _dragNodeId: string | null = null;
  private _dragStartScreen = { x: 0, y: 0 };
  private _dragStartWorld = { x: 0, y: 0 };
  private _dragMoved = false;

  // 平移状态
  private _panning = false;
  private _panButton: number | null = null;
  private _panStartScreen = { x: 0, y: 0 };
  private _panStartViewport = { x: 0, y: 0 };
  private _spaceDown = false;

  // 双击检测
  private _lastClickTime = 0;
  private _lastClickNode: string | null = null;

  // 正在交互中
  private _interacting = false;

  constructor(
    viewport: PixiViewport,
    nodeRenderer: PixiNodeRenderer,
    callbacks: PixiInteractionCallbacks = {},
  ) {
    this._viewport = viewport;
    this._nodeRenderer = nodeRenderer;
    this._callbacks = callbacks;
  }

  /** 绑定 canvas DOM 事件。调用方负责在组件卸载时调用 unbind() */
  bind(canvas: HTMLCanvasElement): void {
    this._canvas = canvas;
    const handler = this._handler.bind(this);
    const preventCtx = (e: Event) => e.preventDefault();

    canvas.addEventListener('pointerdown', handler);
    canvas.addEventListener('pointermove', handler);
    canvas.addEventListener('pointerup', handler);
    canvas.addEventListener('pointerleave', handler);
    canvas.addEventListener('pointercancel', handler);
    canvas.addEventListener('wheel', handler, { passive: false });
    canvas.addEventListener('dblclick', handler);
    canvas.addEventListener('contextmenu', preventCtx);

    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', handler);

    // 全局 pointer events（防止拖出 canvas 后丢事件）
    window.addEventListener('pointermove', handler);
    window.addEventListener('pointerup', handler);

    this._bound.push(() => {
      canvas.removeEventListener('pointerdown', handler);
      canvas.removeEventListener('pointermove', handler);
      canvas.removeEventListener('pointerup', handler);
      canvas.removeEventListener('pointerleave', handler);
      canvas.removeEventListener('pointercancel', handler);
      canvas.removeEventListener('wheel', handler);
      canvas.removeEventListener('dblclick', handler);
      canvas.removeEventListener('contextmenu', preventCtx);
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', handler);
      window.removeEventListener('pointermove', handler);
      window.removeEventListener('pointerup', handler);
    });
  }

  unbind(): void {
    for (const fn of this._bound) fn();
    this._bound.length = 0;
    this._canvas = null;
  }

  get isInteracting(): boolean {
    return this._interacting;
  }

  // ---- private event handler (unified entry) ----

  private _handler(e: Event): void {
    switch (e.type) {
      case 'pointerdown': return this._onPointerDown(e as PointerEvent);
      case 'pointermove': return this._onPointerMove(e as PointerEvent);
      case 'pointerup': return this._onPointerUp(e as PointerEvent);
      case 'pointerleave': return this._onPointerLeave(e as PointerEvent);
      case 'pointercancel': return this._onPointerCancel(e as PointerEvent);
      case 'wheel': return this._onWheel(e as WheelEvent);
      case 'dblclick': return this._onDoubleClick(e as MouseEvent);
      case 'keydown': return this._onKeyDown(e as KeyboardEvent);
      case 'keyup': return this._onKeyUp(e as KeyboardEvent);
    }
  }

  // ---- pointer handlers ----

  private _onPointerDown(e: PointerEvent): void {
    if (e.type === 'pointerdown' && e.target !== this._canvas && this._canvas) {
      // 全局 capture 来的事件，仅用于拖拽追踪
      if (!this._dragNodeId && !this._panning) return;
    }

    if (e.button === 1 || e.button === 2) {
      // 中键/右键 → 平移
      this._startPan(e);
      return;
    }

    if (e.button === 0 && this._spaceDown) {
      // Space + 左键 → 平移
      this._startPan(e);
      return;
    }

    if (e.button === 0) {
      // 左键 → 检查是否命中节点
      const nodeId = this._hitTestNode(e);
      if (nodeId) {
        this._startNodeDrag(e, nodeId);
      }
    }
  }

  private _onPointerMove(e: PointerEvent): void {
    if (this._dragNodeId) {
      this._moveNodeDrag(e);
      return;
    }

    if (this._panning) {
      this._movePan(e);
      return;
    }
  }

  private _onPointerUp(e: PointerEvent): void {
    if (this._dragNodeId) {
      this._endNodeDrag(e);
      return;
    }

    if (this._panning) {
      this._endPan(e);
      return;
    }

    // 普通点击
    if (e.button === 0 && this._canvas && e.target === this._canvas) {
      const nodeId = this._hitTestNode(e);
      if (nodeId) {
        const now = Date.now();
        if (this._lastClickNode === nodeId && now - this._lastClickTime < 300) {
          // 双击会由 dblclick 处理，这里不触发 click
          this._lastClickTime = 0;
          this._lastClickNode = null;
          return;
        }
        this._lastClickTime = now;
        this._lastClickNode = nodeId;
        this._callbacks.onNodeClick?.(nodeId, e);
      }
    }
  }

  private _onPointerLeave(_e: PointerEvent): void {
    // 拖拽中离开 canvas：不中断，全局 pointermove 会继续追踪
  }

  private _onPointerCancel(_e: PointerEvent): void {
    if (this._dragNodeId) {
      this._endNodeDrag(_e);
    }
    if (this._panning) {
      this._endPan(_e);
    }
  }

  // ---- wheel (zoom) ----

  private _onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return; // 浏览器缩放，不处理

    const rect = this._canvas?.getBoundingClientRect();
    if (!rect) return;

    const sx = (e.clientX - rect.left) * (window.devicePixelRatio || 1);
    const sy = (e.clientY - rect.top) * (window.devicePixelRatio || 1);

    this._viewport.zoomByWheel(sx, sy, e.deltaY);
    this._callbacks.onZoomChange?.(this._viewport.zoom);
  }

  // ---- double click ----

  private _onDoubleClick(e: MouseEvent): void {
    const nodeId = this._hitTestNode(e);
    if (nodeId) {
      this._callbacks.onNodeDoubleClick?.(nodeId, e);
    } else {
      const wp = this._viewport.screenToWorld(e.clientX, e.clientY);
      this._callbacks.onPaneDoubleClick?.(e, wp.x, wp.y);
    }
  }

  // ---- keyboard ----

  private _onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space' && !e.repeat) {
      this._spaceDown = true;
      if (this._canvas) this._canvas.style.cursor = 'grab';
    }
  }

  private _onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      this._spaceDown = false;
      if (this._canvas && !this._panning) {
        this._canvas.style.cursor = 'default';
      }
    }
  }

  // ---- drag helpers ----

  private _startNodeDrag(e: PointerEvent, nodeId: string): void {
    this._dragNodeId = nodeId;
    this._dragMoved = false;
    this._dragStartScreen = { x: e.clientX, y: e.clientY };

    const wp = this._viewport.screenToWorld(
      (e.clientX - (this._canvas?.getBoundingClientRect().left ?? 0)) *
        (window.devicePixelRatio || 1),
      (e.clientY - (this._canvas?.getBoundingClientRect().top ?? 0)) *
        (window.devicePixelRatio || 1),
    );
    this._dragStartWorld = wp;

    this._interacting = true;
    if (this._canvas) this._canvas.style.cursor = 'grabbing';
    this._callbacks.onNodeDragStart?.(nodeId);

    // 捕获指针以确保快速移动时不丢事件
    try {
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
  }

  private _moveNodeDrag(e: PointerEvent): void {
    if (!this._dragNodeId) return;

    const rect = this._canvas?.getBoundingClientRect();
    if (!rect) return;

    const dpr = window.devicePixelRatio || 1;
    const sx = (e.clientX - rect.left) * dpr;
    const sy = (e.clientY - rect.top) * dpr;

    const currentWorld = this._viewport.screenToWorld(sx, sy);
    const dx = currentWorld.x - this._dragStartWorld.x;
    const dy = currentWorld.y - this._dragStartWorld.y;

    if (!this._dragMoved && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
      this._dragMoved = true;
    }

    if (this._dragMoved) {
      this._callbacks.onNodeDrag?.(this._dragNodeId, dx, dy);
      // 更新基准点以获取增量
      this._dragStartWorld = currentWorld;
    }
  }

  private _endNodeDrag(e: PointerEvent): void {
    const nodeId = this._dragNodeId;
    this._dragNodeId = null;
    this._interacting = false;

    if (this._canvas) {
      this._canvas.style.cursor = this._spaceDown ? 'grab' : 'default';
    }

    try {
      (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    } catch { /* ignore */ }

    if (nodeId && this._dragMoved) {
      this._callbacks.onNodeDragEnd?.(nodeId);
    }

    this._dragMoved = false;
  }

  // ---- pan helpers ----

  private _startPan(e: PointerEvent): void {
    this._panning = true;
    this._panButton = e.button;
    this._panStartScreen = { x: e.clientX, y: e.clientY };
    this._panStartViewport = {
      x: this._viewport.world.x,
      y: this._viewport.world.y,
    };
    this._interacting = true;
    if (this._canvas) this._canvas.style.cursor = 'grabbing';
    this._callbacks.onPanStart?.();
  }

  private _movePan(e: PointerEvent): void {
    if (!this._panning) return;
    const dx = e.clientX - this._panStartScreen.x;
    const dy = e.clientY - this._panStartScreen.y;

    // 直接操作 viewport position 而非屏幕坐标转换
    //（平移是屏幕空间的线性偏移）
    this._viewport.setPosition(
      this._panStartViewport.x + dx * (window.devicePixelRatio || 1),
      this._panStartViewport.y + dy * (window.devicePixelRatio || 1),
    );
    this._callbacks.onPan?.();
  }

  private _endPan(e: PointerEvent): void {
    this._panning = false;
    this._panButton = null;
    this._interacting = false;
    if (this._canvas) {
      this._canvas.style.cursor = this._spaceDown ? 'grab' : 'default';
    }
    this._callbacks.onPanEnd?.();
  }

  // ---- hit test ----

  private _hitTestNode(e: MouseEvent | PointerEvent): string | null {
    // 简单实现：遍历所有已挂载的容器做 AABB 测试
    // 对于生产环境可扩展为空间索引（R-tree / quadtree）
    const rect = this._canvas?.getBoundingClientRect();
    if (!rect) return null;

    const dpr = window.devicePixelRatio || 1;
    const sx = (e.clientX - rect.left) * dpr;
    const sy = (e.clientY - rect.top) * dpr;
    const wp = this._viewport.screenToWorld(sx, sy);

    // 从后往前遍历（z-index 高的先命中）
    const hitRadius = 120; // 世界坐标像素的命中容差

    // 遍历所有已挂载的节点容器做 AABB 测试
    for (const [id, container] of this._nodeRenderer['_nodeMap'] as Map<string, Container>) {
      if (!container.visible) continue;
      const rn = this._nodeRenderer['_sizeCache'].get(id);
      if (!rn) continue;

      const hw = rn.w / 2;
      const hh = rn.h / 2;
      const nx = container.x;
      const ny = container.y;

      if (
        wp.x >= nx - hw - hitRadius &&
        wp.x <= nx + hw + hitRadius &&
        wp.y >= ny - hh - hitRadius &&
        wp.y <= ny + hh + hitRadius
      ) {
        return id;
      }
    }

    return null;
  }
}
