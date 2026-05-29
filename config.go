package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// 配置文件持久化：仅 metadata + 加密后的密码。
// 文件格式：~/.config/idb/connections.json
//
// {
//   "version": 1,
//   "connections": [
//     { "id": "...", "name": "...", "driver": "Mysql", ..., "passwordEnc": "<base64>" }
//   ]
// }
//
// passwordEnc 为空字符串表示未保存密码（用户每次手动填入）。
// passwordEnc 不为空时为 base64(平台加密(password))。

const (
	connectionsFileName = "connections.json"
	configFileVersion   = 1
)

type storedConnection struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Driver      string `json:"driver"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	User        string `json:"user"`
	Database    string `json:"database"`
	PasswordEnc string `json:"passwordEnc,omitempty"`
}

type connectionsFile struct {
	Version     int                `json:"version"`
	Connections []storedConnection `json:"connections"`
}

// SavedConnection 是返回给前端的元数据视图——绝不携带明文密码，也不带密文（前端没必要看）。
// 用 hasPassword 告诉前端是否有保存的密码可解（决定是否预填）。
type SavedConnection struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Driver      string `json:"driver"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	User        string `json:"user"`
	Database    string `json:"database"`
	HasPassword bool   `json:"hasPassword"`
}

// SaveConnectionInput 是前端调"保存"时的入参。SavePassword=false 时密码丢弃不入文件。
type SaveConnectionInput struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Driver       string `json:"driver"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	User         string `json:"user"`
	Password     string `json:"password"`
	Database     string `json:"database"`
	SavePassword bool   `json:"savePassword"`
}

// configStore 把所有 IO 串行化在一个 mutex 下；写入用 atomic-rename 防止半文件。
type configStore struct {
	mu sync.Mutex
}

// configDir 返回 ~/.config/idb——跨平台用 os.UserHomeDir 而非 XDG_CONFIG_HOME，
// 因为需求明确指定 ".config/idb 在用户目录下"。
func configDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "idb"), nil
}

func connectionsFilePath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, connectionsFileName), nil
}

func (s *configStore) load() (*connectionsFile, error) {
	path, err := connectionsFilePath()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &connectionsFile{Version: configFileVersion, Connections: []storedConnection{}}, nil
		}
		return nil, err
	}
	cf := &connectionsFile{}
	if err := json.Unmarshal(b, cf); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if cf.Connections == nil {
		cf.Connections = []storedConnection{}
	}
	return cf, nil
}

func (s *configStore) save(cf *connectionsFile) error {
	path, err := connectionsFilePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	cf.Version = configFileVersion
	b, err := json.MarshalIndent(cf, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// 极不可能发生；退而求其次用一个时间无关的兜底，避免崩溃
		return fmt.Sprintf("conn-%x", b)
	}
	return hex.EncodeToString(b[:])
}

func toView(c storedConnection) SavedConnection {
	return SavedConnection{
		ID:          c.ID,
		Name:        c.Name,
		Driver:      c.Driver,
		Host:        c.Host,
		Port:        c.Port,
		User:        c.User,
		Database:    c.Database,
		HasPassword: c.PasswordEnc != "",
	}
}

// listConnections 返回脱敏后的连接列表。
func (s *configStore) listConnections() ([]SavedConnection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cf, err := s.load()
	if err != nil {
		return nil, err
	}
	out := make([]SavedConnection, 0, len(cf.Connections))
	for _, c := range cf.Connections {
		out = append(out, toView(c))
	}
	return out, nil
}

// getPassword 解密某条连接的密码。没保存返回 ""。解密失败则报错——
// 比如用户跨用户拷贝了配置文件、或 key 文件被删了。
func (s *configStore) getPassword(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cf, err := s.load()
	if err != nil {
		return "", err
	}
	for _, c := range cf.Connections {
		if c.ID == id {
			if c.PasswordEnc == "" {
				return "", nil
			}
			cipher, err := base64.StdEncoding.DecodeString(c.PasswordEnc)
			if err != nil {
				return "", fmt.Errorf("decode password blob: %w", err)
			}
			plain, err := decryptSecret(cipher)
			if err != nil {
				return "", err
			}
			return string(plain), nil
		}
	}
	return "", errors.New("connection not found")
}

// saveConnection 创建或覆盖。input.ID 为空 → 新建，分配 id；非空 → upsert 命中。
func (s *configStore) saveConnection(input SaveConnectionInput) (SavedConnection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cf, err := s.load()
	if err != nil {
		return SavedConnection{}, err
	}

	rec := storedConnection{
		ID:       input.ID,
		Name:     input.Name,
		Driver:   input.Driver,
		Host:     input.Host,
		Port:     input.Port,
		User:     input.User,
		Database: input.Database,
	}
	if rec.ID == "" {
		rec.ID = newID()
	}
	if input.SavePassword && input.Password != "" {
		ct, err := encryptSecret([]byte(input.Password))
		if err != nil {
			return SavedConnection{}, fmt.Errorf("encrypt password: %w", err)
		}
		rec.PasswordEnc = base64.StdEncoding.EncodeToString(ct)
	}

	replaced := false
	for i, c := range cf.Connections {
		if c.ID == rec.ID {
			cf.Connections[i] = rec
			replaced = true
			break
		}
	}
	if !replaced {
		cf.Connections = append(cf.Connections, rec)
	}
	if err := s.save(cf); err != nil {
		return SavedConnection{}, err
	}
	return toView(rec), nil
}

// deleteConnection 删除一条；不存在按成功处理（幂等）。
func (s *configStore) deleteConnection(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	cf, err := s.load()
	if err != nil {
		return err
	}
	out := make([]storedConnection, 0, len(cf.Connections))
	for _, c := range cf.Connections {
		if c.ID != id {
			out = append(out, c)
		}
	}
	cf.Connections = out
	return s.save(cf)
}
