package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// AppSettings 存储在 ~/.config/idb/settings.json。
// 包含全局应用偏好：语言、首次引导状态、主题选择。
type AppSettings struct {
	Version           int    `json:"version"`
	Locale            string `json:"locale"`            // "zh-CN" | "zh-TW" | "en" | "ja" | "ru"
	SetupComplete     bool   `json:"setupComplete"`     // 首次引导已完成
	ThemeMode         string `json:"themeMode"`         // "light" | "dark" | "auto"
	LightThemeID      string `json:"lightThemeId"`      // 浅色模式主题 ID，空 = 内置 MD3
	DarkThemeID       string `json:"darkThemeId"`       // 深色模式主题 ID，空 = 内置 MD3
	MemRefreshSeconds int    `json:"memRefreshSeconds"` // 内存刷新间隔（秒），默认 10
	JvmMaxMemoryMB    int    `json:"JvmMaxMemoryMB"`    // JVM 最大堆内存（MB），默认 256
	SystemMemoryMB    int    `json:"systemMemoryMB"`    // 系统物理内存（MB），只读，前端用于计算 JVM 上限
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
	if settings.MemRefreshSeconds < 1 || settings.MemRefreshSeconds > 60 {
		settings.MemRefreshSeconds = 10
	}
	if settings.JvmMaxMemoryMB == 0 {
		settings.JvmMaxMemoryMB = defaultJvmMemoryMB()
	}
	settings.SystemMemoryMB = systemMemoryMB()
	return settings, nil
}

// defaultJvmMemoryMB 默认 JVM 最大堆 256MB，用户可在设置中调整（64 ~ 系统内存 50%）。
func defaultJvmMemoryMB() int {
	return 256
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
