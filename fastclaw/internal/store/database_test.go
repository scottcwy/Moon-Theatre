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

func TestSessionTakenByOther(t *testing.T) {
	dsn := "file:" + filepath.Join(t.TempDir(), "fastclaw.db") + "?_pragma=foreign_keys(1)"
	st, err := NewDBStore("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := st.SaveSession(ctx, "u_alice", "agt_rp", "api_sess-1", &SessionRecord{
		Messages: []SessionMessage{{Role: "user", Content: "hello"}},
	}); err != nil {
		t.Fatal(err)
	}

	// Same owner: not taken by another user.
	taken, err := st.SessionTakenByOther(ctx, "agt_rp", "api_sess-1", "u_alice")
	if err != nil {
		t.Fatal(err)
	}
	if taken {
		t.Fatal("SessionTakenByOther = true for the owning user, want false")
	}
	// Different user: taken.
	taken, err = st.SessionTakenByOther(ctx, "agt_rp", "api_sess-1", "u_bob")
	if err != nil {
		t.Fatal(err)
	}
	if !taken {
		t.Fatal("SessionTakenByOther = false for a different user, want true")
	}
	// Unknown key: not taken.
	taken, err = st.SessionTakenByOther(ctx, "agt_rp", "api_sess-other", "u_bob")
	if err != nil {
		t.Fatal(err)
	}
	if taken {
		t.Fatal("SessionTakenByOther = true for an unknown key, want false")
	}
	// Same key, different agent: not taken.
	taken, err = st.SessionTakenByOther(ctx, "agt_other", "api_sess-1", "u_bob")
	if err != nil {
		t.Fatal(err)
	}
	if taken {
		t.Fatal("SessionTakenByOther = true for a different agent, want false")
	}
}
