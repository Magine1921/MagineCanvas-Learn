import { Container, Graphics } from 'pixi.js';
import type { RenderEdge, EdgeEndpointKey } from './types';

/**
 * 边（连线）渲染器。
 *
 * 使用单个 Graphics 对象绘制所有边，利用 PixiJS 的 WebGL 批处理。
 * 性能核心：只重绘端点坐标发生了变化的边（签名缓存）。
 *
 * 边的渲染分层：
 *  zIndex 0: 背景层（宽线，用于增大 hit area）
 *  zIndex 1: 前景层（细线 + 箭头）
 */
export class PixiEdgeRenderer {
  /** 边线宽 */
  private static readonly LINE_WIDTH = 1.5;
  /** 背景 hit-area 线宽 */
  private static readonly HIT_LINE_WIDTH = 14;
  /** 边颜色 */
  private static readonly COLOR = 0x6366f1;
  /** 选中态颜色 */
  private static readonly COLOR_SELECTED = 0xfb923c;
  /** 透明度 */
  private static readonly ALPHA = 0.38;
  /** 选中态透明度 */
  private static readonly ALPHA_SELECTED = 0.8;
  /** 溶解/渐变态透明度 */
  private static readonly ALPHA_DIM = 0.15;
  /** 箭头半宽 */
  private static readonly ARROW_HALF_W = 5;
  /** 箭头长度 */
  private static readonly ARROW_LEN = 8;

  private _bgGraphics: Graphics;
  private _fgGraphics: Graphics;
  /** endpoint key → {x, y} 缓存 */
  private _endpointCache = new Map<EdgeEndpointKey, { x: number; y: number }>();
  /** edge id → 缓存的端点 keys */
  private _edgeEndpointKeys = new Map<string, [EdgeEndpointKey, EdgeEndpointKey]>();
  /** 脏边集合 */
  private _dirtyEdges = new Set<string>();
  /** 当前所有的边 */
  private _edges: RenderEdge[] = [];
  /** 是否有待重绘 */
  private _needsRedraw = false;

  constructor() {
    this._bgGraphics = new Graphics();
    this._bgGraphics.zIndex = -2;
    this._bgGraphics.label = 'edges-bg';

    this._fgGraphics = new Graphics();
    this._fgGraphics.zIndex = -1;
    this._fgGraphics.label = 'edges-fg';
  }

  // ---- 挂载 ----

  attach(parent: Container): void {
    parent.addChild(this._bgGraphics);
    parent.addChild(this._fgGraphics);
  }

  // ---- 数据同步 ----

  /** 用新的边数据全集替换（diff 后只重绘变化的边） */
  setEdges(edges: RenderEdge[]): void {
    const newIds = new Set(edges.map((e) => e.id));

    // 移除不在新数据中的边缓存
    for (const [id] of this._edgeEndpointKeys) {
      if (!newIds.has(id)) {
        const keys = this._edgeEndpointKeys.get(id);
        if (keys) {
          this._endpointCache.delete(keys[0]);
          this._endpointCache.delete(keys[1]);
        }
        this._edgeEndpointKeys.delete(id);
        this._dirtyEdges.add(id);
      }
    }

    // 检测端点变化
    for (const e of edges) {
      const srcKey: EdgeEndpointKey = `${e.id}_s`;
      const tgtKey: EdgeEndpointKey = `${e.id}_t`;

      const prevKeys = this._edgeEndpointKeys.get(e.id);
      this._edgeEndpointKeys.set(e.id, [srcKey, tgtKey]);

      const cachedSrc = this._endpointCache.get(srcKey);
      const cachedTgt = this._endpointCache.get(tgtKey);

      if (
        !cachedSrc ||
        !cachedTgt ||
        !this._approxEq(cachedSrc.x, e.sourceX) ||
        !this._approxEq(cachedSrc.y, e.sourceY) ||
        !this._approxEq(cachedTgt.x, e.targetX) ||
        !this._approxEq(cachedTgt.y, e.targetY)
      ) {
        this._endpointCache.set(srcKey, { x: e.sourceX, y: e.sourceY });
        this._endpointCache.set(tgtKey, { x: e.targetX, y: e.targetY });
        this._dirtyEdges.add(e.id);
      }
    }

    this._edges = edges;
    this._needsRedraw = this._dirtyEdges.size > 0;
  }

  /** 标记某条边为脏（节点被拖拽时） */
  markDirty(edgeId: string): void {
    this._dirtyEdges.add(edgeId);
    this._needsRedraw = true;
  }

  /** 标记连接到某节点的所有边为脏 */
  markNodeEdgesDirty(nodeId: string): void {
    for (const e of this._edges) {
      if (e.id.includes(nodeId)) {
        this._dirtyEdges.add(e.id);
      }
    }
    this._needsRedraw = this._dirtyEdges.size > 0;
  }

  // ---- 绘制 ----

  /** 重绘所有脏边。调用此方法前确保 setEdges 已完成数据同步。 */
  redraw(): void {
    if (!this._needsRedraw) return;

    // 只重绘变了或新增的边；不变的边保持原有像素
    // 由于 PixiJS Graphics 不支持局部修改，这里采用 clear + redraw all 策略
    // 当节点数 < 500 时此策略的 frame budget 足够
    const edges = this._edges;
    const dirtySet = this._dirtyEdges;

    this._bgGraphics.clear();
    this._fgGraphics.clear();

    for (const e of edges) {
      const isDirty = dirtySet.has(e.id);
      if (!isDirty && edges.length > 100) {
        // 脏边数量少时全量重绘；脏边多时跳过未改变的边
        //（但在当前 Graphics 实现中，clear() 已清空一切，所以这里走简化路径）
      }
      this._drawEdge(e);
    }

    this._dirtyEdges.clear();
    this._needsRedraw = false;
  }

  // ---- 清理 ----

  clear(): void {
    this._bgGraphics.clear();
    this._fgGraphics.clear();
    this._endpointCache.clear();
    this._edgeEndpointKeys.clear();
    this._dirtyEdges.clear();
    this._edges = [];
    this._needsRedraw = false;
  }

  destroy(): void {
    this._bgGraphics.destroy();
    this._fgGraphics.destroy();
  }

  // ---- private ----

  private _drawEdge(e: RenderEdge): void {
    const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = e;

    // 贝塞尔控制点偏移
    const dx = tx - sx;
    const cpOffset = Math.max(Math.abs(dx) * 0.5, 60);

    // 背景宽线（hit area）
    this._bgGraphics.moveTo(sx, sy);
    this._bgGraphics.bezierCurveTo(
      sx + cpOffset,
      sy,
      tx - cpOffset,
      ty,
      tx,
      ty,
    );
    this._bgGraphics.stroke({
      width: PixiEdgeRenderer.HIT_LINE_WIDTH,
      color: 0x000000,
      alpha: 0.001, // 几乎不可见，仅用于 hit
    });

    // 前景细线
    const alpha = e.dissolving
      ? PixiEdgeRenderer.ALPHA_DIM
      : e.fading
        ? PixiEdgeRenderer.ALPHA_DIM
        : e.selected
          ? PixiEdgeRenderer.ALPHA_SELECTED
          : PixiEdgeRenderer.ALPHA;

    const color = e.selected
      ? PixiEdgeRenderer.COLOR_SELECTED
      : PixiEdgeRenderer.COLOR;

    this._fgGraphics.moveTo(sx, sy);
    this._fgGraphics.bezierCurveTo(
      sx + cpOffset,
      sy,
      tx - cpOffset,
      ty,
      tx,
      ty,
    );
    this._fgGraphics.stroke({
      width: PixiEdgeRenderer.LINE_WIDTH,
      color,
      alpha,
    });

    // 箭头
    this._drawArrow(tx, ty, tx - cpOffset, ty);
  }

  private _drawArrow(tipX: number, tipY: number, fromX: number, fromY: number): void {
    const angle = Math.atan2(tipY - fromY, tipX - fromX);
    const { ARROW_LEN: len, ARROW_HALF_W: hw } = PixiEdgeRenderer;

    const baseX = tipX - len * Math.cos(angle);
    const baseY = tipY - len * Math.sin(angle);
    const p1x = baseX - hw * Math.sin(angle);
    const p1y = baseY + hw * Math.cos(angle);
    const p2x = baseX + hw * Math.sin(angle);
    const p2y = baseY - hw * Math.cos(angle);

    this._fgGraphics.moveTo(tipX, tipY);
    this._fgGraphics.lineTo(p1x, p1y);
    this._fgGraphics.lineTo(p2x, p2y);
    this._fgGraphics.closePath();
    this._fgGraphics.fill({ color: PixiEdgeRenderer.COLOR, alpha: PixiEdgeRenderer.ALPHA });
  }

  private _approxEq(a: number, b: number): boolean {
    return Math.abs(a - b) < 0.15;
  }
}
