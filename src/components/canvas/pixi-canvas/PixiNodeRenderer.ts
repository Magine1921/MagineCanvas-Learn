import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { RenderNode, ViewportState } from './types';
import { NODE_TYPE_COLORS } from './types';

/**
 * 节点渲染器。
 *
 * 负责根据 RenderNode 数据创建和管理 PixiJS 显示对象。
 * 每个节点是一个 Container，包含：
 * - 阴影层 (Graphics, zIndex: 0)
 * - 主体层 (Graphics, zIndex: 1)
 * - 文字 (Text, zIndex: 2)
 *
 * 性能策略：
 * - 视口外节点设 visible=false（不提交 draw call）
 * - position 签名缓存跳过无变化节点的 DOM 写入
 * - 节点池化：隐藏而非销毁，避免频繁 GC
 */
export class PixiNodeRenderer {
  /** id → Container */
  private _nodeMap = new Map<string, Container>();
  /** id → 上次渲染的 position key（用于 diff） */
  private _posKeyCache = new Map<string, string>();
  /** 空闲的可复用容器 */
  private _pool: Container[] = [];
  /** 节点尺寸缓存 */
  private _sizeCache = new Map<string, { w: number; h: number }>();

  private _textStyle: TextStyle;
  private _textStylePool: Map<number, TextStyle> = new Map();

  constructor() {
    this._textStyle = new TextStyle({
      fontSize: 12,
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      fill: 0xffffff,
      fontWeight: '600',
    });
  }

  // ---- 生命周期 ----

  /** 获取或创建节点的 Container */
  getOrCreate(rn: RenderNode, parent: Container): Container {
    let container = this._nodeMap.get(rn.id);
    if (!container) {
      container = this._acquire(rn);
      parent.addChild(container);
      this._nodeMap.set(rn.id, container);
    }
    return container;
  }

  /** 移除节点（放入池中） */
  remove(nodeId: string): void {
    const container = this._nodeMap.get(nodeId);
    if (!container) return;
    container.removeFromParent();
    this._nodeMap.delete(nodeId);
    this._posKeyCache.delete(nodeId);
    this._sizeCache.delete(nodeId);
    // 重置并放回池
    container.visible = false;
    container.scale.set(1);
    container.eventMode = 'none';
    (container as any).__nodeId = undefined;
    this._pool.push(container);
  }

  /** 批量移除 */
  removeMany(nodeIds: string[]): void {
    for (const id of nodeIds) this.remove(id);
  }

  /** 清空所有节点 */
  clear(): void {
    for (const [, c] of this._nodeMap) {
      c.removeFromParent();
      c.destroy({ children: true });
    }
    this._nodeMap.clear();
    this._posKeyCache.clear();
    this._sizeCache.clear();
    for (const c of this._pool) c.destroy({ children: true });
    this._pool.length = 0;
  }

  // ---- 同步更新 ----

  /**
   * 将一个 RenderNode 的数据同步到对应的 PixiJS Container。
   * 使用 position key 签名跳过无变化的节点，避免不必要的属性写入。
   */
  sync(rn: RenderNode, viewport: ViewportState, parent: Container): void {
    const container = this.getOrCreate(rn, parent);

    // position key diff
    const posKey = `${rn.x.toFixed(1)}_${rn.y.toFixed(1)}_${rn.width}_${rn.height}_${rn.selected ? 1 : 0}`;
    const needsTransform = this._posKeyCache.get(rn.id) !== posKey;

    if (needsTransform) {
      this._posKeyCache.set(rn.id, posKey);
      container.x = rn.x;
      container.y = rn.y;
    }

    // zIndex
    container.zIndex = rn.zIndex ?? 0;

    // 可见性（viewport culling 由外部控制）
    const prevSize = this._sizeCache.get(rn.id);
    if (!prevSize || prevSize.w !== rn.width || prevSize.h !== rn.height || needsTransform) {
      this._sizeCache.set(rn.id, { w: rn.width, h: rn.height });
      this._redrawGraphics(container, rn);
    }

    if (needsTransform) {
      // 选中态视觉
      const body = container.getChildAt(1) as Graphics | undefined;
      if (body) {
        body.alpha = rn.selected ? 1 : 0.92;
      }
    }
  }

  /** 设置节点可见性（culling） */
  setVisible(nodeId: string, visible: boolean): void {
    const c = this._nodeMap.get(nodeId);
    if (c) c.visible = visible;
  }

  /** 批量设置可见性 */
  setVisibleBatch(updates: Array<{ id: string; visible: boolean }>): void {
    for (const { id, visible } of updates) {
      this.setVisible(id, visible);
    }
  }

  // ---- 查询 ----

  getContainer(nodeId: string): Container | undefined {
    return this._nodeMap.get(nodeId);
  }

  has(nodeId: string): boolean {
    return this._nodeMap.has(nodeId);
  }

  get mountedCount(): number {
    return this._nodeMap.size;
  }

  // ---- private ----

  private _acquire(rn: RenderNode): Container {
    const container = this._pool.pop() || new Container();
    container.label = `node-${rn.id}`;
    (container as any).__nodeId = rn.id;
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.sortableChildren = true;

    // Z-order: shadow(0) < body(1) < text(2)
    const shadow = new Graphics();
    shadow.zIndex = 0;
    container.addChild(shadow);

    const body = new Graphics();
    body.zIndex = 1;
    container.addChild(body);

    const text = new Text({
      text: rn.label,
      style: this._getOrCreateTextStyle(rn.color),
    });
    text.anchor.set(0.5);
    text.zIndex = 2;
    container.addChild(text);

    this._redrawGraphics(container, rn);
    return container;
  }

  private _redrawGraphics(container: Container, rn: RenderNode): void {
    const { width: w, height: h } = rn;
    const shadow = container.getChildAt(0) as Graphics;
    const body = container.getChildAt(1) as Graphics;
    const text = container.getChildAt(2) as Text;

    // 阴影
    shadow.clear();
    shadow.roundRect(-w / 2 - 2, -h / 2 + 2, w + 4, h + 4, 8);
    shadow.fill({ color: 0x000000, alpha: 0.25 });

    // 主体
    body.clear();
    body.roundRect(-w / 2, -h / 2, w, h, 8);
    body.fill({ color: rn.color });
    // 顶部高光
    const highlightH = Math.min(h * 0.35, 20);
    body.rect(-w / 2 + 4, -h / 2 + 4, w - 8, highlightH);
    body.fill({ color: 0xffffff, alpha: 0.08 });

    // 文字
    text.text = rn.label;
    text.style = this._getOrCreateTextStyle(rn.color);
  }

  private _getOrCreateTextStyle(_color: number): TextStyle {
    // 所有节点用同一文字样式以启用批处理
    if (!this._textStylePool.has(0)) {
      this._textStylePool.set(0, this._textStyle.clone());
    }
    return this._textStylePool.get(0)!;
  }
}
