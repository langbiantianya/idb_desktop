# =============================================================================
# IDB Desktop — Build & Package Makefile
# =============================================================================
# 用法:
#   make dev               开发模式（热重载）
#   make build             构建当前平台二进制
#   make package-windows   构建 Windows amd64 安装包（NSIS .exe）
#   make package-linux     构建 Linux amd64 分发包（.tar.gz）
#   make package-all       构建所有平台安装包
#   make jre-download      下载 Azul Zulu JRE 21 到 engine/jre/
#   make clean             清理构建产物
# =============================================================================

APP_NAME    := idb_desktop
VERSION     := 0.1.0
BUILD_DIR   := build/bin
ENGINE_DIR  := engine
JRE_DIR     := $(ENGINE_DIR)/jre
JAR_FILE    := $(ENGINE_DIR)/bin/idb-engine.jar

# Azul Zulu JRE 21 配置
JAVA_VERSION := 21
AZUL_API     := https://api.azul.com/metadata/v1/zulu/packages

# 检测宿主机 OS（Makefile 自身运行在哪个平台）
ifeq ($(OS),Windows_NT)
  HOST_OS := windows
else
  UNAME_S := $(shell uname -s)
  ifeq ($(UNAME_S),Linux)
    HOST_OS := linux
  else ifeq ($(UNAME_S),Darwin)
    HOST_OS := mac
  endif
endif

# =============================================================================
# Shell 探测（关键：Windows 上 GNU Make 的 $(shell ...) 与 recipe 都默认
# 走 cmd.exe；cmd 不会自动补 .exe，且 cmd 的 PATH 可能不含 Git Bash 的
# usr/bin/，导致 mkdir / grep / sed / mktemp / unzip 全部找不到。
# 解决：在 parse 阶段解析出 bash.exe 的绝对路径，把 $(shell) 与 recipe
# 都显式路由到这个 bash 上；不依赖调用 make 的 shell 的 PATH。
# =============================================================================
ifeq ($(HOST_OS),windows)
  # 1) 看 cmd 当前 PATH
  BASH_BIN := $(shell where bash.exe 2>/dev/null | head -1)
  ifeq ($(BASH_BIN),)
    BASH_BIN := $(shell where bash 2>/dev/null | head -1)
  endif
  # 2) 兜底：scoop git 安装路径
  ifeq ($(BASH_BIN),)
    BASH_BIN := $(firstword $(wildcard C:/Users/*/scoop/apps/git/*/usr/bin/bash.exe))
  endif
  # 3) 兜底：默认 Git for Windows 安装路径
  ifeq ($(BASH_BIN),)
    BASH_BIN := $(firstword $(wildcard C:/Program\ Files/Git/usr/bin/bash.exe))
  endif
  # 4) 兜底：msys2
  ifeq ($(BASH_BIN),)
    BASH_BIN := $(firstword $(wildcard C:/msys64/usr/bin/bash.exe))
  endif
  ifeq ($(BASH_BIN),)
    $(error 未找到 bash.exe；请安装 Git for Windows (https://git-scm.com/download/win) 并重试)
  endif
  # 把 $(shell) 与 recipe 路由到这个 bash。
  # 在 bash 内部通过 export PATH=... 加入 Git Bash bin 目录，
  # 确保 mkdir / grep / sed / mktemp / unzip / tar / head / cp 一应俱全。
  SHELL := $(BASH_BIN)
  SHELLFLAGS := -lc
else
  SHELL := /bin/sh
endif

# =============================================================================
# 开发
# =============================================================================

.PHONY: dev
dev:
	wails dev

# =============================================================================
# 依赖检查
# =============================================================================

.PHONY: deps
deps:
	@echo "=== 检查构建依赖 ==="
	@command -v go    >/dev/null 2>&1 || { echo "错误: go 未安装";   exit 1; }
	@command -v node  >/dev/null 2>&1 || { echo "错误: node 未安装"; exit 1; }
	@command -v npm   >/dev/null 2>&1 || { echo "错误: npm 未安装";  exit 1; }
	@command -v wails >/dev/null 2>&1 || { echo "错误: wails 未安装 (go install github.com/wailsapp/wails/v2/cmd/wails@latest)"; exit 1; }
	@echo "go:    $$(go version)"
	@echo "node:  $$(node --version)"
	@echo "wails: $$(wails version)"
	@echo "=== 依赖检查通过 ==="

# =============================================================================
# 通用构建（当前平台）
# =============================================================================

.PHONY: build
build: deps frontend-build
	wails build -devtools
	@echo "=== 构建完成: $(BUILD_DIR)/ ==="

.PHONY: frontend-build
frontend-build:
	cd frontend && npm install && npm run build

# =============================================================================
# JRE 下载（Azul Zulu JRE 21）
# =============================================================================

.PHONY: jre-download
jre-download: $(JRE_DIR)/bin/java$(if $(filter windows,$(HOST_OS)),.exe)

# 在 $(shell) 中通过 bash 抽 download_url，避免依赖 Windows 上未必存在的 python，
# 也避免被 cmd.exe 的 PATH 解析和 .exe 补全机制坑。
# page_size=5 + grep -v '\-fx\-' 排除 JavaFX 变体，只取纯 JRE。
ifeq ($(HOST_OS),windows)
  AZUL_QUERY = $(shell "$(BASH_BIN)" -lc 'curl -fsSL "$(AZUL_API)?java_version=$(JAVA_VERSION)&arch=x64&java_package_type=jre&latest=true&page_size=5&os=$(1)&archive_type=$(2)" 2>/dev/null | grep -oE "\"download_url\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" | grep -v "\-fx\-" | head -1 | sed -E "s/.*\"([^\"]+)\"$$/\1/"')
else
  AZUL_QUERY = $(shell curl -fsSL "$(AZUL_API)?java_version=$(JAVA_VERSION)&arch=x64&java_package_type=jre&latest=true&page_size=5&os=$(1)&archive_type=$(2)" 2>/dev/null | grep -oE '"download_url"[[:space:]]*:[[:space:]]*"[^"]+"' | grep -v '\-fx\-' | head -1 | sed -E 's/.*"([^"]+)"$$/\1/')
endif

ifeq ($(HOST_OS),windows)
$(JRE_DIR)/bin/java.exe:
	@echo "=== 下载 Azul Zulu JRE $(JAVA_VERSION) (windows x64) ==="
	$(eval JRE_URL := $(call AZUL_QUERY,windows,zip))
	@if [ -z "$(JRE_URL)" ]; then echo "错误: 无法从 Azul API 获取下载链接"; exit 1; fi
	@echo "下载: $(JRE_URL)"
	@"$(BASH_BIN)" -lc 'set -e; export PATH="$$(dirname "$(BASH_BIN)"):$$PATH"; mkdir -p "$(JRE_DIR)"; JRE_TMP_DIR=$$(mktemp -d); curl -fsSL -o "$$JRE_TMP_DIR/idb-jre.zip" "$(JRE_URL)"; echo "解压到 $(JRE_DIR) ..."; rm -rf "$(JRE_DIR)"/*; unzip -qo "$$JRE_TMP_DIR/idb-jre.zip" -d "$$JRE_TMP_DIR/extracted"; EXTRACTED_DIR=$$(ls "$$JRE_TMP_DIR/extracted" | head -1); if [ -z "$$EXTRACTED_DIR" ] || [ ! -d "$$JRE_TMP_DIR/extracted/$$EXTRACTED_DIR" ]; then echo "错误: 无法识别解压后的顶层目录"; rm -rf "$$JRE_TMP_DIR"; exit 1; fi; cp -r "$$JRE_TMP_DIR/extracted/$$EXTRACTED_DIR/." "$(JRE_DIR)/"; rm -rf "$$JRE_TMP_DIR"; chmod +x "$(JRE_DIR)/bin/java.exe" 2>/dev/null || true; echo "=== Zulu JRE 已安装到 $(JRE_DIR) ==="'
else
$(JRE_DIR)/bin/java:
	@echo "=== 下载 Azul Zulu JRE $(JAVA_VERSION) (linux x64) ==="
	@mkdir -p $(JRE_DIR)
	$(eval JRE_URL := $(call AZUL_QUERY,linux,tar.gz))
	@if [ -z "$(JRE_URL)" ]; then echo "错误: 无法从 Azul API 获取下载链接"; exit 1; fi
	@echo "下载: $(JRE_URL)"
	@JRE_TMP_DIR=$$(mktemp -d) && \
	  curl -fsSL -o "$$JRE_TMP_DIR/idb-jre.tar.gz" "$(JRE_URL)" && \
	  echo "解压到 $(JRE_DIR) ..." && \
	  rm -rf $(JRE_DIR)/* && \
	  tar xzf "$$JRE_TMP_DIR/idb-jre.tar.gz" -C "$$JRE_TMP_DIR" && \
	  EXTRACTED_DIR=$$(ls "$$JRE_TMP_DIR" | head -1) && \
	  if [ -z "$$EXTRACTED_DIR" ] || [ ! -d "$$JRE_TMP_DIR/$$EXTRACTED_DIR" ]; then echo "错误: 无法识别解压后的顶层目录"; rm -rf "$$JRE_TMP_DIR"; exit 1; fi && \
	  cp -r "$$JRE_TMP_DIR/$$EXTRACTED_DIR/." $(JRE_DIR)/ && \
	  rm -rf "$$JRE_TMP_DIR" && \
	  chmod +x $(JRE_DIR)/bin/java
	@echo "=== Zulu JRE 已安装到 $(JRE_DIR) ==="
endif

# =============================================================================
# Windows 安装包（NSIS）
# =============================================================================

.PHONY: package-windows
package-windows: deps jre-download
	@echo "=== 构建 Windows amd64 安装包 ==="
	@# 确保当前宿主为 Windows 或启用了交叉编译
	wails build --platform windows/amd64 --nsis -devtools
	@echo "=== Windows 安装包: $(BUILD_DIR)/$(APP_NAME)-amd64-installer.exe ==="

# =============================================================================
# Linux 分发包（tar.gz）
# =============================================================================

.PHONY: package-linux
package-linux: deps
	@echo "=== 构建 Linux amd64 分发包 ==="
	wails build --platform linux/amd64 -devtools
	@echo "=== 打包 tar.gz ==="
	bash scripts/package-linux.sh "$(APP_NAME)" "$(VERSION)" "$(BUILD_DIR)" "$(ENGINE_DIR)"
	@echo "=== Linux 分发包: $(BUILD_DIR)/$(APP_NAME)-linux-amd64-v$(VERSION).tar.gz ==="

# =============================================================================
# 全平台
# =============================================================================

.PHONY: package-all
package-all: package-windows package-linux

# =============================================================================
# 清理
# =============================================================================

.PHONY: clean
clean:
	rm -rf $(BUILD_DIR)/*
	rm -rf frontend/build frontend/.svelte-kit
	@echo "=== 已清理构建产物 ==="
