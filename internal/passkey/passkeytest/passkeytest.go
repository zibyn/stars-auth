// Package passkeytest is a software authenticator for tests: it answers
// the server's creation options with a registration response an ES256 key
// signs nothing over (attestation none), like a Passkey would.
package passkeytest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"testing"

	"github.com/fxamacker/cbor/v2"
)

var b64u = base64.RawURLEncoding

// Authenticator is one device or password manager. Set its fields between
// ceremonies to play one that verifies the User, syncs, or misbehaves.
type Authenticator struct {
	t   *testing.T
	key *ecdsa.PrivateKey

	// AAGUID is what it reports; the all-zero one unless set.
	AAGUID [16]byte
	// UV, BE and BS are the authenticator data flags. UV is required to
	// add a Passkey.
	UV, BE, BS bool
	// SignCount is the counter of the registration response, and of each
	// assertion after it; bump it between sign-ins.
	SignCount uint32
	// Origin of clientDataJSON; the issuer being tested.
	Origin string
	// UserHandle is who an assertion names: the sub the credential belongs
	// to, which is what the credential was enrolled as.
	UserHandle []byte
	// CredentialID enrols a fixed credential; a fresh random one each
	// ceremony when nil, remembered for Assert.
	CredentialID []byte

	// enrolled is the credential ID of the last Enroll.
	enrolled []byte
}

// New makes an authenticator that always verifies the User.
func New(t *testing.T) *Authenticator {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return &Authenticator{t: t, key: key, UV: true}
}

// Enroll answers creation options (the options member of the Account API's
// response) with the RegistrationResponseJSON to post back.
func (a *Authenticator) Enroll(options json.RawMessage) json.RawMessage {
	a.t.Helper()
	var opts struct {
		PublicKey struct {
			Challenge string `json:"challenge"`
			RP        struct {
				ID string `json:"id"`
			} `json:"rp"`
		} `json:"publicKey"`
	}
	if err := json.Unmarshal(options, &opts); err != nil {
		a.t.Fatalf("creation options: %v", err)
	}
	if opts.PublicKey.RP.ID == "" || opts.PublicKey.Challenge == "" {
		a.t.Fatalf("creation options incomplete: %s", options)
	}
	id := a.CredentialID
	if id == nil {
		id = make([]byte, 32)
		_, _ = rand.Read(id)
	}
	a.enrolled = id
	clientData, _ := json.Marshal(map[string]any{
		"type": "webauthn.create", "challenge": opts.PublicKey.Challenge,
		"origin": a.Origin, "crossOrigin": false,
	})
	response, err := json.Marshal(map[string]any{
		"id":    b64u.EncodeToString(id),
		"rawId": b64u.EncodeToString(id),
		"type":  "public-key",
		"response": map[string]any{
			"clientDataJSON":    b64u.EncodeToString(clientData),
			"attestationObject": b64u.EncodeToString(a.attestation(opts.PublicKey.RP.ID, id)),
			"transports":        []string{"internal"},
		},
	})
	if err != nil {
		a.t.Fatal(err)
	}
	return json.RawMessage(response)
}

// Assert answers assertion options (the options member of the login page or
// the direct API's response) with the AuthenticationResponseJSON to submit.
func (a *Authenticator) Assert(options json.RawMessage) json.RawMessage {
	a.t.Helper()
	var opts struct {
		PublicKey struct {
			Challenge string `json:"challenge"`
			RPID      string `json:"rpId"`
		} `json:"publicKey"`
	}
	if err := json.Unmarshal(options, &opts); err != nil {
		a.t.Fatalf("assertion options: %v", err)
	}
	if opts.PublicKey.RPID == "" || opts.PublicKey.Challenge == "" {
		a.t.Fatalf("assertion options incomplete: %s", options)
	}
	clientData, _ := json.Marshal(map[string]any{
		"type": "webauthn.get", "challenge": opts.PublicKey.Challenge,
		"origin": a.Origin, "crossOrigin": false,
	})
	// The assertion signs the authenticator data, then the client data's
	// own digest.
	data := a.authData(opts.PublicKey.RPID)
	sum := sha256.Sum256(clientData)
	signed := append(append([]byte{}, data...), sum[:]...)
	digest := sha256.Sum256(signed)
	sig, err := ecdsa.SignASN1(rand.Reader, a.key, digest[:])
	if err != nil {
		a.t.Fatal(err)
	}
	id := a.credentialID()
	response := map[string]any{
		"id":    b64u.EncodeToString(id),
		"rawId": b64u.EncodeToString(id),
		"type":  "public-key",
		"response": map[string]any{
			"clientDataJSON":    b64u.EncodeToString(clientData),
			"authenticatorData": b64u.EncodeToString(data),
			"signature":         b64u.EncodeToString(sig),
			"userHandle":        b64u.EncodeToString(a.UserHandle),
		},
	}
	out, err := json.Marshal(response)
	if err != nil {
		a.t.Fatal(err)
	}
	return json.RawMessage(out)
}

// authData is an assertion's authenticator data: the RP ID's hash, the
// flags, and the counter. No attested credential data: that is enrollment's.
func (a *Authenticator) authData(rpID string) []byte {
	hash := sha256.Sum256([]byte(rpID))
	data := make([]byte, 0, 37)
	data = append(data, hash[:]...)
	data = append(data, 0x01|flags(a.UV, 0x04)|flags(a.BE, 0x08)|flags(a.BS, 0x10))
	return binary.BigEndian.AppendUint32(data, a.SignCount)
}

func (a *Authenticator) credentialID() []byte {
	if a.CredentialID != nil {
		return a.CredentialID
	}
	if a.enrolled != nil {
		return a.enrolled
	}
	// No credential to assert with: one that was never enrolled still makes
	// a well-formed response the server will refuse.
	id := make([]byte, 32)
	_, _ = rand.Read(id)
	return id
}

// attestation is the attestationObject: format none, over authenticator
// data attesting the credential and its COSE ES256 public key.
func (a *Authenticator) attestation(rpID string, id []byte) []byte {
	// The SEC1 uncompressed point is 0x04 || X || Y, P-256-sized.
	point, err := a.key.PublicKey.Bytes()
	if err != nil {
		a.t.Fatal(err)
	}
	coseKey := map[int]any{1: 2, 3: -7, -1: 1, -2: point[1:33], -3: point[33:]} // EC2, ES256, P-256
	keyBytes, err := cbor.Marshal(coseKey)
	if err != nil {
		a.t.Fatal(err)
	}
	var lenBuf [2]byte
	binary.BigEndian.PutUint16(lenBuf[:], uint16(len(id)))
	authData := sha256.Sum256([]byte(rpID))
	data := make([]byte, 0, 37+2+len(id)+len(keyBytes))
	data = append(data, authData[:]...)
	data = append(data, 0x01|flags(a.UV, 0x04)|flags(a.BE, 0x08)|flags(a.BS, 0x10)|0x40)
	data = binary.BigEndian.AppendUint32(data, a.SignCount)
	data = append(data, a.AAGUID[:]...)
	data = append(data, lenBuf[:]...)
	data = append(data, id...)
	data = append(data, keyBytes...)
	obj, err := cbor.Marshal(map[string]any{"fmt": "none", "attStmt": map[string]any{}, "authData": data})
	if err != nil {
		a.t.Fatal(err)
	}
	return obj
}

func flags(on bool, bit byte) byte {
	if on {
		return bit
	}
	return 0
}
