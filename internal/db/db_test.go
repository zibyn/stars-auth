package db

import (
	"context"
	"os"
	"testing"
	"testing/fstest"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"
)

// freshDB creates an empty database on STARS_AUTH_TEST_DATABASE_URL's server.
func freshDB(t *testing.T) *pgxpool.Pool {
	url := os.Getenv("STARS_AUTH_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("STARS_AUTH_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx) //nolint:errcheck
	name := pgx.Identifier{"t_" + t.Name()}.Sanitize()
	if _, err := admin.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = "t_" + t.Name()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestMigrateConcurrentReplicas(t *testing.T) {
	pool := freshDB(t)
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
	pool := freshDB(t)
	if err := Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
}
