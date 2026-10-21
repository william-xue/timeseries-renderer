#!/usr/bin/env bash
# 把主仓里的渲染核心同步进本包（单向：industrial-timeseries → timeseries-renderer）
# 包里这 4 个文件是逐字节拷贝，不在包内直接修改；改动请在主仓做，再跑这个脚本。
set -euo pipefail
SRC="${1:-../industrial-timeseries}"
cd "$(dirname "$0")/.."
cp "$SRC/js/util/ringbuffer.js"      src/core/util/
cp "$SRC/js/util/columns.js"         src/core/util/
cp "$SRC/js/engines/engine-canvas.js" src/core/engines/
cp "$SRC/js/engines/engine-webgl.js"  src/core/engines/
shasum -a 256 src/core/util/*.js src/core/engines/*.js > src/core/.checksums.txt
echo "已同步自 $SRC"
cat src/core/.checksums.txt
