#!/usr/bin/env bash
set -euo pipefail

# 智能问答前端产物同步脚本：编译前端并自动同步至后端 static 目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_STATIC_DIR="$(cd "${ROOT_DIR}/../AI-empowerment" && pwd)/src/main/resources/static"

echo "==> 1. 正在编译前端工程 (npm run build)..."
cd "${ROOT_DIR}"
npm run build

echo "==> 2. 清理并准备后端 static 目录: ${BACKEND_STATIC_DIR}..."
mkdir -p "${BACKEND_STATIC_DIR}"
rm -rf "${BACKEND_STATIC_DIR:?}"/*

echo "==> 3. 正在同步前端 dist 产物至后端 static..."
cp -r "${ROOT_DIR}/dist/." "${BACKEND_STATIC_DIR}/"

echo "==> 4. 同步完成！前端静态产物已就绪于后端工程。"
