package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestMigrateAddsCredentialKeyToLegacyConfigs(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "fastclaw.db") + "?_pragma=foreign_keys(1)"
	store, err := NewDBStore("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, err = store.db.Exec(`CREATE TABLE configs (
		id TEXT PRIMARY KEY,
		kind TEXT NOT NULL,
		scope TEXT NOT NULL DEFAULT '',
		scope_id TEXT NOT NULL DEFAULT '',
		name TEXT NOT NULL,
		enabled BOOLEAN NOT NULL DEFAULT TRUE,
		data TEXT NOT NULL DEFAULT '{}',
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE (kind, scope_id, name)
	)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.db.Exec(`INSERT INTO configs (id, kind, scope, scope_id, name, data)
		VALUES ('cfg-1', 'provider', 'system', '', 'openai', '{"apiBase":"https://example.test"}')`)
	if err != nil {
		t.Fatal(err)
	}

	if err := store.Migrate(context.Background()); err != nil {
		t.Fatalf("Migrate() error = %v", err)
	}

	var credentialKey, data string
	if err := store.db.QueryRow(`SELECT credential_key, data FROM configs WHERE id = 'cfg-1'`).Scan(&credentialKey, &data); err != nil {
		t.Fatal(err)
	}
	if credentialKey != "" {
		t.Fatalf("credential_key = %q, want empty", credentialKey)
	}
	if data != `{"apiBase":"https://example.test"}` {
		t.Fatalf("data = %q, want legacy value preserved", data)
	}
}
