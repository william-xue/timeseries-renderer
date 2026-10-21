/**
 * 定长环形缓冲：承载单条时序，容量固定，写入零分配。
 * 关键性质：
 *  - 追加 O(1)，不产生 GC 压力（这是"跑十分钟就卡死"的第一号死因：数组 push + shift）
 *  - 逻辑下标 0 = 最旧，count-1 = 最新
 *  - 时间有序，二分查找可达 O(log n)
 */
export class SeriesBuffer {
  constructor(capacity) {
    this.cap = capacity;
    this.t = new Float64Array(capacity); // 采样时刻（epoch ms）
    this.v = new Float32Array(capacity); // 数值
    this.head = 0;   // 下一个写入位置
    this.count = 0;  // 有效元素数（<= cap）
  }

  /** 物理下标 ← 逻辑下标 */
  phys(i) {
    const start = this.count === this.cap ? this.head : 0;
    let p = start + i;
    if (p >= this.cap) p -= this.cap;
    return p;
  }

  tAt(i) { return this.t[this.phys(i)]; }
  vAt(i) { return this.v[this.phys(i)]; }

  push(t, v) {
    const p = this.head;
    this.t[p] = t;
    this.v[p] = v;
    this.head = p + 1 === this.cap ? 0 : p + 1;
    if (this.count < this.cap) this.count++;
  }

  /** 批量写入（typed array 直接写，避免逐点函数调用） */
  pushMany(ts, vs) {
    const n = ts.length;
    for (let k = 0; k < n; k++) this.push(ts[k], vs[k]);
  }

  /** 第一个 t >= target 的逻辑下标（无则 count） */
  lowerBound(target) {
    let lo = 0, hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.tAt(mid) < target) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** 最后一个 t <= target 的逻辑下标 + 1（无则 0） */
  upperBound(target) {
    let lo = 0, hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.tAt(mid) <= target) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  get firstT() { return this.count ? this.tAt(0) : 0; }
  get lastT() { return this.count ? this.tAt(this.count - 1) : 0; }
  get lastV() { return this.count ? this.vAt(this.count - 1) : 0; }
}
