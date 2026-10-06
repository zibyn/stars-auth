package client

import "github.com/zibyn/stars-auth/internal/oidc/goidc"

var ErrClientNotIdentified = goidc.NewError(goidc.ErrorCodeInvalidClient, "could not identify the client")
