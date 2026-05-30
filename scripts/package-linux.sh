#!/usr/bin/env bash
# =============================================================================
# 打包 Linux amd64 分发包
# 用法: bash scripts/package-linux.sh <app_name> <version> <build_dir> <engine_dir>
# =============================================================================
set -euo pipefail

APP_NAME="${1:?用法: $0 <app_name> <version> <build_dir> <engine_dir>}"
VERSION="${2:?}"
BUILD_DIR="${3:?}"
ENGINE_DIR="${4:?}"

ARCHIVE_NAME="${APP_NAME}-linux-amd64-v${VERSION}"
STAGE_DIR="/tmp/${APP_NAME}-stage"

echo "=== 打包 Linux 分发包: ${ARCHIVE_NAME}.tar.gz ==="

# 1. 清理 staging 目录
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}"

# 2. 复制二进制
cp "${BUILD_DIR}/${APP_NAME}" "${STAGE_DIR}/${APP_NAME}"
chmod +x "${STAGE_DIR}/${APP_NAME}"

# 3. 复制 engine 目录（jar + jre）
if [ -d "${ENGINE_DIR}/bin" ]; then
    mkdir -p "${STAGE_DIR}/engine/bin"
    cp -r "${ENGINE_DIR}/bin/"* "${STAGE_DIR}/engine/bin/"
fi
if [ -d "${ENGINE_DIR}/jre" ]; then
    mkdir -p "${STAGE_DIR}/engine/jre"
    cp -r "${ENGINE_DIR}/jre/"* "${STAGE_DIR}/engine/jre/"
fi

# 4. 生成启动脚本
cat > "${STAGE_DIR}/run.sh" << 'LAUNCHER'
#!/usr/bin/env bash
# IDB Desktop 启动脚本
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="${SCRIPT_DIR}/engine/jre/lib:${LD_LIBRARY_PATH:-}"
exec "${SCRIPT_DIR}/idb_desktop" "$@"
LAUNCHER
chmod +x "${STAGE_DIR}/run.sh"

# 5. 生成 README
cat > "${STAGE_DIR}/README.txt" << EOF
IDB Desktop v${VERSION}
======================

安装说明:
  1. 解压到任意目录
  2. 运行 ./idb_desktop 或 ./run.sh

前置条件:
  - 无需预装 Java（已内置 JRE）
  - 需要 GTK3 和 WebKit2GTK（Ubuntu/Debian: sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0）

目录结构:
  idb_desktop        — 主程序
  run.sh             — 启动脚本（自动设置 LD_LIBRARY_PATH）
  engine/bin/*.jar   — 数据引擎
  engine/jre/        — 内置 JRE
EOF

# 6. 打包 tar.gz
mkdir -p "${BUILD_DIR}"
tar czf "${BUILD_DIR}/${ARCHIVE_NAME}.tar.gz" -C /tmp "${APP_NAME}-stage"
mv "${BUILD_DIR}/${APP_NAME}-stage" "${BUILD_DIR}/${ARCHIVE_NAME}" 2>/dev/null || true

# 7. 清理 staging
rm -rf "${STAGE_DIR}"

echo "=== 完成: ${BUILD_DIR}/${ARCHIVE_NAME}.tar.gz ==="
