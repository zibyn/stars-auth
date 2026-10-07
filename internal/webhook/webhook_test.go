package webhook

import "testing"

// The example from the Standard Webhooks specification.
func TestSignMatchesStandardWebhooks(t *testing.T) {
	got := sign([]byte("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"), "msg_p5jXN8AQM9LWM0D4loKWxJek", "1614265330", []byte(`{"test": 2432232314}`))
	if want := "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="; got != want {
		t.Errorf("signature %s, want %s", got, want)
	}
}
