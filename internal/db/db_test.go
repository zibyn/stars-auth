package db

import (
	"context"
	"testing"
	"testing/fstest"

	"github.com/zibyn/stars-auth/internal/db/dbtest"
	"golang.org/x/sync/errgroup"
)

func TestMigrateConcurrentReplicas(t *testing.T) {
	pool := dbtest.Fresh(t)
	ctx := context.Background()

	// Upgrade an already-migrated database (a fresh one is accidentally
	// serialised by goose creating its version table).
	fsys := fstest.MapFS{"00001_a.sql": {Data: []byte("-- +goose Up\nSELECT 1;\n")}}
	if err := migrate(ctx, pool, fsys); err != nil {
		t.Fatal(err)
	}
	// Slow and non-idempotent: a second runner would fail or double-record.
	fsys["00002_slow.sql"] = &fstest.MapFile{Data: []byte("-- +goose Up\nSELECT pg_sleep(0.3);\nCREATE TABLE once (id int);\n")}

	var g errgroup.Group
	for range 4 {
		g.Go(func() error { return migrate(ctx, pool, fsys) })
	}
	if err := g.Wait(); err != nil {
		t.Fatal(err)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM goose_db_version WHERE version_id = 2`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("migration recorded %d times, want 1", rows)
	}
}

func TestMigrateEmbedded(t *testing.T) {
	pool := dbtest.Fresh(t)
	if err := Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
}
