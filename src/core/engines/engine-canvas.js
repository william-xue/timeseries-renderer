/**
 * 分层Canvas 2D：背景、曲线、光标各自刷新。
 * WebGLEngine复用此处的数据聚合和交互，独立管理曲线层的GPU资源。
 */
import { SeriesBuffer } from '../util/ringbuffer.js';
import { ColumnGrid } from '../util/columns.js';

export const PAD = { l: 64, r: 14, t: 14, b: 26 };

export class CanvasEngine {
  constructor(host, opts) {
    this.host = host;
    this.defs = opts.defs;
    this.spanMs = opts.spanMs || 60000;
    this.onDrawn = opts.onDrawn || (() => {});
    this.onFrame = opts.onFrame || (() => {});
    this.buffers = new Map();
    this.grids = new Map();
    this.invalidateView = true;
    this.dirty = false;
    this.pendingTs = 0;
    this.hover = null;
    this.raf = 0;
    this.drawnRight = 0;
    this.drawnSpan = 0;
    this.drawnColPx = 0;
    this.incFrames = 0;
    this.fullFrames = 0;
    this._buildDom();
  }

  _buildDom() {
    this.host.innerHTML = '';
    const mk = (z) => {
      const c = document.createElement('canvas');
      c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z}`;
      this.host.appendChild(c);
      return c;
    };
    this.cvBg = mk(1);
    this.cvBg.getContext('2d', { alpha: false });
    this.cvData = mk(2);
    this.cvCursor = mk(3);
    this._initDataLayer();

    this.resize();
    this._ro = new ResizeObserver(() => { this.resize(); this.invalidateView = true; this.dirty = true; });
    this._ro.observe(this.host);

    this.host.style.cursor = 'crosshair';
    this._onMove = (e) => {
      const r = this.cvCursor.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      this._drawCursor();
    };
    this._onLeave = () => {
      this.hover = null;
      const ctx = this.cvCursor.getContext('2d');
      ctx.clearRect(0, 0, this.w, this.h);
    };
    this.host.addEventListener('mousemove', this._onMove);
    this.host.addEventListener('mouseleave', this._onLeave);

    // 滚轮缩放后，从原始点重建可视列栅格。
    this._onWheel = (e) => {
      e.preventDefault();
      const k = e.deltaY > 0 ? 1.3 : 0.77;
      this.setSpan(Math.max(2000, Math.min(6 * 3600 * 1000, this.spanMs * k)));
    };
    this.host.addEventListener('wheel', this._onWheel, { passive: false });
  }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(320, Math.floor(r.width));
    this.h = Math.max(180, Math.floor(r.height));
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.cvBg, this.cvData, this.cvCursor]) {
      c.width = Math.floor(this.w * dpr);
      c.height = Math.floor(this.h * dpr);
    }
    for (const c of [this.cvBg, this.cvCursor]) {
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (this.dataCtx) this.dataCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.invalidateView = true;
  }

  setSpan(ms) {
    this.spanMs = ms;
    this.invalidateView = true;
    this.dirty = true;
  }

  /** 历史数据一次性载入（对应 ECharts 的首帧 setOption） */
  load(backfill) {
    const t0 = performance.now();
    let total = 0;
    let endT = 0;
    for (const d of this.defs) {
      const src = backfill.get(d.id);
      if (!src) continue;
      const buf = new SeriesBuffer(src.t.length + 8192);
      buf.pushMany(src.t, src.v);
      this.buffers.set(d.id, buf);
      total += buf.count;
      if (buf.lastT > endT) endT = buf.lastT;
    }
    this.pointCount = total;
    this.endT = endT || performance.now();
    this.invalidateView = true;
    this.dirty = true;

    this.flushSync();
    return { loadMs: performance.now() - t0, points: total };
  }

  /** 实时批次：写环形缓冲 + 追加进末列，O(新增点数) */
  push(batch) {
    const now = performance.now();
    for (const s of batch.series) {
      const buf = this.buffers.get(s.id);
      if (!buf) continue;
      const before = buf.count;
      buf.pushMany(s.t, s.v);
      this.pointCount += buf.count - before;

      const g = this.grids.get(s.id);
      if (g && !this.invalidateView) {
        const from = Math.max(0, buf.count - s.t.length);
        g.append(buf, from, buf.count);
      }
    }
    this.dirty = true;
    this.pendingTs = batch.ts || now; // 端到端延迟的起点：采样产生时刻
  }

  startLoop(onDrawn) {
    if (onDrawn) this.onDrawn = onDrawn;
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.dirty || this.invalidateView) {
        this.flushSync();
        const ts = this.pendingTs;
        this.pendingTs = 0;
        this.onDrawn(ts || 0);
      }
      this.onFrame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stopLoop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  _latestT() {
    let t = this.endT || performance.now();
    for (const [, b] of this.buffers) if (b.lastT > t) t = b.lastT;
    return t || performance.now();
  }

  /** 按同一时间右边界重建各序列的可视列栅格。 */
  _layoutScale(endT) {
    this.nCols = Math.max(64, Math.floor(this.w - PAD.l - PAD.r));
    this.colPx = 1;
    this.drawnRight = 0;
    this.endT = endT;

    for (const d of this.defs) {
      const buf = this.buffers.get(d.id);
      if (!buf) continue;
      let g = this.grids.get(d.id);
      if (!g || g.nCols !== this.nCols) { g = new ColumnGrid(this.nCols); this.grids.set(d.id, g); }
      g.rebuild(buf, this.spanMs, endT);
    }
  }

  _visibleRange(g) {
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < this.nCols; c++) {
      if (!g.count[c]) continue;
      if (g.min[c] < lo) lo = g.min[c];
      if (g.max[c] > hi) hi = g.max[c];
    }
    return [lo, hi];
  }

  _drawBg(endT) {
    const ctx = this.cvBg.getContext('2d');
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#080c11';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(40,58,78,.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const y = PAD.t + ((h - PAD.t - PAD.b) * i) / 5;
      ctx.moveTo(PAD.l, Math.round(y) + 0.5);
      ctx.lineTo(w - PAD.r, Math.round(y) + 0.5);
    }
    for (let i = 0; i <= 6; i++) {
      const x = PAD.l + ((w - PAD.l - PAD.r) * i) / 6;
      ctx.moveTo(Math.round(x) + 0.5, PAD.t);
      ctx.lineTo(Math.round(x) + 0.5, h - PAD.b);
    }
    ctx.stroke();

    ctx.fillStyle = '#5e7186';
    ctx.font = '10px "SF Mono", ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    const right = endT;
    for (let i = 0; i <= 6; i++) {
      const x = PAD.l + ((w - PAD.l - PAD.r) * i) / 6;
      const t = right - this.spanMs + (this.spanMs * i) / 6;
      const s = Math.round((t - right) / 1000);
      ctx.fillText(s === 0 ? 'now' : `${s}s`, x, h - PAD.b + 15);
    }

    ctx.textAlign = 'left';
    let y = PAD.t + 10;
    for (const d of this.defs) {
      if (d._lo === undefined) continue;
      ctx.fillStyle = d.color;
      ctx.fillRect(6, y - 7, 6, 2);
      ctx.fillStyle = '#7f8fa3';
      ctx.fillText(d.name, 16, y - 1);
      y += 15;
    }
  }

  _initDataLayer() {
    this.dataCtx = this.cvData.getContext('2d', { alpha: true });
  }

  /** 只画 [c0, c1) 的列 */
  _drawCols(ctx, c0, c1, top, bot) {
    for (const d of this.defs) {
      const g = this.grids.get(d.id);
      if (!g || !g.colW || d._lo === undefined) continue;
      const scale = (bot - top) / (d._hi - d._lo || 1);
      ctx.beginPath();
      let started = false;
      for (let c = c0; c < c1; c++) {
        if (!g.count[c]) continue;
        const x = PAD.l + c + 0.5;
        const yf = bot - (g.first[c] - d._lo) * scale;
        if (!started) { ctx.moveTo(x, yf); started = true; } else ctx.lineTo(x, yf);
        const ymn = bot - (g.min[c] - d._lo) * scale;
        const ymx = bot - (g.max[c] - d._lo) * scale;
        if (ymn - ymx > 0.7) { ctx.lineTo(x, ymn); ctx.lineTo(x, ymx); }
        ctx.lineTo(x, bot - (g.last[c] - d._lo) * scale);
      }
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  /**
   * forceFull=true 时整幅重画；否则若只是时间向前推进了整数列、量程未变，
   * 就整幅左移 + 只补最右侧新增的列（脏区增量）。
   */
  _render(forceFull) {
    const ctx = this.cvData.getContext('2d');
    const top = PAD.t, bot = this.h - PAD.b;
    const g0 = this.grids.get(this.defs[0].id);
    if (!g0 || !g0.colW) return;

    const shiftCols = Math.round((g0.right - this.drawnRight) / g0.colW);
    let incremental =
      !forceFull &&
      this.drawnRight > 0 &&
      this.drawnSpan === this.spanMs &&
      this.drawnColPx === this.colPx &&
      shiftCols > 0 &&
      shiftCols < this.nCols * 0.5;

    if (incremental) {
      for (const d of this.defs) {
        const g = this.grids.get(d.id);
        if (!g || d._lo === undefined) continue;
        const [lo, hi] = this._visibleRange(g);
        if (!isFinite(lo)) continue;
        if (lo < d._lo || hi > d._hi) { incremental = false; break; }
      }
    }

    if (incremental) {
      const dx = shiftCols * this.colPx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, top, this.nCols, bot - top);
      ctx.clip();
      // 位图是物理像素，目标尺寸必须用 CSS 像素，否则高分屏每帧都会再次放大。
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(this.cvData, -dx, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(PAD.l + this.nCols - dx, top, dx, bot - top);
      this._drawCols(ctx, this.nCols - shiftCols - 1, this.nCols, top, bot);
      ctx.restore();
      this.incFrames++;
    } else {
      for (const d of this.defs) {
        const g = this.grids.get(d.id);
        if (!g) continue;
        const [lo, hi] = this._visibleRange(g);
        if (!isFinite(lo)) continue;
        const pad = (hi - lo) * 0.06 || 1;
        d._lo = lo - pad;
        d._hi = hi + pad;
      }
      ctx.clearRect(0, 0, this.w, this.h);
      this._drawCols(ctx, 0, this.nCols, top, bot);
      this.fullFrames++;
    }

    this.drawnRight = g0.right;
    this.drawnSpan = this.spanMs;
    this.drawnColPx = this.colPx;
  }

  _drawCursor() {
    const ctx = this.cvCursor.getContext('2d');
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.hover) return;
    const { x, y } = this.hover;
    if (x < PAD.l || x > this.w - PAD.r) return;

    ctx.strokeStyle = 'rgba(53,224,194,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, PAD.t);
    ctx.lineTo(Math.round(x) + 0.5, this.h - PAD.b);
    ctx.moveTo(PAD.l, Math.round(y) + 0.5);
    ctx.lineTo(this.w - PAD.r, Math.round(y) + 0.5);
    ctx.stroke();

    const col = Math.floor(x - PAD.l);
    const lines = [];
    for (const d of this.defs) {
      const g = this.grids.get(d.id);
      if (!g || !g.count || !g.count[col] || d._lo === undefined) continue;
      lines.push([d.color, `${d.name} ${g.last[col].toFixed(d.amp < 1 ? 3 : 1)} ${d.unit}`]);
    }
    if (!lines.length) return;

    ctx.font = '11px "SF Mono", ui-monospace, Menlo, monospace';
    const wBox = 168, hBox = 26 + lines.length * 15;
    let bx = x + 12;
    let by = Math.max(PAD.t, y - hBox / 2);
    if (bx + wBox > this.w - PAD.r) bx = x - wBox - 12;
    ctx.fillStyle = 'rgba(11,15,20,.94)';
    ctx.strokeStyle = 'rgba(53,224,194,.32)';
    ctx.beginPath();
    ctx.roundRect(bx, by, wBox, hBox, 5);
    ctx.fill();
    ctx.stroke();

    const g0 = this.grids.get(this.defs[0].id);
    const tt = g0.colStart(col) + g0.colW / 2;
    const dt = new Date(Date.now() - (performance.now() - tt));
    ctx.fillStyle = '#5e7186';
    ctx.fillText(dt.toLocaleTimeString('zh-CN', { hour12: false }), bx + 9, by + 14);
    lines.forEach(([color, text], i) => {
      ctx.fillStyle = color;
      ctx.fillText(text, bx + 9, by + 31 + i * 15);
    });
  }

  /** 同步刷新（供负载测量使用：把本该在 rAF 里做的事立刻做掉） */
  flushSync() {
    const force = this.invalidateView;
    if (force) this._layoutScale(this._latestT());
    this._render(force);
    if (force) this._drawBg(this._latestT());
    this.invalidateView = false;
    this.dirty = false;
  }

  /**
   * 回看全历史：视窗拉到整段数据跨度，重建列栅格并成图。
   * 重建全历史列栅格；后续缩放会按新窗口重新聚合。
   * @returns { ms, points, cols }
   */
  reviewFull() {
    const t0 = performance.now();
    let firstT = Infinity, lastT = -Infinity, total = 0;
    for (const [, b] of this.buffers) {
      if (!b.count) continue;
      if (b.firstT < firstT) firstT = b.firstT;
      if (b.lastT > lastT) lastT = b.lastT;
      total += b.count;
    }
    if (!isFinite(firstT)) return { ms: 0, points: 0 };

    this.spanMs = Math.max(2000, lastT - firstT);
    this.invalidateView = true;
    this._layoutScale(lastT);   // 全量聚合：1M 点 → nCols 列
    this._drawBg(lastT);
    this._render(true);

    return { ms: +(performance.now() - t0).toFixed(1), points: total, cols: this.nCols, spanMs: Math.round(this.spanMs) };
  }

  /** 全览状态下再整幅重绘一次（衡量"放大到全局后拖一次"的成本） */
  redrawFull() {
    const t0 = performance.now();
    this._render(true);
    return +(performance.now() - t0).toFixed(2);
  }

  dispose() {
    this.stopLoop();
    this._ro && this._ro.disconnect();
    this.host.removeEventListener('mousemove', this._onMove);
    this.host.removeEventListener('mouseleave', this._onLeave);
    this.host.removeEventListener('wheel', this._onWheel);
    this.host.innerHTML = '';
  }
}
