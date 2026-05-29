//go:build windows

package main

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows DPAPI (CryptProtectData / CryptUnprotectData) 把数据绑定到当前 Windows 用户登录会话。
// 用户用密码 / PIN / Windows Hello 登录后解锁的会话密钥参与解密——离开当前用户上下文密文不可解。
// 用 LazyDLL 显式加载 crypt32.dll，避免引入额外依赖。
var (
	modCrypt32             = windows.NewLazySystemDLL("crypt32.dll")
	procCryptProtectData   = modCrypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = modCrypt32.NewProc("CryptUnprotectData")
	modKernel32            = windows.NewLazySystemDLL("kernel32.dll")
	procLocalFree          = modKernel32.NewProc("LocalFree")
)

// dataBlob 对应 Win32 DATA_BLOB 结构。
type dataBlob struct {
	cbData uint32
	pbData *byte
}

func newBlob(b []byte) *dataBlob {
	if len(b) == 0 {
		return &dataBlob{}
	}
	return &dataBlob{cbData: uint32(len(b)), pbData: &b[0]}
}

func (b *dataBlob) toBytes() []byte {
	if b.cbData == 0 || b.pbData == nil {
		return nil
	}
	out := make([]byte, b.cbData)
	src := unsafe.Slice(b.pbData, b.cbData)
	copy(out, src)
	return out
}

// encryptSecret 用当前用户作用域加密。CRYPTPROTECT_UI_FORBIDDEN(0x1) 禁止系统弹任何对话框。
func encryptSecret(plain []byte) ([]byte, error) {
	if len(plain) == 0 {
		return nil, nil
	}
	in := newBlob(plain)
	var out dataBlob
	r, _, e := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(in)),
		0, // szDataDescr
		0, // pOptionalEntropy
		0, // pvReserved
		0, // pPromptStruct
		uintptr(0x1),
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, fmt.Errorf("CryptProtectData failed: %v", e)
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	return out.toBytes(), nil
}

// decryptSecret 反向操作；密文不属于本用户会话时调用会失败。
func decryptSecret(cipher []byte) ([]byte, error) {
	if len(cipher) == 0 {
		return nil, nil
	}
	in := newBlob(cipher)
	var out dataBlob
	r, _, e := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(in)),
		0,
		0,
		0,
		0,
		uintptr(0x1),
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, fmt.Errorf("CryptUnprotectData failed: %v", e)
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	return out.toBytes(), nil
}
