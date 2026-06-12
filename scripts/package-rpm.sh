#!/usr/bin/env bash
# =============================================================================
# 打包 Linux .rpm 包
# 用法: bash scripts/package-rpm.sh <app_name> <version> <build_dir> <engine_dir> <arch>
# arch: linux/amd64 | linux/arm64
# =============================================================================
set -euo pipefail

APP_NAME="${1:?用法: $0 <app_name> <version> <build_dir> <engine_dir> <arch>}"
VERSION="${2:?}"
BUILD_DIR="${3:?}"
ENGINE_DIR="${4:?}"
PLATFORM="${5:?}"

ARCH_SUFFIX="${PLATFORM#linux/}"

# RPM 架构名映射
case "${ARCH_SUFFIX}" in
    amd64) RPM_ARCH="x86_64" ;;
    arm64) RPM_ARCH="aarch64" ;;
    *)     RPM_ARCH="${ARCH_SUFFIX}" ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RPM_NAME="idb-desktop"
RPMBUILD_DIR="/tmp/${APP_NAME}-rpmbuild"

echo "=== 构建 .rpm (${RPM_ARCH}) ==="

# 清理 + 创建 rpmbuild 目录结构
rm -rf "${RPMBUILD_DIR}"
mkdir -p "${RPMBUILD_DIR}"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

# ---- 收集源文件到 tarball ----
SOURCE_DIR="/tmp/${APP_NAME}-rpm-source"
rm -rf "${SOURCE_DIR}"
mkdir -p "${SOURCE_DIR}/${APP_NAME}-${VERSION}"

cp "${BUILD_DIR}/${APP_NAME}" "${SOURCE_DIR}/${APP_NAME}-${VERSION}/${APP_NAME}"
chmod 755 "${SOURCE_DIR}/${APP_NAME}-${VERSION}/${APP_NAME}"

if [ -d "${ENGINE_DIR}/bin" ]; then
    mkdir -p "${SOURCE_DIR}/${APP_NAME}-${VERSION}/engine/bin"
    cp -r "${ENGINE_DIR}/bin/"* "${SOURCE_DIR}/${APP_NAME}-${VERSION}/engine/bin/"
fi
if [ -d "${ENGINE_DIR}/jre" ]; then
    mkdir -p "${SOURCE_DIR}/${APP_NAME}-${VERSION}/engine/jre"
    cp -r "${ENGINE_DIR}/jre/"* "${SOURCE_DIR}/${APP_NAME}-${VERSION}/engine/jre/"
fi

# 启动脚本
cat > "${SOURCE_DIR}/${APP_NAME}-${VERSION}/run.sh" << 'LAUNCHER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="${SCRIPT_DIR}/engine/jre/lib:${LD_LIBRARY_PATH:-}"
exec "${SCRIPT_DIR}/idb_desktop" "$@"
LAUNCHER
chmod 755 "${SOURCE_DIR}/${APP_NAME}-${VERSION}/run.sh"

# .desktop + 图标 + metainfo
cp "${PROJECT_DIR}/build/linux/idb_desktop.desktop" "${SOURCE_DIR}/${APP_NAME}-${VERSION}/"
cp "${PROJECT_DIR}/build/appicon.png" "${SOURCE_DIR}/${APP_NAME}-${VERSION}/${APP_NAME}.png"
cp "${PROJECT_DIR}/build/linux/idb_desktop.metainfo.xml" "${SOURCE_DIR}/${APP_NAME}-${VERSION}/"

# 打 tarball
tar czf "${RPMBUILD_DIR}/SOURCES/${APP_NAME}-${VERSION}.tar.gz" -C "${SOURCE_DIR}" "${APP_NAME}-${VERSION}"
rm -rf "${SOURCE_DIR}"

# ---- 生成 .spec ----
cat > "${RPMBUILD_DIR}/SPECS/${RPM_NAME}.spec" << EOF
Name:           ${RPM_NAME}
Version:        ${VERSION}
Release:        1
Summary:        Cross-platform database management tool
License:        MIT
URL:            https://github.com/lbty/idb_desktop

Requires:       gtk3
Requires:       webkit2gtk4.1

%description
IDB Desktop is a lightweight database client for MySQL and PostgreSQL
with a bundled JVM engine, Lua data generation, and Monaco SQL editor.

%prep
%setup -q -n ${APP_NAME}-${VERSION}

%build
# 二进制已预编译，无需构建

%install
rm -rf %{buildroot}
install -Dm755 %{_sourcedir}/${APP_NAME}-${VERSION}/${APP_NAME} %{buildroot}/opt/idb_desktop/${APP_NAME}
install -Dm755 %{_sourcedir}/${APP_NAME}-${VERSION}/run.sh %{buildroot}/opt/idb_desktop/run.sh
cp -r %{_sourcedir}/${APP_NAME}-${VERSION}/engine %{buildroot}/opt/idb_desktop/engine

install -Dm644 %{_sourcedir}/${APP_NAME}-${VERSION}/idb_desktop.desktop %{buildroot}/usr/share/applications/idb_desktop.desktop
install -Dm644 %{_sourcedir}/${APP_NAME}-${VERSION}/${APP_NAME}.png %{buildroot}/usr/share/icons/hicolor/512x512/apps/${APP_NAME}.png
install -Dm644 %{_sourcedir}/${APP_NAME}-${VERSION}/idb_desktop.metainfo.xml %{buildroot}/usr/share/metainfo/idb_desktop.metainfo.xml

mkdir -p %{buildroot}/usr/bin
ln -sf /opt/idb_desktop/run.sh %{buildroot}/usr/bin/idb_desktop

%post
if [ -x /usr/bin/update-desktop-database ]; then
    update-desktop-database /usr/share/applications 2>/dev/null || true
fi
if [ -x /usr/bin/gtk-update-icon-cache ]; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi

%files
%dir /opt/idb_desktop
/opt/idb_desktop/${APP_NAME}
/opt/idb_desktop/run.sh
/opt/idb_desktop/engine/
/usr/bin/idb_desktop
/usr/share/applications/idb_desktop.desktop
/usr/share/icons/hicolor/512x512/apps/${APP_NAME}.png
/usr/share/metainfo/idb_desktop.metainfo.xml
EOF

# ---- 构建 ----
rpmbuild --define "_topdir ${RPMBUILD_DIR}" --target "${RPM_ARCH}" -bb "${RPMBUILD_DIR}/SPECS/${RPM_NAME}.spec"

# 复制产物
mkdir -p "${BUILD_DIR}"
cp "${RPMBUILD_DIR}/RPMS/${RPM_ARCH}/${RPM_NAME}-${VERSION}-1.${RPM_ARCH}.rpm" \
   "${BUILD_DIR}/${APP_NAME}-linux-${ARCH_SUFFIX}-v${VERSION}.rpm"

# 清理
rm -rf "${RPMBUILD_DIR}"

echo "=== 完成: ${BUILD_DIR}/${APP_NAME}-linux-${ARCH_SUFFIX}-v${VERSION}.rpm ==="
