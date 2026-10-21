#!/usr/bin/env bash
# 把主仓 demo 发布到目标目录，并把 timeseries-renderer 包一起带上（替换 import map 指向）
#
# 用法：
#   bash scripts/publish-bench.sh <dest-dir> site|showcase
#
#   site      → 个人站静态目录：只放运行必需的（不要 README/文章/结果/交接文档）
#   showcase  → Vercel showcase 目录：保留 PRODUCT.md / HANDOFF.md / docs
#
# 为什么要带包：demo 里 engine-canvas / engine-webgl 已经改为 import 'timeseries-renderer'，
# 浏览器靠 index.html 的 import map 解析这个裸标识符。静态站没有 node_modules，
# 所以把包的 src 拷到 vendor/timeseries-renderer/ 并把 map 指过去。
set -euo pipefail
cd "$(dirname "$0")/.."          # 包根
PKG="$PWD"
SRC_DEMO="$PKG/../industrial-timeseries"
DEST="$1"
MODE="${2:-site}"

[ -d "$DEST" ] || { echo "目标目录不存在: $DEST"; exit 1; }

case "$MODE" in
  site)
    RSYNC_EXCL=(--exclude 'results/' --exclude 'README.md' --exclude 'ARTICLE.md'
                --exclude 'HANDOFF.md' --exclude 'PRODUCT.md' --exclude 'docs/'
                --exclude '.vercel/' --exclude '.gitignore' --exclude '.DS_Store')
    MAP_PATH="./vendor/timeseries-renderer/src/index.js"
    ;;
  showcase)
    RSYNC_EXCL=(--exclude '.vercel/' --exclude '.gitignore' --exclude '.DS_Store')
    MAP_PATH="./vendor/timeseries-renderer/src/index.js"
    ;;
  *) echo "mode 只能是 site 或 showcase"; exit 1;;
esac

rsync -a --delete "${RSYNC_EXCL[@]}" "$SRC_DEMO"/ "$DEST"/

# 带包（只带 src，examples/test 不需要）
rm -rf "$DEST/vendor/timeseries-renderer"
mkdir -p "$DEST/vendor/timeseries-renderer"
cp -R "$PKG/src" "$DEST/vendor/timeseries-renderer/src"
cp "$PKG/package.json" "$DEST/vendor/timeseries-renderer/"

# 重写 import map：本地 ../timeseries-renderer → 站内 vendor
python3 - "$DEST/index.html" "$MAP_PATH" <<'PY'
import re, sys
path, target = sys.argv[1], sys.argv[2]
s = open(path).read()
s2 = re.sub(r'("timeseries-renderer"\s*:\s*")[^"]+(")', lambda m: m.group(1) + target + m.group(2), s)
if s2 == s and target not in s:
    sys.exit("index.html 里没找到 timeseries-renderer 的 import map 条目")
open(path, "w").write(s2)
print(f"import map → {target}")
PY

echo "已发布 $MODE → $DEST"
find "$DEST/vendor/timeseries-renderer" -name '*.js' | sed "s|$DEST/||" | sort
