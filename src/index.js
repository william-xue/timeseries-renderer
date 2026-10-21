/**
 * ts-columns —— 大数据量时序曲线渲染层（可嵌入版）
 *
 * 这一层只做一件事：把"时间序列 + 一个 canvas"变成一条能在百万点下跑满帧的曲线。
 * 它不负责取数、不管框架、不做图表类型——它只解决"画"这一段的成本。
 *
 * 用法：
 *   const chart = createTimeSeries(canvasEl, { series: [{ id: 'p', color: '#35e0c2' }] })
 *   chart.push([{ id: 'p', t: performance.now(), v: 320.5 }])
 *
 * 数据契约（最小）：
 *   一个采样点 = { id, t, v }，t 是毫秒时间戳，v 是数值。
 *   push 接受单点、点数组、或引擎原生的 { series: [{ id, t: Float64Array, v: Float32Array }] } 批次。
 */
import { CanvasEngine } from './core/engines/engine-canvas.js';
import { WebGLEngine } from './core/engines/engine-webgl.js';

export { CanvasEngine, WebGLEngine };
export { SeriesBuffer } from './core/util/ringbuffer.js';
export { ColumnGrid } from './core/util/columns.js';

const asArray = (x) => (Array.isArray(x) || ArrayBuffer.isView(x)) ? x : [x];

/** 把三种输入形态统一成 { id: [t...], v... } 的分组 */
function group(samples) {
  const rows = Array.isArray(samples)
    ? samples
    : (samples && Array.isArray(samples.series) ? samples.series : [samples]);

  const map = new Map();
  for (const r of rows) {
    if (!r || r.id === undefined) continue;
    let e = map.get(r.id);
    if (!e) { e = { id: r.id, t: [], v: [] }; map.set(r.id, e); }
    const ts = asArray(r.t);
    const vs = asArray(r.v);
    for (let i = 0; i < ts.length; i++) { e.t.push(ts[i]); e.v.push(vs[i]); }
  }
  return map;
}

function toSeries(map) {
  const out = [];
  for (const s of map.values()) {
    out.push({ id: s.id, t: Float64Array.from(s.t), v: Float32Array.from(s.v) });
  }
  return out;
}

/**
 * @param {HTMLCanvasElement|HTMLElement} el 目标容器（传 canvas 会自动套一层）
 * @param {object} opts
 * @param {Array<{id:string,name?:string,color:string,unit?:string,amp?:number}>} opts.series 序列定义
 * @param {number} [opts.span=60000] 可视窗口毫秒
 * @param {'canvas'|'webgl'} [opts.engine='canvas']
 * @param {(ts:number)=>void} [opts.onDrawn] 每帧上屏回调（参数是触发该帧的采样时间戳）
 * @param {()=>void} [opts.onFrame] 每个 rAF 回调
 * @param {boolean} [opts.autoStart=true]
 */
export function createTimeSeries(el, opts = {}) {
  const series = opts.series || [];
  if (!series.length) throw new Error('createTimeSeries: opts.series 不能为空');
  for (const s of series) {
    if (!s.id) throw new Error('createTimeSeries: 每个 series 需要 id');
    if (!s.color) throw new Error(`createTimeSeries: series "${s.id}" 需要 color`);
  }

  // 传 canvas 时套一层定位容器（引擎内部用绝对定位叠三张画布）
  let host = el;
  if (el && el.tagName === 'CANVAS') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:block;width:100%;height:100%';
    el.replaceWith(wrap);
    wrap.appendChild(el);
    el.style.display = 'none';
    host = wrap;
  }

  const defs = series.map((s) => ({
    id: s.id,
    name: s.name || s.id,
    unit: s.unit || '',
    color: s.color,
    amp: s.amp === undefined ? 1 : s.amp,
  }));

  const engineOpts = {
    defs,
    spanMs: opts.span || 60000,
    onDrawn: opts.onDrawn || (() => {}),
    onFrame: opts.onFrame || (() => {}),
  };
  const engine = opts.engine === 'webgl'
    ? new WebGLEngine(host, engineOpts)
    : new CanvasEngine(host, engineOpts);

  const known = new Set(defs.map((d) => d.id));
  let seq = 0;

  if (opts.autoStart !== false) engine.startLoop();

  return {
    /** 一次性灌入历史（打开历史查询）。接受与 push 相同的形态 */
    load(samples) {
      const map = group(samples);
      for (const id of map.keys()) {
        if (!known.has(id)) throw new Error(`未知序列 id: ${id}`);
      }
      return engine.load(map);
    },

    /** 推实时数据。单点 / 点数组 / 原生批次都行 */
    push(samples) {
      const map = group(samples);
      if (!map.size) return;
      for (const id of map.keys()) {
        if (!known.has(id)) throw new Error(`未知序列 id: ${id}`);
      }
      engine.push({ seq: ++seq, ts: performance.now(), series: toSeries(map) });
    },

    /** 设置可视窗口（毫秒） */
    setViewport({ span }) {
      if (span) engine.setSpan(span);
    },

    /** 回看全历史：视窗拉到整段数据，返回 { ms, points, cols } */
    review() {
      return engine.reviewFull();
    },

    /** 全览下再整幅重绘一次，返回毫秒 */
    redraw() {
      return engine.redrawFull ? engine.redrawFull() : null;
    },

    stats() {
      return {
        points: engine.pointCount || 0,
        cols: engine.nCols || 0,
        fullFrames: engine.fullFrames || 0,
        incFrames: engine.incFrames || 0,
      };
    },

    /** 底层引擎，逃生口 */
    get engine() { return engine; },

    dispose() {
      engine.dispose();
    },
  };
}

export default createTimeSeries;
