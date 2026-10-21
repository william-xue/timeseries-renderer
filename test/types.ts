// 类型用例：只用来验证 index.d.ts 是否说得对，不参与运行时。
// 跑法：npx -y typescript@5 tsc -p test/tsconfig.json
import createTimeSeries, {
  createTimeSeries as named,
  type Samples,
  type SeriesDef,
  type ReviewResult,
  CanvasEngine,
  WebGLEngine,
  SeriesBuffer,
  ColumnGrid,
} from '../src/index.js';

const host = document.createElement('div');

const series: SeriesDef[] = [
  { id: 'p', name: '机组有功', color: '#35e0c2', unit: 'MW' },
  { id: 'f', color: '#ffd166', amp: 0.03 },
];

const chart = createTimeSeries(host, {
  series,
  span: 60000,
  engine: 'webgl',
  onDrawn: (ts: number) => { void (performance.now() - ts); },
  autoStart: false,
});

const sameInstance = named(host, { series });

// 三种输入形态
const one: Samples = { id: 'p', t: performance.now(), v: 320.5 };
const many: Samples = [{ id: 'p', t: Date.now(), v: 1 }, { id: 'f', t: Date.now(), v: 50 }];
const native: Samples = {
  series: [{ id: 'p', t: new Float64Array([1, 2]), v: new Float32Array([3, 4]) }],
};

chart.load(many);
chart.push(one);
chart.push(native);
chart.setViewport({ span: 120000 });

const r: ReviewResult = chart.review();
const cols: number = r.cols;
const stats = chart.stats();

const engine = chart.engine;
if (engine instanceof WebGLEngine) {
  const gl: WebGL2RenderingContext = engine.gl;
  void gl;
} else if (engine instanceof CanvasEngine) {
  const ctx = engine.dataCtx;
  void ctx;
}

chart.dispose();
sameInstance.dispose();

// 底层类型可用
const buf = new SeriesBuffer(1024);
buf.push(Date.now(), 1);
const i: number = buf.lowerBound(Date.now());
const grid = new ColumnGrid(800);
grid.rebuild(buf, 60000, Date.now());
void i; void grid; void cols; void stats;
