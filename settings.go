package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// AppSettings 存储在 ~/.config/idb/settings.json。
// 包含全局应用偏好：语言、首次引导状态、主题选择。
type AppSettings struct {
	Version       int    `json:"version"`
	Locale        string `json:"locale"`        // "zh-CN" | "zh-TW" | "en" | "ja" | "ru"
	SetupComplete bool   `json:"setupComplete"` // 首次引导已完成
	ThemeMode     string `json:"themeMode"`     // "light" | "dark" | "auto"
	LightThemeID  string `json:"lightThemeId"`  // 浅色模式主题 ID，空 = 内置 MD3
	DarkThemeID   string `json:"darkThemeId"`   // 深色模式主题 ID，空 = 内置 MD3
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
