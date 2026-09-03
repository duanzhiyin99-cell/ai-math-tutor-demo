#!/bin/bash
# AI 数学学习助手 · MVP Demo 启动器（macOS 双击运行，也可在终端执行 ./start.command）
cd "$(dirname "$0")"

# 1) 自动定位 Node.js：系统 PATH → 常见安装路径 → Codex 内置运行时
NODE_BIN=""
for candidate in \
  "$(command -v node 2>/dev/null)" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node" \
  "/Users/zhiyin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
  ; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
done

if [ -z "$NODE_BIN" ]; then
  echo ""
  echo "❌ 未找到 Node.js，请先安装：https://nodejs.org（LTS 版本）后重试。"
  echo ""
  read -p "按回车键退出..." _
  exit 1
fi

echo "✅ 使用 Node: $NODE_BIN"
echo ""
echo "正在启动 AI 数学学习助手 Demo ..."
echo "访问地址：http://localhost:8080 （浏览器会自动打开）"
echo "按 Ctrl+C 可停止服务"
echo ""

"$NODE_BIN" server.js &
SERVER_PID=$!

# 等待服务就绪后打开浏览器
for i in $(seq 1 15); do
  if curl -s -m 1 -o /dev/null "http://127.0.0.1:8080/"; then
    open "http://localhost:8080"
    break
  fi
  sleep 0.5
done

wait $SERVER_PID
