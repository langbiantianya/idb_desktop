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

# Azul API 查询辅助宏：从 JSON 响应提取 download_url
#   API 端点: https://api.azul.com/metadata/v1/zulu/packages/?java_version=21&os={os}&arch=x64&java_package_type=jre&archive_type={ext}&latest=true&page_size=1
#   响应: [{"download_url":"https://cdn.azul.com/zulu/bin/zulu21.xx-ca-jre21.x.x-{os}_x64.{ext}", ...}]
AZUL_QUERY = $(shell curl -sL "$(AZUL_API)?java_version=$(JAVA_VERSION)&arch=x64&java_package_type=jre&latest=true&page_size=1&os=$(1)&archive_type=$(2)" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['download_url'])" 2>/dev/null || curl -sL "$(AZUL_API)?java_version=$(JAVA_VERSION)&arch=x64&java_package_type=jre&latest=true&page_size=1&os=$(1)&archive_type=$(2)" | python -c "import sys,json; print(json.load(sys.stdin)[0]['download_url'])")

ifeq ($(HOST_OS),windows)
$(JRE_DIR)/bin/java.exe:
	@echo "=== 下载 Azul Zulu JRE $(JAVA_VERSION) (windows x64) ==="
	@mkdir -p $(JRE_DIR)
	$(eval JRE_URL := $(call AZUL_QUERY,windows,zip))
	@if [ -z "$(JRE_URL)" ]; then echo "错误: 无法从 Azul API 获取下载链接"; exit 1; fi
	@echo "下载: $(JRE_URL)"
	curl -L -o /tmp/idb-jre.zip "$(JRE_URL)"
	@echo "解压到 $(JRE_DIR) ..."
	$(eval EXTRACTED_DIR := $(shell unzip -l /tmp/idb-jre.zip | head -5 | grep '/' | head -1 | awk '{print $$4}' | cut -d/ -f1))
	unzip -qo /tmp/idb-jre.zip -d /tmp/idb-jre-extract
	rm -rf $(JRE_DIR)/*
	cp -r /tmp/idb-jre-extract/$(EXTRACTED_DIR)/* $(JRE_DIR)/
	rm -rf /tmp/idb-jre.zip /tmp/idb-jre-extract
	@echo "=== Zulu JRE 已安装到 $(JRE_DIR) ==="
else
$(JRE_DIR)/bin/java:
	@echo "=== 下载 Azul Zulu JRE $(JAVA_VERSION) (linux x64) ==="
	@mkdir -p $(JRE_DIR)
	$(eval JRE_URL := $(call AZUL_QUERY,linux,tar.gz))
	@if [ -z "$(JRE_URL)" ]; then echo "错误: 无法从 Azul API 获取下载链接"; exit 1; fi
	@echo "下载: $(JRE_URL)"
	curl -L -o /tmp/idb-jre.tar.gz "$(JRE_URL)"
	@echo "解压到 $(JRE_DIR) ..."
	$(eval EXTRACTED_DIR := $(shell tar tzf /tmp/idb-jre.tar.gz | head -1 | cut -d/ -f1))
	tar xzf /tmp/idb-jre.tar.gz -C /tmp/
	rm -rf $(JRE_DIR)/*
	cp -r /tmp/$(EXTRACTED_DIR)/* $(JRE_DIR)/
	rm -rf /tmp/idb-jre.tar.gz /tmp/$(EXTRACTED_DIR)
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
