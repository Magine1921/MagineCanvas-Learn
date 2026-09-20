import { Application, Container } from 'pixi.js';
import { PixiViewport } from './PixiViewport';
import { PixiNodeRenderer } from './PixiNodeRenderer';
import { PixiEdgeRenderer } from './PixiEdgeRenderer';
import { PixiGridRenderer } from './PixiGridRenderer';
import { PixiInteraction, type PixiInteractionCallbacks } from './PixiInteraction';
import type {
  PixiCanvasConfig,
  RenderNode,
  RenderEdge,
  VisibleBounds,
} from './types';
import { DEFAULT_PIXI_CANVAS_CONFIG } from './types';

/**
 * PixiJS 无限画布核心引擎。
 *
 * 职责：整合 viewport、nodeRenderer、edgeRenderer、gridRenderer、interaction
 * 为一个统一的画布实例。对外暴露声明式 API（syncNodes, syncEdges, etc.），
 * 内部通过 rAF 调度渲染，自动处理 culling 和脏标记。
 *
 * 生命周期：
 *   const core = new PixiCanvasCore();
 *   await core.init(containerDiv, config, callbacks);
 *   // ... use core.syncNodes(...), core.syncEdges(...)
 *   core.destroy(); // 组件卸载时调用
 *
 * 架构决策：
 * - 使用 PixiJS Application（包含 renderer, ticker, stage）
 * - 所有节点/边/网格作为 stage → world 的子节点（受 viewport transform 影响）
 * - UI 覆盖层（toolbar 等）放在 stage 外层（不受 viewport transform 影响）
 * - interaction 直接监听 canvas DOM 事件（不经过 PixiJS 事件系统）
 */
export class PixiCanvasCore {
  readonly viewport: PixiViewport;
  readonly nodeRenderer: PixiNodeRenderer;
  readonly edgeRenderer: PixiEdgeRenderer;
  readonly gridRenderer: PixiGridRenderer;
  interaction: PixiInteraction;

  private _app: Application | null = null;
  private _config: PixiCanvasConfig;
  private _initialized = false;
  private _destroyed = false;

  // 帧调度
  private _frameRequested = false;
  private _pendingSyncNodes: RenderNode[] | null = null;
  private _pendingSyncEdges: RenderEdge[] | null = null;
  private _pendingFullSync = false;

  // culling set
  private _visibleNodeIds = new Set<string>();

  constructor(config?: Partial<PixiCanvasConfig>) {
    this._config = { ...DEFAULT_PIXI_CANVAS_CONFIG, ...config };
    this.viewport = new PixiViewport(this._config);
    this.nodeRenderer = new PixiNodeRenderer();
    this.edgeRenderer = new PixiEdgeRenderer();
    this.gridRenderer = new PixiGridRenderer(this._config);
    this.interaction = new PixiInteraction(
      this.viewport,
      this.nodeRenderer,
      {},
    );
  }

  // ---- 初始化 ----

  async init(
    container: HTMLElement,
    callbacks?: PixiInteractionCallbacks,
  ): Promise<HTMLCanvasElement> {
    if (this._initialized || this._destroyed) {
      throw new Error('PixiCanvasCore already initialized or destroyed');
    }

    const PIXI = await import('pixi.js');
    const dpr = window.devicePixelRatio || 1;

    const app = new PIXI.Application();
    await app.init({
      resizeTo: container,
      backgroundColor: this._config.backgroundColor,
      antialias: this._config.antialias,
      resolution: dpr,
      autoDensity: true,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });

    this._app = app;
    container.appendChild(app.canvas);

    // 层级结构: stage → world (viewport transform) → [grid, edges, nodes]
    const world = this.viewport.world;
    app.stage.addChild(world);

    // 挂载子渲染器到 world
    this.gridRenderer.attach(world);
    this.edgeRenderer.attach(world);

    // 设置画布世界尺寸
    this.gridRenderer.setCanvasSize(8000, 6000);

    // 绑定交互
    this.interaction = new PixiInteraction(
      this.viewport,
      this.nodeRenderer,
      callbacks,
    );
    this.interaction.bind(app.canvas);

    // 启动主循环
    app.ticker.add(() => this._frameTick());

    this._initialized = true;
    return app.canvas;
  }

  // ---- 销毁 ----

  destroy(): void {
    this._destroyed = true;
    this.interaction.unbind();
    this.nodeRenderer.clear();
    this.edgeRenderer.clear();
    this.gridRenderer.destroy();
    if (this._app) {
      this._app.ticker.stop();
      this._app.destroy(true, { children: true });
      this._app = null;
    }
    this._initialized = false;
  }

  // ---- 数据同步 API ----

  /** 全量同步节点数据。内部做 diff，仅更新变化的节点。 */
  syncNodes(nodes: RenderNode[]): void {
    this._pendingSyncNodes = nodes;
    this._scheduleFrame();
  }

  /** 全量同步边数据。内部做端点签名 diff，仅重绘变化的边。 */
  syncEdges(edges: RenderEdge[]): void {
    this._pendingSyncEdges = edges;
    this._scheduleFrame();
  }

  /** 强制全量重绘 */
  fullRedraw(): void {
    this._pendingFullSync = true;
    this._scheduleFrame();
  }

  /** 更改配置（部分字段） */
  updateConfig(patch: Partial<PixiCanvasConfig>): void {
    this._config = { ...this._config, ...patch };
  }

  /** 获取当前可见区域边界 */
  getVisibleBounds(): VisibleBounds {
    return this.viewport.getVisibleBounds();
  }

  /** 适配视图 */
  fitView(nodes: RenderNode[], padding = 0.15): void {
    if (nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const hw = n.width / 2;
      const hh = n.height / 2;
      minX = Math.min(minX, n.x - hw);
      minY = Math.min(minY, n.y - hh);
      maxX = Math.max(maxX, n.x + hw);
      maxY = Math.max(maxY, n.y + hh);
    }
    this.viewport.fitBounds(minX, minY, maxX, maxY, padding);
  }

  /** 更新回调（用于动态绑定） */
  setCallbacks(callbacks: PixiInteractionCallbacks): void {
    this.interaction = new PixiInteraction(
      this.viewport,
      this.nodeRenderer,
      callbacks,
    );
    // 重新绑定 canvas 事件
    if (this._app) {
      this.interaction.unbind();
      this.interaction.bind(this._app.canvas);
    }
  }

  // ---- 渲染帧调度 ----

  private _scheduleFrame(): void {
    if (!this._frameRequested) {
      this._frameRequested = true;
    }
  }

  private _frameTick(): void {
    if (!this._frameRequested) {
      // ticker 仍在运行但本帧无事可做
      return;
    }

    this._frameRequested = false;

    // 1. 视口 lerp 动画
    this.viewport.tick();

    // 2. 同步边数据
    if (this._pendingSyncEdges) {
      this.edgeRenderer.setEdges(this._pendingSyncEdges);
      this._pendingSyncEdges = null;
    }

    // 3. 同步节点数据
    if (this._pendingSyncNodes) {
      const nodes = this._pendingSyncNodes;
      this._pendingSyncNodes = null;

      // Mount/diff nodes
      const vis = this.viewport.getVisibleBounds();
      const visibleIds = new Set<string>();

      for (const rn of nodes) {
        // 仅渲染可见节点
        if (this._isNodeVisible(rn, vis)) {
          visibleIds.add(rn.id);
          this.nodeRenderer.sync(
            rn,
            {
              x: this.viewport.world.x,
              y: this.viewport.world.y,
              zoom: this.viewport.zoom,
              width: this.viewport.screenWidth,
              height: this.viewport.screenHeight,
            },
            this.viewport.world,
          );
        }
      }

      // 隐藏视口外的节点
      for (const id of this._visibleNodeIds) {
        if (!visibleIds.has(id)) {
          this.nodeRenderer.setVisible(id, false);
        }
      }
      for (const id of visibleIds) {
        this.nodeRenderer.setVisible(id, true);
      }

      this._visibleNodeIds = visibleIds;
    }

    // 4. 重绘边
    if (this._pendingSyncEdges !== undefined || this._pendingFullSync) {
      this.edgeRenderer.redraw();
    }

    if (this._pendingFullSync) {
      this._pendingFullSync = false;
    }
  }

  // ---- helpers ----

  private _isNodeVisible(rn: RenderNode, bounds: VisibleBounds): boolean {
    const hw = rn.width / 2 + this._config.viewportPadding;
    const hh = rn.height / 2 + this._config.viewportPadding;
    return !(
      rn.x + hw < bounds.minX ||
      rn.x - hw > bounds.maxX ||
      rn.y + hh < bounds.minY ||
      rn.y - hh > bounds.maxY
    );
  }
}
