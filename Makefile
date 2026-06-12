# =============================================================================
# IDB Desktop — Build & Package Makefile
# =============================================================================
# 用法:
#   make dev                     开发模式（热重载）
#   make build                   构建当前平台二进制
#   make jre-download            下载当前平台 JRE 到 engine/jre/
#   make jre-download-amd64      下载 Windows x64 JRE
#   make jre-download-arm64      下载 Windows arm64 JRE
#   make package-windows-amd64   构建 Windows amd64 安装包（NSIS .exe）
#   make package-windows-arm64   构建 Windows arm64 安装包（NSIS .exe）
#   make package-windows         构建 Windows amd64 + arm64 安装包
#   make package-linux           构建 Linux amd64 分发包（.tar.gz）
#   make package-all             构建所有平台安装包
#   make clean                   清理构建产物
# =============================================================================

APP_NAME    := idb_desktop
VERSION     := 0.1.0
BUILD_DIR   := build/bin
ENGINE_DIR  := engine
JRE_DIR     := $(ENGINE_DIR)/jre
JAR_FILE    := $(ENGINE_DIR)/bin/idb-engine.jar

# Azul Zulu JRE 25 配置
JAVA_VERSION := 25
AZUL_API     := https://api.azul.com/metadata/v1/zulu/packages

# 检测宿主机 OS
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

# 各架构独立的 JRE 目录（避免重复下载）
JRE_DIR_AMD64 := $(ENGINE_DIR)/jre-amd64
JRE_DIR_ARM64 := $(ENGINE_DIR)/jre-arm64

# =============================================================================
# Shell / PowerShell 探测
# --------------------------------------------------------------------
# Windows 上 GNU Make 默认 $(SHELL)=cmd.exe,既缺 curl/grep/unzip/mktemp,
# 也无法优雅地做 JSON 解析。这里采用双轨:
#
#   1) bash 仍用于 SHELL(供依赖检查/清理/前端构建等轻量 recipe 使用,
#      只要能 where + mkdir 就够,出错不致命)
#   2) PowerShell(pwsh.exe 或 powershell.exe)用于所有下载/解压/JSON 解析,
#      因为 PowerShell 内置 Invoke-RestMethod/Expand-Archive/ConvertFrom-Json,
#      不依赖任何第三方
#
# 优先 pwsh(PowerShell 7+,跨平台),回退 Windows PowerShell 5.1
# =============================================================================
ifeq ($(HOST_OS),windows)
  BASH_BIN := $(shell where bash.exe 2>/dev/null | head -1)
  ifeq ($(BASH_BIN),)
    BASH_BIN := $(shell where bash 2>/dev/null | head -1)
  endif
  ifeq ($(BASH_BIN),)
    BASH_BIN := $(firstword $(wildcard C:/Users/*/scoop/apps/git/*/usr/bin/bash.exe))
  endif
  ifeq ($(BASH_BIN),)
    BASH_BIN := $(firstword $(wildcard C:/Program\ Files/Git/usr/bin/bash.exe))
  endif
  ifeq ($(BASH_BIN),)
    BASH_BIN := $(firstword $(wildcard C:/msys64/usr/bin/bash.exe))
  endif
  # PowerShell 7+ 优先,失败回退 Windows PowerShell 5.1
  PWSH_BIN := $(shell where pwsh.exe 2>/dev/null | head -1)
  ifeq ($(PWSH_BIN),)
    PWSH_BIN := $(shell where powershell.exe 2>/dev/null | head -1)
  endif
  ifeq ($(PWSH_BIN),)
    $(error 未找到 PowerShell;Windows 系统应自带 powershell.exe,请检查 PATH)
  endif
  ifeq ($(BASH_BIN),)
    $(error 未找到 bash.exe;请安装 Git for Windows (https://git-scm.com/download/win) 并重试)
  endif
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
# 通用构建(当前平台)
# =============================================================================

.PHONY: build
build: deps frontend-build
	wails build -devtools
	@echo "=== 构建完成: $(BUILD_DIR)/ ==="

.PHONY: frontend-build
frontend-build:
	cd frontend && npm install && npm run build

# =============================================================================
# JRE 下载(Azul Zulu JRE 25)
# --------------------------------------------------------------------
# Windows 上完全走 PowerShell:Invoke-RestMethod + ConvertFrom-Json +
# Expand-Archive 内置,零外部依赖。Linux 保留 curl + tar + sed。
#
# API 参数说明:
#   arch=x64|arm64        目标 CPU 架构
#   os=windows|linux      目标 OS
#   archive_type=zip|tar.gz  目标压缩格式
#   java_package_type=jre 纯 JRE(不是 JDK,不是 JavaFX)
#   page_size=5 + 仅取首条非 -fx- 变体
# =============================================================================
ifeq ($(HOST_OS),windows)
  # 参数: $(1)=azul_arch(x64|arm64)  $(2)=archive_type(zip)
  # 整个 -Command 用单引号包裹,bash 不会对其内部做 $ 变量展开,
  # PowerShell 看到的 $resp / $jre 原样保留。Make 变量 $(1)/$(2) 等
  # 在解析阶段就已被替换好。
  AZUL_QUERY = $(shell "$(PWSH_BIN)" -NoProfile -Command ' \
    $$resp = Invoke-RestMethod -Uri "$(AZUL_API)?java_version=$(JAVA_VERSION)&arch=$(1)&java_package_type=jre&latest=true&page_size=5&os=windows&archive_type=$(2)" -ErrorAction SilentlyContinue; \
     $$jre = $$resp | Where-Object { $$_.download_url -and ($$_.download_url -notmatch "-fx-") } | Select-Object -First 1; \
     $$jre.download_url')
else
  AZUL_QUERY = $(shell curl -fsSL "$(AZUL_API)?java_version=$(JAVA_VERSION)&arch=$(1)&java_package_type=jre&latest=true&page_size=5&os=$(2)&archive_type=$(3)" 2>/dev/null | grep -oE '"download_url"[[:space:]]*:[[:space:]]*"[^"]+"' | grep -v '\-fx\-' | head -1 | sed -E 's/.*"([^"]+)"$$/\1/')
endif

# --- Windows:PowerShell 下载/解压/重命名 ---
# 参数: $(1)=jre_dir  $(2)=azul_arch  $(3)=label
#
# 关键: -Command 用单引号,bash 不会做 $ 展开,PowerShell 看到原样的 $var。
# 路径 '$(1)' 由 make 解析阶段填好。
define JRE_DOWNLOAD_RECIPE_WIN
	@echo "=== 下载 Azul Zulu JRE $(JAVA_VERSION) ($(3)) ==="
	$(eval JRE_URL := $(call AZUL_QUERY,$(2),zip))
	@if [ -z "$(JRE_URL)" ]; then echo "错误: 无法从 Azul API 获取下载链接"; exit 1; fi
	@echo "下载: $(JRE_URL)"
	@"$(PWSH_BIN)" -NoProfile -ExecutionPolicy Bypass -Command ' \
		$$ErrorActionPreference = "Stop"; \
		$$ProgressPreference = "SilentlyContinue"; \
		$$tmp = Join-Path $$env:TEMP ("idb-jre-" + [Guid]::NewGuid().ToString("N")); \
		New-Item -ItemType Directory -Force -Path $$tmp | Out-Null; \
		$$zip = Join-Path $$tmp "jre.zip"; \
		Write-Host "下载到 $$zip ..."; \
		Invoke-WebRequest -Uri "$(JRE_URL)" -OutFile $$zip -UseBasicParsing; \
		Write-Host "清空目标目录 $(1) ..."; \
		if (Test-Path "$(1)") { Remove-Item -Recurse -Force "$(1)" }; \
		New-Item -ItemType Directory -Force -Path "$(1)" | Out-Null; \
		$$extractedDir = Join-Path $$tmp "extracted"; \
		New-Item -ItemType Directory -Force -Path $$extractedDir | Out-Null; \
		Expand-Archive -Path $$zip -DestinationPath $$extractedDir -Force; \
		$$top = (Get-ChildItem -Path $$extractedDir -Directory | Select-Object -First 1).FullName; \
		if ([string]::IsNullOrEmpty($$top)) { Write-Error "无法识别解压后的顶层目录"; exit 1 }; \
		Write-Host ("移动 " + $$top + " -> $(1) ..."); \
		Copy-Item -Path (Join-Path $$top "*") -Destination "$(1)" -Recurse -Force; \
		Remove-Item -Recurse -Force $$tmp; \
		Write-Host "=== Zulu JRE 已安装到 $(1) ==="'
endef

# --- Linux:bash 下载/解压(原逻辑,保持) ---
# 参数: $(1)=jre_dir  $(2)=azul_arch  $(3)=label
define JRE_DOWNLOAD_RECIPE_LINUX
	@echo "=== 下载 Azul Zulu JRE $(JAVA_VERSION) ($(3)) ==="
	$(eval JRE_URL := $(call AZUL_QUERY,$(2),linux,tar.gz))
	@if [ -z "$(JRE_URL)" ]; then echo "错误: 无法从 Azul API 获取下载链接"; exit 1; fi
	@echo "下载: $(JRE_URL)"
	@mkdir -p $(1)
	@JRE_TMP_DIR=$$(mktemp -d) && \
	  curl -fsSL -o "$$JRE_TMP_DIR/idb-jre.tar.gz" "$(JRE_URL)" && \
	  tar xzf "$$JRE_TMP_DIR/idb-jre.tar.gz" -C "$$JRE_TMP_DIR" && \
	  EXTRACTED_DIR=$$(ls "$$JRE_TMP_DIR" | head -1) && \
	  if [ -z "$$EXTRACTED_DIR" ] || [ ! -d "$$JRE_TMP_DIR/$$EXTRACTED_DIR" ]; then \
	    echo "错误: 无法识别解压后的顶层目录"; rm -rf "$$JRE_TMP_DIR"; exit 1; \
	  fi && \
	  rm -rf $(1)/* && \
	  cp -r "$$JRE_TMP_DIR/$$EXTRACTED_DIR/." $(1)/ && \
	  rm -rf "$$JRE_TMP_DIR" && \
	  chmod +x $(1)/bin/java && \
	  echo "=== Zulu JRE 已安装到 $(1) ==="
endef

# --- 默认 JRE(当前平台 amd64)---
.PHONY: jre-download
jre-download: $(JRE_DIR_AMD64)/bin/java$(if $(filter windows,$(HOST_OS)),.exe,)
	@rm -rf $(JRE_DIR)
	@cp -r $(JRE_DIR_AMD64) $(JRE_DIR)
	@echo "=== 当前平台 JRE: $(JRE_DIR) (来自 $(JRE_DIR_AMD64)) ==="

# --- Windows amd64 ---
.PHONY: jre-download-amd64
jre-download-amd64: $(JRE_DIR_AMD64)/bin/java.exe

ifeq ($(HOST_OS),windows)
$(JRE_DIR_AMD64)/bin/java.exe:
	$(call JRE_DOWNLOAD_RECIPE_WIN,$(JRE_DIR_AMD64),x64,windows x64)
else
$(JRE_DIR_AMD64)/bin/java:
	$(call JRE_DOWNLOAD_RECIPE_LINUX,$(JRE_DIR_AMD64),x64,linux x64)
endif

# --- Windows arm64 ---
.PHONY: jre-download-arm64
jre-download-arm64: $(JRE_DIR_ARM64)/bin/java.exe

ifeq ($(HOST_OS),windows)
$(JRE_DIR_ARM64)/bin/java.exe:
	$(call JRE_DOWNLOAD_RECIPE_WIN,$(JRE_DIR_ARM64),arm64,windows arm64)
else
$(JRE_DIR_ARM64)/bin/java:
	$(call JRE_DOWNLOAD_RECIPE_LINUX,$(JRE_DIR_ARM64),arm64,linux arm64)
endif

# =============================================================================
# Windows 安装包(NSIS)
# --------------------------------------------------------------------
# PowerShell 拷贝/清理 JRE,然后 wails build --platform windows/<arch> --nsis
# =============================================================================

# PowerShell 复制目标架构 JRE 到 engine/jre
# 参数: $(1)=src_jre_dir  $(2)=dst_jre_dir
define PS_COPY_JRE
	@"$(PWSH_BIN)" -NoProfile -ExecutionPolicy Bypass -Command ' \
		$$ErrorActionPreference = "Stop"; \
		if (Test-Path "$(2)") { Remove-Item -Recurse -Force "$(2)" }; \
		New-Item -ItemType Directory -Force -Path "$(2)" | Out-Null; \
		Copy-Item -Path (Join-Path "$(1)" "*") -Destination "$(2)" -Recurse -Force; \
		Write-Host "已复制 JRE: $(1) -> $(2)"'
endef

# 通用 Windows 构建函数(通过 PowerShell 处理 JRE 目录)
# 参数: $(1)=wails_platform  $(2)=jre_src_dir  $(3)=arch_label
define WINDOWS_BUILD
	@echo "=== 构建 Windows $(3) 安装包 ==="
	@if [ ! -d "$(2)" ]; then \
		echo "错误: 未找到 $(2);请先执行 make jre-download-$(3)"; exit 1; \
	fi
	$(call PS_COPY_JRE,$(2),$(JRE_DIR))
	wails build --platform $(1) --nsis -devtools
	@echo "=== Windows $(3) 安装包构建完成 ==="
endef

.PHONY: package-windows-amd64
package-windows-amd64: deps jre-download-amd64
	$(call WINDOWS_BUILD,windows/amd64,$(JRE_DIR_AMD64),amd64)

.PHONY: package-windows-arm64
package-windows-arm64: deps jre-download-arm64
	$(call WINDOWS_BUILD,windows/arm64,$(JRE_DIR_ARM64),arm64)

.PHONY: package-windows
package-windows: package-windows-amd64 package-windows-arm64

# =============================================================================
# Linux 分发包(tar.gz)
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

# 深度清理:包括所有 JRE 目录
.PHONY: clean-all
clean-all: clean
	@if [ -d $(ENGINE_DIR)/jre-amd64 ]; then rm -rf $(ENGINE_DIR)/jre-amd64; fi
	@if [ -d $(ENGINE_DIR)/jre-arm64 ]; then rm -rf $(ENGINE_DIR)/jre-arm64; fi
	@rm -rf $(ENGINE_DIR)/jre
	@echo "=== 已清理所有构建产物 + JRE ==="
