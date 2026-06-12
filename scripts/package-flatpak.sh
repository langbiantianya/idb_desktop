#!/usr/bin/env bash
# =============================================================================
# 打包 Flatpak bundle
# 用法: bash scripts/package-flatpak.sh <app_name> <version> <build_dir> <engine_dir> <arch>
# 前提: flatpak + flatpak-builder 已安装
# =============================================================================
set -euo pipefail

APP_NAME="${1:?用法: $0 <app_name> <version> <build_dir> <engine_dir> <arch>}"
VERSION="${2:?}"
BUILD_DIR="${3:?}"
ENGINE_DIR="${4:?}"
PLATFORM="${5:?}"

ARCH_SUFFIX="${PLATFORM#linux/}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="${PROJECT_DIR}/flatpak/org.idb.desktop.yml"
APP_ID="org.idb.desktop"
STAGING_DIR="${PROJECT_DIR}/flatpak/staging"
BUILD_REPO="${PROJECT_DIR}/flatpak/repo"
BUILDDIR="${PROJECT_DIR}/flatpak/builddir"

# 检测工具
for cmd in flatpak flatpak-builder; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "错误: $cmd 未安装"; exit 1
    fi
done

echo "=== 构建 Flatpak (${ARCH_SUFFIX}) ==="

# 1. 添加 Flathub remote（如无）
if ! flatpak remote-list | grep -q flathub; then
    echo "添加 Flathub remote ..."
    flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
fi

# 2. 安装 runtime + SDK
echo "安装 Freedesktop runtime + SDK 23.08 ..."
flatpak install -y --noninteractive flathub org.freedesktop.Platform//23.08 org.freedesktop.Sdk//23.08 2>/dev/null || true

# 3. 准备 staging 目录（Flatpak sources 从这里读取）
rm -rf "${STAGING_DIR}"
mkdir -p "${STAGING_DIR}"

# 二进制
cp "${BUILD_DIR}/${APP_NAME}" "${STAGING_DIR}/${APP_NAME}"
chmod 755 "${STAGING_DIR}/${APP_NAME}"

# 引擎
if [ -d "${ENGINE_DIR}/bin" ]; then
    mkdir -p "${STAGING_DIR}/engine/bin"
    cp -r "${ENGINE_DIR}/bin/"* "${STAGING_DIR}/engine/bin/"
fi
if [ -d "${ENGINE_DIR}/jre" ]; then
    mkdir -p "${STAGING_DIR}/engine/jre"
    cp -r "${ENGINE_DIR}/jre/"* "${STAGING_DIR}/engine/jre/"
fi

# 桌面集成文件
cp "${PROJECT_DIR}/build/linux/idb_desktop.desktop" "${STAGING_DIR}/"
cp "${PROJECT_DIR}/build/appicon.png" "${STAGING_DIR}/icon.png"
cp "${PROJECT_DIR}/build/linux/idb_desktop.metainfo.xml" "${STAGING_DIR}/"

# 4. 清理旧构建
rm -rf "${BUILDDIR}" "${BUILD_REPO}"

# 5. 构建
flatpak-builder --force-clean --repo="${BUILD_REPO}" "${BUILDDIR}" "${MANIFEST}"

# 6. 导出 bundle
mkdir -p "${BUILD_DIR}"
flatpak build-bundle "${BUILD_REPO}" \
    "${BUILD_DIR}/${APP_NAME}-linux-v${VERSION}.flatpak" \
    "${APP_ID}"

# 7. 清理 staging
rm -rf "${STAGING_DIR}" "${BUILD_REPO}" "${BUILDDIR}"

echo "=== 完成: ${BUILD_DIR}/${APP_NAME}-linux-v${VERSION}.flatpak ==="
