package store

import (
	"strings"
	"testing"
)

func TestDefaultSQLiteDSNIncludesBusyTimeout(t *testing.T) {
	dsn, err := defaultSQLiteDSN(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(dsn, "_pragma=busy_timeout(5000)") {
		t.Fatalf("dsn = %q, want sqlite busy timeout pragma", dsn)
	}
}
