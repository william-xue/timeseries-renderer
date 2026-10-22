# timeseries-renderer

[![npm](https://img.shields.io/npm/v/timeseries-renderer.svg)](https://www.npmjs.com/package/timeseries-renderer)
[![license](https://img.shields.io/npm/l/timeseries-renderer.svg)](./LICENSE)
[![types](https://img.shields.io/badge/types-included-blue.svg)](./src/index.d.ts)

百万点时序曲线的渲染层：环形缓冲 + 像素列栅格 + 脏区增量绘制 + 可选 WebGL2 后端。

它只解决"画"这一段——不取数、不管框架、不做图表类型。目标是让 100 万点、6 路信号、秒级刷新的曲线，
在普通机器上稳在 60fps，并且能一键回看三小时全历史。

```js
import { createTimeSeries } from 'timeseries-renderer'

const chart = createTimeSeries(document.getElementById('chart'), {
  series: [
    { id: 'p', name: '机组有功', unit: 'MW', color: '#35e0c2' },
    { id: 'f', name: '系统频率', unit: 'Hz', color: '#ffd166' },
  ],
  span: 60000,          // 可视窗口 60 秒
  engine: 'canvas',     // 或 'webgl'
})

chart.load(history)     // 一次性历史：[{ id, t, v }]
chart.push(batch)       // 实时：单点 / 点数组 / 原生批次都行
chart.review()          // 回看全历史 → { ms, points, cols }
```

无构建步骤，ESM 直接可用；只需一个真实 DOM 容器（引擎内部会叠三张 canvas）。

## 安装

```bash
npm i timeseries-renderer
```

自带类型，不需要 `@types/…`。也可以直接指向仓库：

```json
{ "dependencies": { "timeseries-renderer": "github:william-xue/timeseries-renderer" } }
```

## API

| 方法 | 说明 |
|---|---|
| `createTimeSeries(el, opts)` | `el` 是容器（传 `<canvas>` 会自动套一层）；返回实例 |
| `.load(samples)` | 灌历史，返回 `{ loadMs, points }` |
| `.push(samples)` | 推实时数据 |
| `.setViewport({ span })` | 改可视窗口（毫秒） |
| `.review()` | 视窗拉到整段历史并成图，返回 `{ ms, points, cols }` |
| `.redraw()` | 全览下再整幅重绘一次，返回毫秒 |
| `.stats()` | `{ points, cols, fullFrames, incFrames }` |
| `.engine` | 底层引擎（逃生口，可调 `setSpan` 等） |
| `.dispose()` | 释放监听与画布 |

`opts`：`series`（必填）、`span`（默认 60000）、`engine`（`'canvas'` / `'webgl'`）、
`onDrawn(ts)`（每帧上屏回调，`ts` 是触发该帧的采样时间戳，可用来算端到端延迟）、
`onFrame()`、`autoStart`（默认 true）。

`series` 每项：`{ id, color, name?, unit?, amp? }`。`amp` 只影响读数小数位。

## TypeScript

自带类型声明（`src/index.d.ts`），无需 `@types` 包：

```ts
import createTimeSeries, { type Samples, type ReviewResult } from 'timeseries-renderer'

const chart = createTimeSeries(el, {
  series: [{ id: 'p', color: '#35e0c2', unit: 'MW' }],
  engine: 'webgl',          // 只接受 'canvas' | 'webgl'
})
```

类型会挡住缺字段、错字段、错枚举：`series` 少 `color`、`push({ id })` 缺 `t/v`、
`engine: 'webgpu'` 都会在编译期报错（已用负向用例验证过）。

校验命令：

```bash
npm run test:types     # tsc -p test/tsconfig.json（strict）
```

## 数据契约

一个采样点 = `{ id, t, v }`：

- `t` 毫秒时间戳，必须单调递增
- 三种输入形态都接受：单点、点数组、引擎原生 `{ series: [{ id, t: Float64Array, v: Float32Array }] }`
- 未知 `id`、缺 `color`、空 `series` 会直接抛错（宁可早失败）

## 它和 ECharts 的差别

|  | timeseries-renderer | ECharts |
|---|---|---|
| 100 万点回看全历史 | 10–50 ms（一次 O(n) 聚合） | 数百 ms（重建对象数组 + 全量 diff） |
| 交互生态 | 只有十字光标读数 | tooltip / legend / dataZoom / 导出图片 / 主题 |
| 接入成本 | 一个函数 + 一个容器 | 一份 option |
| 适用 | 工业 HMI、监控大屏、需要百万点+回看 | 报表、看板、一次性图表 |

**大多数场景应该用 ECharts。** 只有当"百万点 + 多路 + 长历史回看 + 现场弱机器"这几件事同时成立，
自研渲染层才划算。判断依据见姐妹项目里的基准（同数据、同机、同窗口对比四种后端）。

## 目录

```
src/index.js                     入口：createTimeSeries，输入归一化 + 生命周期
src/core/util/ringbuffer.js      定长环形缓冲（写入零分配）
src/core/util/columns.js         列栅格：每列只存 min/max/first/last
src/core/engines/engine-canvas.js  三层画布 + 画列 + 脏区增量绘制
src/core/engines/engine-webgl.js   同一份列数据，改由 GPU 画（每帧全量重建）
examples/basic.html              最小示例（100 万点 + 实时流 + 回看）
test/smoke.html                  浏览器端冒烟测试（18 项，两种后端各跑一遍）
scripts/sync-core.sh             从主仓同步渲染核心（单向拷贝）
```

`src/core/` 下四个文件是主仓 `industrial-timeseries/js/` 的逐字节拷贝，
**不要在包内直接改**；改主仓，再跑 `npm run sync-core`。这样基准页和包永远同一份实现。

## 本地跑

```bash
npx serve .          # 或 python3 -m http.server 8766
# 示例      http://127.0.0.1:8766/examples/basic.html
# 冒烟测试  http://127.0.0.1:8766/test/smoke.html
```

ESM 必须走 HTTP，`file://` 打开会被 CORS 拦。

## 已知限制

- 只有 Canvas 2D 与 WebGL2 两条路径，**没有 WebGPU**；1000 万点级别需要服务端降采样
- WebGL 后端每帧全量重建并上传，未做增量——实时流下不比 Canvas 2D 快（实测 12.0 vs 11.0 ms）
- 交互只有十字光标读数：没有 tooltip/legend/dataZoom/导出图片/主题/无障碍
- 序列数验证到 6 路，20/50 路未测
- 配色、内边距、字体是写死的，改主题需要改 `engine-canvas.js` 里的常量
- 时区/本地化未处理，时间轴刻度是相对秒数（`-30s` / `now`）

## License

MIT
