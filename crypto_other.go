//go:build !windows

package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// 非 Windows 平台用 AES-256-GCM + 本地 key 文件。Key 在 ~/.config/idb/key 下，权限 0600。
// 这不是硬件级别的安全（拿到磁盘文件就能解），但符合本地单用户桌面应用的威胁模型，
// 至少防止了配置文件被简单 `cat` 出明文密码 / 被同步到云盘后泄露。
const keyFileName = "key"

func keyPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, keyFileName), nil
}

// loadOrCreateKey 首次运行生成 32 字节随机密钥；之后总是读取现有的。
func loadOrCreateKey() ([]byte, error) {
	path, err := keyPath()
	if err != nil {
		return nil, err
	}
	if b, err := os.ReadFile(path); err == nil {
		if len(b) != 32 {
			return nil, fmt.Errorf("key file %s is corrupt (%d bytes, want 32)", path, len(b))
		}
		return b, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

func encryptSecret(plain []byte) ([]byte, error) {
	if len(plain) == 0 {
		return nil, nil
	}
	key, err := loadOrCreateKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	// 输出格式：nonce | ciphertext+tag
	return gcm.Seal(nonce, nonce, plain, nil), nil
}

func decryptSecret(blob []byte) ([]byte, error) {
	if len(blob) == 0 {
		return nil, nil
	}
	key, err := loadOrCreateKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	if len(blob) < ns {
		return nil, fmt.Errorf("ciphertext too short: %d", len(blob))
	}
	nonce, ct := blob[:ns], blob[ns:]
	return gcm.Open(nil, nonce, ct, nil)
}
