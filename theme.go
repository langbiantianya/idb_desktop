package main

import (
	"bufio"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

//go:embed themes/*.css
var bundledThemes embed.FS

// ThemeInfo 是返回给前端的主题元数据。
type ThemeInfo struct {
	ID   string `json:"id"`   // 文件名（不含 .css 扩展名）
	Name string `json:"name"` // 从 CSS 注释 @idb-theme 解析
	Type string `json:"type"` // "light" | "dark"
}

// themeDir 返回 ~/.config/idb/theme 目录路径。
func themeDir() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "theme"), nil
}

// 主题元数据解析正则：匹配 /* @idb-theme 开头的注释块中的 name: 和 type: 字段。
var (
	themeNameRe = regexp.MustCompile(`^\s*name:\s*(.+)$`)
	themeTypeRe = regexp.MustCompile(`^\s*type:\s*(light|dark)\s*$`)
)

// parseThemeMeta 从 CSS 文件头部解析 /* @idb-theme ... */ 块。
func parseThemeMeta(cssContent string) (name, typ string) {
	scanner := bufio.NewScanner(strings.NewReader(cssContent))
	inBlock := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.Contains(line, "@idb-theme") {
			inBlock = true
			continue
		}
		if !inBlock {
			// 跳过非注释行之前的内容；遇到非 /* 开头的非空行则放弃
			if line != "" && !strings.HasPrefix(line, "/*") && !strings.HasPrefix(line, "*") {
				break
			}
			continue
		}
		if strings.HasPrefix(line, "*/") || strings.HasPrefix(line, "*/") {
			break
		}
		// 去掉行首的 * 前缀（多行注释风格）
		cleaned := strings.TrimPrefix(line, "*")
		cleaned = strings.TrimSpace(cleaned)
		if m := themeNameRe.FindStringSubmatch(cleaned); m != nil {
			name = strings.TrimSpace(m[1])
		}
		if m := themeTypeRe.FindStringSubmatch(cleaned); m != nil {
			typ = m[1]
		}
	}
	if name == "" {
		name = "未命名主题"
	}
	if typ == "" {
		typ = "light"
	}
	return
}

// ListThemes 扫描 ~/.config/idb/theme/*.css，解析元数据并返回列表。
func (s *configStore) ListThemes() ([]ThemeInfo, error) {
	dir, err := themeDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []ThemeInfo{}, nil
		}
		return nil, err
	}
	var themes []ThemeInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".css") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		name, typ := parseThemeMeta(string(data))
		id := strings.TrimSuffix(e.Name(), ".css")
		themes = append(themes, ThemeInfo{ID: id, Name: name, Type: typ})
	}
	return themes, nil
}

// GetThemeCSS 读取指定主题 ID 的完整 CSS 内容。
func (s *configStore) GetThemeCSS(id string) (string, error) {
	dir, err := themeDir()
	if err != nil {
		return "", err
	}
	// 防止路径穿越
	if strings.ContainsAny(id, "/\\..") {
		return "", fmt.Errorf("invalid theme id: %s", id)
	}
	path := filepath.Join(dir, id+".css")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ---------- 主题设置持久化 ----------

// AppSettings 存储在 ~/.config/idb/settings.json。
type AppSettings struct {
	Version      int    `json:"version"`
	ThemeMode    string `json:"themeMode"`    // "light" | "dark" | "auto"
	LightThemeID string `json:"lightThemeId"` // 浅色模式主题 ID，空 = 内置 MD3
	DarkThemeID  string `json:"darkThemeId"`  // 深色模式主题 ID，空 = 内置 MD3
}

const settingsFileName = "settings.json"
const settingsVersion = 1

func settingsFilePath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, settingsFileName), nil
}

// LoadSettings 从 ~/.config/idb/settings.json 读取设置；文件不存在返回默认值。
func (s *configStore) LoadSettings() (AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	path, err := settingsFilePath()
	if err != nil {
		return AppSettings{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return AppSettings{Version: settingsVersion, ThemeMode: "auto"}, nil
		}
		return AppSettings{}, err
	}
	var settings AppSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return AppSettings{Version: settingsVersion, ThemeMode: "auto"}, nil
	}
	if settings.Version == 0 {
		settings.Version = settingsVersion
	}
	if settings.ThemeMode == "" {
		settings.ThemeMode = "auto"
	}
	return settings, nil
}

// SaveSettings 写入 ~/.config/idb/settings.json（atomic rename）。
func (s *configStore) SaveSettings(input AppSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	path, err := settingsFilePath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	input.Version = settingsVersion
	b, err := json.MarshalIndent(input, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ---------- 内置主题部署 ----------

// deployBundledThemes 将嵌入的 themes/*.css 部署到 ~/.config/idb/theme/。
// 仅在目标文件不存在时写入（不覆盖用户自定义的主题）。
// 首次启动时调用。
func deployBundledThemes() error {
	dir, err := themeDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return fs.WalkDir(bundledThemes, "themes", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".css") {
			return err
		}
		data, readErr := bundledThemes.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		target := filepath.Join(dir, d.Name())
		if _, statErr := os.Stat(target); statErr == nil {
			return nil // 已存在，不覆盖
		}
		return os.WriteFile(target, data, 0o600)
	})
}
