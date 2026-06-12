#!/usr/bin/env bash
# =============================================================================
# 打包 Linux tar.gz 分发包
# 用法: bash scripts/package-linux.sh <app_name> <version> <build_dir> <engine_dir> [arch]
# arch: linux/amd64 (默认) | linux/arm64
# =============================================================================
set -euo pipefail

APP_NAME="${1:?用法: $0 <app_name> <version> <build_dir> <engine_dir> [arch]}"
VERSION="${2:?}"
BUILD_DIR="${3:?}"
ENGINE_DIR="${4:?}"
PLATFORM="${5:-linux/amd64}"

# 从 platform 推导架构后缀
ARCH_SUFFIX="${PLATFORM#linux/}"

ARCHIVE_NAME="${APP_NAME}-linux-${ARCH_SUFFIX}-v${VERSION}"
STAGE_DIR="/tmp/${APP_NAME}-stage"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== 打包 Linux ${ARCH_SUFFIX} tar.gz: ${ARCHIVE_NAME}.tar.gz ==="

# 1. 清理 staging
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}"

# 2. 复制二进制
cp "${BUILD_DIR}/${APP_NAME}" "${STAGE_DIR}/${APP_NAME}"
chmod +x "${STAGE_DIR}/${APP_NAME}"

# 3. 复制 engine（jar + jre）
if [ -d "${ENGINE_DIR}/bin" ]; then
    mkdir -p "${STAGE_DIR}/engine/bin"
    cp -r "${ENGINE_DIR}/bin/"* "${STAGE_DIR}/engine/bin/"
fi
if [ -d "${ENGINE_DIR}/jre" ]; then
    mkdir -p "${STAGE_DIR}/engine/jre"
    cp -r "${ENGINE_DIR}/jre/"* "${STAGE_DIR}/engine/jre/"
fi

# 4. 桌面集成文件
if [ -f "${PROJECT_DIR}/build/linux/idb_desktop.desktop" ]; then
    cp "${PROJECT_DIR}/build/linux/idb_desktop.desktop" "${STAGE_DIR}/"
fi
if [ -f "${PROJECT_DIR}/build/linux/idb_desktop.metainfo.xml" ]; then
    cp "${PROJECT_DIR}/build/linux/idb_desktop.metainfo.xml" "${STAGE_DIR}/"
fi
if [ -f "${PROJECT_DIR}/build/appicon.png" ]; then
    mkdir -p "${STAGE_DIR}/share/icons/hicolor/512x512/apps"
    cp "${PROJECT_DIR}/build/appicon.png" "${STAGE_DIR}/share/icons/hicolor/512x512/apps/${APP_NAME}.png"
fi

# 5. 启动脚本
cat > "${STAGE_DIR}/run.sh" << 'LAUNCHER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="${SCRIPT_DIR}/engine/jre/lib:${LD_LIBRARY_PATH:-}"
exec "${SCRIPT_DIR}/idb_desktop" "$@"
LAUNCHER
chmod +x "${STAGE_DIR}/run.sh"

# 6. README
cat > "${STAGE_DIR}/README.txt" << EOF
IDB Desktop v${VERSION} (${ARCH_SUFFIX})
==================================

安装说明:
  1. 解压到任意目录
  2. 运行 ./idb_desktop 或 ./run.sh

前置条件 (系统包):
  Ubuntu/Debian: sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0
  Fedora:        sudo dnf install gtk3 webkit2gtk4.1

目录结构:
  idb_desktop                          — 主程序
  run.sh                               — 启动脚本（自动设置 LD_LIBRARY_PATH）
  engine/bin/*.jar                     — 数据引擎
  engine/jre/                          — 内置 JRE
  idb_desktop.desktop                  — FreeDesktop 桌面入口
  share/icons/hicolor/512x512/apps/    — 应用图标
EOF

# 7. 打包
mkdir -p "${BUILD_DIR}"
tar czf "${BUILD_DIR}/${ARCHIVE_NAME}.tar.gz" -C /tmp "${APP_NAME}-stage"

# 8. 清理
rm -rf "${STAGE_DIR}"

echo "=== 完成: ${BUILD_DIR}/${ARCHIVE_NAME}.tar.gz ==="
