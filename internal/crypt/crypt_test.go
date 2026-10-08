package crypt

import (
	"bytes"
	"testing"
)

func key(b byte) []byte { return bytes.Repeat([]byte{b}, 32) }

var aad = []byte("totp:user-1")

func TestRoundTrip(t *testing.T) {
	k, err := NewKeyring(1, map[byte][]byte{1: key(1)})
	if err != nil {
		t.Fatal(err)
	}
	ct, err := k.Seal([]byte("totp-secret"), aad)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ct, []byte("totp-secret")) {
		t.Fatal("ciphertext leaks plaintext")
	}
	pt, err := k.Open(ct, aad)
	if err != nil || string(pt) != "totp-secret" {
		t.Fatalf("Open = %q, %v", pt, err)
	}
	ct2, _ := k.Seal([]byte("totp-secret"), aad)
	if bytes.Equal(ct, ct2) {
		t.Fatal("nonce reused")
	}
}

func TestVersion(t *testing.T) {
	old, _ := NewKeyring(1, map[byte][]byte{1: key(1)})
	ct, _ := old.Seal([]byte("x"), aad)
	if ct[0] != 1 {
		t.Fatalf("version byte = %d, want 1", ct[0])
	}

	// After rotation the new keyring writes v2 but still reads v1.
	both, _ := NewKeyring(2, map[byte][]byte{1: key(1), 2: key(2)})
	if pt, err := both.Open(ct, aad); err != nil || string(pt) != "x" {
		t.Fatalf("Open old version = %q, %v", pt, err)
	}
	ct2, _ := both.Seal([]byte("x"), aad)
	if ct2[0] != 2 {
		t.Fatalf("version byte = %d, want 2", ct2[0])
	}

	// A keyring without v2 must refuse v2 ciphertext.
	if _, err := old.Open(ct2, aad); err == nil {
		t.Fatal("opened ciphertext of unknown version")
	}
}

func TestTamperAndWrongKey(t *testing.T) {
	k, _ := NewKeyring(1, map[byte][]byte{1: key(1)})
	ct, _ := k.Seal([]byte("x"), aad)
	ct[len(ct)-1] ^= 1
	if _, err := k.Open(ct, aad); err == nil {
		t.Fatal("opened tampered ciphertext")
	}
	other, _ := NewKeyring(1, map[byte][]byte{1: key(9)})
	ct, _ = k.Seal([]byte("x"), aad)
	if _, err := other.Open(ct, aad); err == nil {
		t.Fatal("opened with wrong key")
	}
	if _, err := k.Open([]byte{1, 2}, aad); err == nil {
		t.Fatal("opened truncated ciphertext")
	}
}

func TestNewKeyringValidates(t *testing.T) {
	if _, err := NewKeyring(1, map[byte][]byte{1: key(1)[:16]}); err == nil {
		t.Fatal("accepted 16-byte key")
	}
	if _, err := NewKeyring(2, map[byte][]byte{1: key(1)}); err == nil {
		t.Fatal("accepted missing current version")
	}
}

func TestAADBindsLocation(t *testing.T) {
	k, _ := NewKeyring(1, map[byte][]byte{1: key(1)})
	ct, _ := k.Seal([]byte("x"), []byte("totp:user-1"))
	if _, err := k.Open(ct, []byte("totp:user-2")); err == nil {
		t.Fatal("opened ciphertext moved to another row")
	}
}

// A MAC recognises its data under the key that made it, after rotation too.
func TestMAC(t *testing.T) {
	old, _ := NewKeyring(1, map[byte][]byte{1: key(1)})
	mac := old.MAC([]byte("abcd2345"))
	if bytes.Contains(mac, []byte("abcd2345")) || !old.MACEqual(mac, []byte("abcd2345")) || old.MACEqual(mac, []byte("abcd2346")) {
		t.Fatal("MAC does not tell its data apart")
	}
	rotated, _ := NewKeyring(2, map[byte][]byte{1: key(1), 2: key(2)})
	if !rotated.MACEqual(mac, []byte("abcd2345")) || bytes.Equal(rotated.MAC([]byte("abcd2345")), mac) {
		t.Fatal("MAC across rotation")
	}
	other, _ := NewKeyring(1, map[byte][]byte{1: key(3)})
	if other.MACEqual(mac, []byte("abcd2345")) || other.MACEqual(nil, nil) {
		t.Fatal("MAC under another key")
	}
}
