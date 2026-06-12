#!/usr/bin/env bash
# =============================================================================
# Docker 构建编排脚本
# 用法: scripts/docker-build.sh <amd64|arm64> <deb|rpm|tar|flatpak>
#
# 构建环境选择：
#   rpm     → AlmaLinux 9，兼容 RHEL/Fedora/CentOS 系
#   其他    → Debian 12 (bookworm)，兼容 Ubuntu/Debian 系
#
# 前提: docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
# =============================================================================
set -euo pipefail

ARCH="${1:?用法: $0 <amd64|arm64> <deb|rpm|tar|flatpak>}"
FORMAT="${2:?}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 按格式选择 Dockerfile
case "${FORMAT}" in
    rpm)     DOCKERFILE="docker/Dockerfile.almalinux-builder" ;;
    *)       DOCKERFILE="docker/Dockerfile.debian-builder" ;;
esac

IMAGE_TAG="idb-desktop-builder:${FORMAT}-${ARCH}"

echo "=== 构建 Docker 镜像 (${FORMAT}, ${ARCH}) ==="
echo "    Dockerfile: ${DOCKERFILE}"
docker buildx build \
  --platform "linux/${ARCH}" \
  --tag "${IMAGE_TAG}" \
  --load \
  -f "${PROJECT_DIR}/${DOCKERFILE}" \
  "${PROJECT_DIR}"

echo "=== 在容器内执行 ${FORMAT} 打包 (${ARCH}) ==="
docker run --rm \
  --platform "linux/${ARCH}" \
  -v "${PROJECT_DIR}:/app:ro" \
  -v "${PROJECT_DIR}/build/bin:/app/build/bin" \
  "${IMAGE_TAG}" \
  bash -c "
    set -e &&
    cd /app &&
    cp -r engine/jre-${ARCH} engine/jre &&
    wails build --platform linux/${ARCH} -devtools &&
    bash scripts/package-${FORMAT}.sh idb_desktop 0.1.0 build/bin engine linux/${ARCH}
  "

echo "=== 完成 ==="
ls -lh "${PROJECT_DIR}/build/bin/"*linux*"${ARCH}"* 2>/dev/null || true
