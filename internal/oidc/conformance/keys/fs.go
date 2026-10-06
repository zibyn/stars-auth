package keys

import "embed"

// FS holds the TLS certificate the harness serves.
//
//go:embed server.crt server.key
var FS embed.FS
