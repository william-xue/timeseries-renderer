/**
 * ts-columns 类型声明
 * 与 src/index.js 的实现一一对应；改实现时请同步这里。
 */

export interface SeriesDef {
  /** 序列唯一标识，推数据时用它匹配 */
  id: string;
  /** 图例/读数里显示的名字，缺省用 id */
  name?: string;
  /** 曲线颜色，CSS 颜色字符串，必填 */
  color: string;
  /** 单位，进读数框 */
  unit?: string;
  /** 量级提示，只影响读数小数位（<1 显示 3 位小数） */
  amp?: number;
}

/** 一个采样点 */
export interface Sample {
  id: string;
  /** 毫秒时间戳，同一序列内必须单调递增 */
  t: number;
  v: number;
}

/** 引擎原生批次（批量推数据时零转换） */
export interface NativeBatch {
  series: Array<{
    id: string;
    t: Float64Array | Float32Array | number[];
    v: Float64Array | Float32Array | number[];
  }>;
}

/** push / load 接受三种形态：单点、点数组、原生批次 */
export type Samples = Sample | Sample[] | NativeBatch;

export interface TimeSeriesOptions {
  series: SeriesDef[];
  /** 可视窗口毫秒，默认 60000 */
  span?: number;
  /** 默认 'canvas'；'webgl' 为试用后端（每帧全量重建） */
  engine?: 'canvas' | 'webgl';
  /** 每帧上屏回调；ts 是触发该帧的采样时间戳，用 performance.now() - ts 得端到端延迟 */
  onDrawn?: (ts: number) => void;
  /** 每个 requestAnimationFrame 回调 */
  onFrame?: () => void;
  /** 默认 true */
  autoStart?: boolean;
}

export interface LoadResult {
  loadMs: number;
  points: number;
}

export interface ReviewResult {
  /** 从发起变焦到成图的毫秒数 */
  ms: number;
  points: number;
  /** 压缩后的像素列数 */
  cols: number;
  spanMs?: number;
}

export interface Stats {
  points: number;
  cols: number;
  fullFrames: number;
  incFrames: number;
}

/** 定长环形缓冲：写入 O(1)、零分配 */
export declare class SeriesBuffer {
  constructor(capacity: number);
  readonly cap: number;
  readonly count: number;
  readonly firstT: number;
  readonly lastT: number;
  readonly lastV: number;
  push(t: number, v: number): void;
  pushMany(ts: ArrayLike<number>, vs: ArrayLike<number>): void;
  tAt(i: number): number;
  vAt(i: number): number;
  lowerBound(target: number): number;
  upperBound(target: number): number;
}

/** 列栅格：每列只留 min / max / first / last */
export declare class ColumnGrid {
  constructor(nCols: number);
  readonly nCols: number;
  readonly colW: number;
  readonly right: number;
  clear(): void;
  rebuild(buf: SeriesBuffer, spanMs: number, endT: number): void;
  append(buf: SeriesBuffer, fromIdx: number, toIdx: number): void;
  colStart(col: number): number;
}

export interface EngineOptions {
  defs: SeriesDef[];
  spanMs?: number;
  onDrawn?: (ts: number) => void;
  onFrame?: () => void;
}

/** 分层 Canvas 2D 引擎（三层画布 + 脏区增量绘制） */
export declare class CanvasEngine {
  constructor(host: HTMLElement, opts: EngineOptions);
  readonly cvBg: HTMLCanvasElement;
  readonly cvData: HTMLCanvasElement;
  readonly cvCursor: HTMLCanvasElement;
  dataCtx: CanvasRenderingContext2D | null;
  pointCount: number;
  nCols: number;
  fullFrames: number;
  incFrames: number;
  load(backfill: Map<string, { t: Float64Array; v: Float32Array }>): LoadResult;
  push(batch: { seq: number; ts: number; series: NativeBatch['series'] }): void;
  startLoop(onDrawn?: (ts: number) => void): void;
  stopLoop(): void;
  setSpan(ms: number): void;
  reviewFull(): ReviewResult;
  redrawFull(): number;
  flushSync(): void;
  dispose(): void;
}

/** WebGL2 引擎：复用 CanvasEngine 的数据与交互，只替换绘制层 */
export declare class WebGLEngine extends CanvasEngine {
  readonly gl: WebGL2RenderingContext;
}

export interface TimeSeriesInstance {
  /** 一次性灌入历史 */
  load(samples: Samples): LoadResult;
  /** 推实时数据 */
  push(samples: Samples): void;
  /** 改可视窗口（毫秒） */
  setViewport(v: { span?: number }): void;
  /** 回看全历史 */
  review(): ReviewResult;
  /** 全览下再整幅重绘一次，返回毫秒 */
  redraw(): number | null;
  stats(): Stats;
  /** 底层引擎，逃生口 */
  readonly engine: CanvasEngine | WebGLEngine;
  dispose(): void;
}

/**
 * 创建一个时序曲线实例。
 * @param el 容器元素；传 <canvas> 会自动套一层定位容器
 */
export declare function createTimeSeries(el: HTMLElement, opts: TimeSeriesOptions): TimeSeriesInstance;

export default createTimeSeries;
