/**
 * 列栅格（Column Grid）—— 大数据量时序渲染的核心数据结构。
 *
 * 思路：把时间轴切成"像素列"，每列只保留 4 个数（min / max / first / last）。
 * 无论窗口里有 4 千点还是 100 万点，绘制成本都只与"像素宽度"成正比（~1200 列），
 * 与数据量解耦 —— 这是自研渲染层能做到 100 万点仍 60fps 的根本原因。
 *
 * 为什么用 min/max 而不是均值或 LTTB：
 * 工业场景关心的是尖峰（越限、冲击、故障瞬间）。均值/抽样会把 1 个点的尖峰吃掉，
 * min/max 保证任何尖峰只要存在就一定会出现在画面上——这是"不能骗人"的底线。
 */

export class ColumnGrid {
  constructor(nCols) {
    this.nCols = nCols;
    this.colW = 0;         // 每列毫秒
    this.right = 0;        // 右边界（对齐到列栅格）
    this.min = new Float32Array(nCols).fill(Infinity);
    this.max = new Float32Array(nCols).fill(-Infinity);
    this.first = new Float32Array(nCols).fill(NaN);
    this.last = new Float32Array(nCols).fill(NaN);
    this.count = new Uint32Array(nCols);
  }

  /** 第 col 列覆盖的时间区间 [t0, t1) */
  colStart(col) { return this.right - (this.nCols - col) * this.colW; }

  clear() {
    this.min.fill(Infinity);
    this.max.fill(-Infinity);
    this.first.fill(NaN);
    this.last.fill(NaN);
    this.count.fill(0);
  }

  /** 全量重建：仅在视窗/尺寸变化时调用，O(窗口内点数) */
  rebuild(buf, spanMs, endT) {
    this.colW = spanMs / this.nCols;
    this.right = Math.ceil(endT / this.colW) * this.colW;
    this.clear();

    const t0 = this.right - spanMs;
    const lo = buf.lowerBound(t0);
    const hi = buf.count;
    for (let i = lo; i < hi; i++) {
      const t = buf.tAt(i);
      let col = Math.floor((t - t0) / this.colW);
      if (col < 0) col = 0;
      if (col >= this.nCols) col = this.nCols - 1;
      this._merge(col, t, buf.vAt(i));
    }
    this.filled = hi - lo;
  }

  _merge(col, t, v) {
    if (Number.isNaN(this.first[col])) { this.first[col] = v; }
    this.last[col] = v;
    if (v < this.min[col]) this.min[col] = v;
    if (v > this.max[col]) this.max[col] = v;
    this.count[col]++;
  }

  /**
   * 增量追加：直播场景只做这一步（O(新增点数)），不做全量重算。
   * 一旦新点越过了右边界，整栅格左移 N 列（copyWithin，O(宽度)），
   * 因此视窗是"按列步进"滚动的——这是工业 HMI 的常规做法，肉眼无差别。
   */
  append(buf, fromIdx, toIdx) {
    if (!this.colW) return;
    const span = this.nCols * this.colW;
    for (let i = fromIdx; i < toIdx; i++) {
      const t = buf.tAt(i);
      const v = buf.vAt(i);
      const col = Math.floor((t - (this.right - span)) / this.colW);
      if (col >= this.nCols) {
        const shift = col - this.nCols + 1;
        this._shift(shift);
        const c2 = this.nCols - 1;
        this._merge(c2, t, v);
      } else if (col >= 0) {
        this._merge(col, t, v);
      }
    }
    this.filled = (this.filled || 0) + (toIdx - fromIdx);
  }

  _shift(n) {
    if (n >= this.nCols) { this.clear(); this.right += n * this.colW; return; }
    const k = this.nCols - n;
    for (const a of [this.min, this.max, this.first, this.last]) a.copyWithin(0, n, this.nCols);
    this.count.copyWithin(0, n, this.nCols);
    this.min.fill(Infinity, k); this.max.fill(-Infinity, k);
    this.first.fill(NaN, k); this.last.fill(NaN, k); this.count.fill(0, k);
    this.right += n * this.colW;
  }
}
