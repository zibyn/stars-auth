// Package web holds the built SPA (admin console, account center) for embedding.
package web

import "embed"

// Dist is the Vite build output; run `pnpm build` in web/ before `go build`.
//
//go:embed all:dist/client
var Dist embed.FS
