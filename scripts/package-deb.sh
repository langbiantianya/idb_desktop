#!/usr/bin/env bash
# =============================================================================
# 打包 Linux .deb 包
# 用法: bash scripts/package-deb.sh <app_name> <version> <build_dir> <engine_dir> <arch>
# arch: linux/amd64 | linux/arm64
# =============================================================================
set -euo pipefail

APP_NAME="${1:?用法: $0 <app_name> <version> <build_dir> <engine_dir> <arch>}"
VERSION="${2:?}"
BUILD_DIR="${3:?}"
ENGINE_DIR="${4:?}"
PLATFORM="${5:?}"

ARCH_SUFFIX="${PLATFORM#linux/}"
DEB_ARCH="${ARCH_SUFFIX}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEB_NAME="idb-desktop"
STAGE_DIR="/tmp/${APP_NAME}-deb-stage"
DEB_DIR="${STAGE_DIR}/${DEB_NAME}_${VERSION}_${DEB_ARCH}"

echo "=== 构建 .deb (${DEB_ARCH}) ==="

# 清理
rm -rf "${STAGE_DIR}"
mkdir -p "${DEB_DIR}"

# ---- DEBIAN/control ----
mkdir -p "${DEB_DIR}/DEBIAN"
cat > "${DEB_DIR}/DEBIAN/control" << EOF
Package: ${DEB_NAME}
Version: ${VERSION}
Section: devel
Priority: optional
Architecture: ${DEB_ARCH}
Depends: libgtk-3-0, libwebkit2gtk-4.1-0
Maintainer: lbty <langbiantianya@outlook.com>
Homepage: https://github.com/lbty/idb_desktop
Description: IDB Desktop - Cross-platform database management tool
 IDB Desktop is a lightweight database client for MySQL and PostgreSQL
 with a bundled JVM engine, Lua data generation, and Monaco SQL editor.
EOF

# postinst：更新桌面数据库和图标缓存
cat > "${DEB_DIR}/DEBIAN/postinst" << 'POSTINST'
#!/bin/sh
set -e
if [ -x /usr/bin/update-desktop-database ]; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi
if [ -x /usr/bin/gtk-update-icon-cache ]; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi
POSTINST
chmod 755 "${DEB_DIR}/DEBIAN/postinst"

# prerm
cat > "${DEB_DIR}/DEBIAN/prerm" << 'PRERM'
#!/bin/sh
set -e
PRERM
chmod 755 "${DEB_DIR}/DEBIAN/prerm"

# ---- 应用文件 ----

# 二进制 + engine → /opt/idb_desktop/
INSTALL_DIR="${DEB_DIR}/opt/idb_desktop"
mkdir -p "${INSTALL_DIR}"
cp "${BUILD_DIR}/${APP_NAME}" "${INSTALL_DIR}/${APP_NAME}"
chmod 755 "${INSTALL_DIR}/${APP_NAME}"

if [ -d "${ENGINE_DIR}/bin" ]; then
    mkdir -p "${INSTALL_DIR}/engine/bin"
    cp -r "${ENGINE_DIR}/bin/"* "${INSTALL_DIR}/engine/bin/"
fi
if [ -d "${ENGINE_DIR}/jre" ]; then
    mkdir -p "${INSTALL_DIR}/engine/jre"
    cp -r "${ENGINE_DIR}/jre/"* "${INSTALL_DIR}/engine/jre/"
fi

# 启动脚本（LD_LIBRARY_PATH 设置）
cat > "${INSTALL_DIR}/run.sh" << 'LAUNCHER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="${SCRIPT_DIR}/engine/jre/lib:${LD_LIBRARY_PATH:-}"
exec "${SCRIPT_DIR}/idb_desktop" "$@"
LAUNCHER
chmod 755 "${INSTALL_DIR}/run.sh"

# /usr/bin/idb_desktop 符号链接
mkdir -p "${DEB_DIR}/usr/bin"
ln -sf /opt/idb_desktop/run.sh "${DEB_DIR}/usr/bin/idb_desktop"

# .desktop 文件
mkdir -p "${DEB_DIR}/usr/share/applications"
cp "${PROJECT_DIR}/build/linux/idb_desktop.desktop" "${DEB_DIR}/usr/share/applications/"

# 图标
mkdir -p "${DEB_DIR}/usr/share/icons/hicolor/512x512/apps"
cp "${PROJECT_DIR}/build/appicon.png" "${DEB_DIR}/usr/share/icons/hicolor/512x512/apps/${APP_NAME}.png"

# metainfo
mkdir -p "${DEB_DIR}/usr/share/metainfo"
cp "${PROJECT_DIR}/build/linux/idb_desktop.metainfo.xml" "${DEB_DIR}/usr/share/metainfo/"

# ---- 构建 ----
mkdir -p "${BUILD_DIR}"
dpkg-deb --build "${DEB_DIR}" "${BUILD_DIR}/${APP_NAME}-linux-${ARCH_SUFFIX}-v${VERSION}.deb"

# 清理
rm -rf "${STAGE_DIR}"

echo "=== 完成: ${BUILD_DIR}/${APP_NAME}-linux-${ARCH_SUFFIX}-v${VERSION}.deb ==="
