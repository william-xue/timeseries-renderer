/** WebGL曲线层：复用CanvasEngine的数据、坐标轴和交互，只持有GPU资源。 */
import { CanvasEngine, PAD } from './engine-canvas.js';

export class WebGLEngine extends CanvasEngine {
  _initDataLayer() {
    const gl = this.cvData.getContext('webgl2', { alpha: true, antialias: true, depth: false });
    if (!gl) throw new Error('当前浏览器无法创建 WebGL2 曲线上下文');
    this.gl = gl;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('曲线着色器编译失败：' + message);
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      in vec4 aSegment;
      uniform vec2 uSize;
      void main() {
        vec2 delta = aSegment.zw - aSegment.xy;
        vec2 normal = vec2(-delta.y, delta.x) / max(length(delta), 0.001);
        float side = gl_VertexID % 2 == 0 ? -1.0 : 1.0;
        vec2 endpoint = gl_VertexID < 2 ? aSegment.xy : aSegment.zw;
        vec2 position = endpoint + normal * side * 0.7;
        vec2 clip = position / uSize * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      }
    `);
    const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      uniform vec3 uColor;
      out vec4 color;
      void main() { color = vec4(uColor, 1.0); }
    `);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertex);
    gl.attachShader(this.program, fragment);
    gl.linkProgram(this.program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('曲线着色器链接失败：' + gl.getProgramInfoLog(this.program));
    }
    this.vertexBuffer = gl.createBuffer();
    this.segmentLocation = gl.getAttribLocation(this.program, 'aSegment');
    this.sizeLocation = gl.getUniformLocation(this.program, 'uSize');
    this.colorLocation = gl.getUniformLocation(this.program, 'uColor');
  }

  _render(forceFull) {
    const gl = this.gl;
    const top = PAD.t, bot = this.h - PAD.b;
    const sx = this.cvData.width / this.w, sy = this.cvData.height / this.h;
    gl.viewport(0, 0, this.cvData.width, this.cvData.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.ceil(PAD.l * sx), Math.ceil(PAD.b * sy),
      Math.floor(this.nCols * sx), Math.floor((bot - top) * sy));
    gl.useProgram(this.program);
    gl.uniform2f(this.sizeLocation, this.w, this.h);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(this.segmentLocation);
    gl.vertexAttribPointer(this.segmentLocation, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.segmentLocation, 1);

    const vertices = this.segments;
    let count = 0;
    const segment = (x0, y0, x1, y1) => {
      vertices[count++] = x0; vertices[count++] = y0;
      vertices[count++] = x1; vertices[count++] = y1;
    };
    for (const d of this.defs) {
      const g = this.grids.get(d.id);
      if (!g || !g.colW) continue;
      const [lo, hi] = this._visibleRange(g);
      if (!isFinite(lo)) continue;
      if (forceFull || d._lo === undefined || lo < d._lo || hi > d._hi) {
        const pad = (hi - lo) * 0.06 || 1;
        d._lo = lo - pad; d._hi = hi + pad;
      }
      const scale = (bot - top) / (d._hi - d._lo);
      count = 0;
      let previousX, previousY;
      for (let c = 0; c < this.nCols; c++) {
        if (!g.count[c]) continue;
        const x = PAD.l + c + 0.5;
        const firstY = bot - (g.first[c] - d._lo) * scale;
        const minY = bot - (g.min[c] - d._lo) * scale;
        const maxY = bot - (g.max[c] - d._lo) * scale;
        const lastY = bot - (g.last[c] - d._lo) * scale;
        if (previousX !== undefined) segment(previousX, previousY, x, firstY);
        segment(x, firstY, x, minY);
        segment(x, minY, x, maxY);
        segment(x, maxY, x, lastY);
        previousX = x; previousY = lastY;
      }
      const color = parseInt(d.color.slice(1), 16);
      gl.uniform3f(this.colorLocation, (color >> 16) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
      gl.bufferData(gl.ARRAY_BUFFER, vertices.subarray(0, count), gl.DYNAMIC_DRAW);
      // 每个实例是一条 1.4 CSS 像素宽的线段，避免依赖设备支持的原生线宽。
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count / 4);
    }
    gl.disable(gl.SCISSOR_TEST);
    this.fullFrames++;
  }

  resize() {
    super.resize();
    // 每列最多四条线段，每条线段保存两端点；各序列复用这块CPU缓冲。
    this.segments = new Float32Array(Math.max(64, this.w - PAD.l - PAD.r) * 16);
  }

  dispose() {
    this.gl.useProgram(null);
    this.gl.deleteBuffer(this.vertexBuffer);
    this.gl.deleteProgram(this.program);
    super.dispose();
  }
}
