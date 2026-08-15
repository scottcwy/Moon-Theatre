package agent

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/fastclaw-ai/fastclaw/internal/provider"
)

type jsonProvider struct {
	content string
	prompt  string
}

func (p *jsonProvider) Chat(
	ctx context.Context,
	messages []provider.Message,
	_ []provider.Tool,
	_ string,
	_ int,
	_ float64,
	_ string,
) (*provider.Response, error) {
	// Mirror the real provider: a canceled context fails the call instead
	// of silently succeeding. Existing tests pass context.Background(), so
	// this only changes behavior for tests that exercise cancellation.
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.prompt = messages[0].Content
	return &provider.Response{Content: p.content}, nil
}

func (p *jsonProvider) ChatStream(
	context.Context,
	[]provider.Message,
	[]provider.Tool,
	string,
	int,
	float64,
	string,
) (*provider.StreamReader, error) {
	ch := make(chan provider.StreamChunk, 1)
	close(ch)
	return provider.NewStreamReader(ch), nil
}

func TestRouteUserInfoToUserProfile(t *testing.T) {
	profile := []string{"用户自称「白藏」。", "用户喜欢「草莓」", "用户透露职业/身份：「设计师」", "用户偏好安静", "用户提到自己来自「江南」"}
	shared := []string{"用户与角色是旧识", "用户提及剧情：「北门」", "用户提到红线与契约"}
	for _, f := range profile {
		if !routeUserInfoToUserProfile(f) {
			t.Errorf("routeUserInfoToUserProfile(%q) = false, want true (USER.md)", f)
		}
	}
	for _, f := range shared {
		if routeUserInfoToUserProfile(f) {
			t.Errorf("routeUserInfoToUserProfile(%q) = true, want false (shared)", f)
		}
	}
}

func TestAutoPersistRoutesByFrozenSchemaScriptMode(t *testing.T) {
	memStore := newFakeUserMemStore()
	prov := &jsonProvider{content: `{"user_info":["用户自称「白藏」。","用户喜欢「草莓」","用户是设计师"],"relationship":["用户信任角色"],"story":["用户提到剧情：「鸟居附近有线索」"]}`}
	mem := NewMemoryWithStoreForUser(t.TempDir(), memStore, "u_alice", "agt_rp")
	mem.SetScope("script:role-baizang")

	AutoPersistMemory(context.Background(), mem, prov, "model", "off", []provider.Message{
		{Role: "system", Content: "你是白藏"},
		{Role: "user", Content: "我叫白藏，喜欢草莓，是设计师。我们之间很信任。鸟居附近有线索"},
		{Role: "assistant", Content: "好的，我记住了你是设计师。"},
	})

	user, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "USER.md")
	if err != nil {
		t.Fatalf("USER.md missing: %v", err)
	}
	shared, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "shared/MEMORY.md")
	if err != nil {
		t.Fatalf("shared/MEMORY.md missing: %v", err)
	}
	script, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "script_role-baizang/MEMORY.md")
	if err != nil {
		t.Fatalf("script_role-baizang/MEMORY.md missing: %v", err)
	}

	userS, sharedS, scriptS := string(user), string(shared), string(script)
	for _, want := range []string{"白藏", "草莓"} {
		if !strings.Contains(userS, want) {
			t.Errorf("USER.md missing %q:\n%s", want, userS)
		}
	}
	if strings.Contains(userS, "设计师") {
		t.Errorf("USER.md must not hold non-profile user_info (设计师):\n%s", userS)
	}
	for _, want := range []string{"设计师", "信任"} {
		if !strings.Contains(sharedS, want) {
			t.Errorf("shared/MEMORY.md missing %q:\n%s", want, sharedS)
		}
	}
	if strings.Contains(sharedS, "鸟居") {
		t.Errorf("shared/MEMORY.md must not hold story facts:\n%s", sharedS)
	}
	if !strings.Contains(scriptS, "鸟居") {
		t.Errorf("script memory missing story fact:\n%s", scriptS)
	}
	// Only user messages may feed the extractor (F5).
	if strings.Contains(prov.prompt, "我记住了你是设计师") {
		t.Errorf("assistant reply leaked into extractor input:\n%s", prov.prompt)
	}
	if !strings.Contains(prov.prompt, "我叫白藏") {
		t.Errorf("extractor input missing user message:\n%s", prov.prompt)
	}
}

func TestAutoPersistPromptRequiresSingleMentionFacts(t *testing.T) {
	// Prod-quality guard: the extraction prompt must explicitly require
	// single-mention profile facts so a one-off "我喜欢草莓" in turn 1 is
	// still captured after later turns drift to casual chat.
	memStore := newFakeUserMemStore()
	prov := &jsonProvider{content: `{"user_info":["用户喜欢「草莓」"],"relationship":[],"story":[]}`}
	mem := NewMemoryWithStoreForUser(t.TempDir(), memStore, "u_alice", "agt_rp")
	mem.SetScope("free")

	AutoPersistMemory(context.Background(), mem, prov, "model", "off", []provider.Message{
		{Role: "user", Content: "我喜欢吃草莓，最喜欢下雨天。记住这一点。"},
		{Role: "user", Content: "今天天气不错，你觉得呢？"},
		{Role: "user", Content: "所以我的喜好你应该记住了吧？"},
	})

	for _, want := range []string{
		"逐条核对近期用户消息",
		"即使只出现过一次",
		"不得遗漏",
	} {
		if !strings.Contains(prov.prompt, want) {
			t.Errorf("extraction prompt missing %q:\n%s", want, prov.prompt)
		}
	}
	// The one-off fact must still route to USER.md (schema/routing frozen).
	user, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "USER.md")
	if err != nil {
		t.Fatalf("USER.md missing: %v", err)
	}
	if !strings.Contains(string(user), "草莓") {
		t.Errorf("USER.md missing single-mention fact:\n%s", user)
	}
}

func TestAutoPersistFreeModeDropsStory(t *testing.T) {
	memStore := newFakeUserMemStore()
	prov := &jsonProvider{content: `{"user_info":["用户自称「阿茶」。","用户喜欢「草莓」","用户是设计师"],"relationship":[],"story":["用户提到剧情：「北门有异动」"]}`}
	mem := NewMemoryWithStoreForUser(t.TempDir(), memStore, "u_bob", "agt_rp")
	mem.SetScope("free")

	AutoPersistMemory(context.Background(), mem, prov, "model", "off", []provider.Message{
		{Role: "user", Content: "我叫阿茶，喜欢草莓，是设计师。北门有异动"},
	})

	user, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_bob", "USER.md")
	if err != nil {
		t.Fatalf("USER.md missing: %v", err)
	}
	shared, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_bob", "shared/MEMORY.md")
	if err != nil {
		t.Fatalf("shared/MEMORY.md missing: %v", err)
	}
	if !strings.Contains(string(user), "阿茶") || !strings.Contains(string(user), "草莓") {
		t.Errorf("USER.md missing profile facts:\n%s", user)
	}
	if !strings.Contains(string(shared), "设计师") {
		t.Errorf("shared/MEMORY.md missing non-profile user_info:\n%s", shared)
	}
	if strings.Contains(string(shared), "北门") {
		t.Errorf("free mode must drop story facts (no script file, no shared leak):\n%s", shared)
	}
	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_bob", "script_/MEMORY.md"); err == nil {
		t.Error("free mode must not create any script memory file")
	}
}

func TestAutoPersistParseFailureDegradesSilently(t *testing.T) {
	memStore := newFakeUserMemStore()
	prov := &jsonProvider{content: "```json\n{\"user_info\": [\"x\"]}\n```"} // markdown fence -> strict parse fails
	mem := NewMemoryWithStoreForUser(t.TempDir(), memStore, "u_alice", "agt_rp")
	mem.SetScope("free")

	AutoPersistMemory(context.Background(), mem, prov, "model", "off", []provider.Message{
		{Role: "user", Content: "我叫阿茶"},
	})

	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "USER.md"); err == nil {
		t.Error("fenced JSON must be treated as parse failure and write nothing")
	}
	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "shared/MEMORY.md"); err == nil {
		t.Error("fenced JSON must be treated as parse failure and write nothing")
	}
}

func TestMemoryScopeFileRouting(t *testing.T) {
	memStore := newFakeUserMemStore()

	// Legacy scope: MEMORY.md row.
	legacy := NewMemoryWithStoreForUser(t.TempDir(), memStore, "u_a", "agt")
	if err := legacy.SaveMemory("legacy memory"); err != nil {
		t.Fatal(err)
	}
	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt", "u_a", "MEMORY.md"); err != nil {
		t.Fatalf("legacy SaveMemory did not write MEMORY.md: %v", err)
	}
	if got := legacy.LoadMemory(); got != "legacy memory" {
		t.Fatalf("legacy LoadMemory = %q", got)
	}

	// Free scope: shared/MEMORY.md.
	free := NewMemoryWithStoreForUser(t.TempDir(), memStore, "u_free", "agt")
	free.SetScope("free")
	if err := free.SaveMemory("free shared memory"); err != nil {
		t.Fatal(err)
	}
	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt", "u_free", "shared/MEMORY.md"); err != nil {
		t.Fatalf("free SaveMemory did not write shared/MEMORY.md: %v", err)
	}
	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt", "u_free", "MEMORY.md"); err == nil {
		t.Fatal("free SaveMemory must not write bare MEMORY.md")
	}
	if got := free.LoadMemory(); got != "free shared memory" {
		t.Fatalf("free LoadMemory = %q", got)
	}
	// Free mode has no script file.
	if err := free.SaveScriptMemory("story"); err != nil {
		t.Fatal(err)
	}
	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt", "u_free", "script_x/MEMORY.md"); err == nil {
		t.Fatal("free mode must not create a script memory file")
	}

	// Script scope: shared + script_<id>/MEMORY.md, LoadMemory joins both.
	script := NewMemoryWithStoreForUser(t.TempDir(), memStore, "u_script", "agt")
	script.SetScope("script:role-x")
	if err := script.SaveMemory("shared base"); err != nil {
		t.Fatal(err)
	}
	if err := script.SaveScriptMemory("story fact"); err != nil {
		t.Fatal(err)
	}
	if got := script.LoadMemory(); !strings.Contains(got, "shared base") || !strings.Contains(got, "story fact") {
		t.Fatalf("script LoadMemory should join shared + script, got:\n%s", got)
	}
	if _, err := memStore.GetWorkspaceFile(context.Background(), "agt", "u_script", "MEMORY.md"); err == nil {
		t.Fatal("script scope must not write bare MEMORY.md")
	}
	if got := script.LoadSharedMemory(); got != "shared base" {
		t.Fatalf("LoadSharedMemory = %q, want only shared", got)
	}
	if got := script.LoadScriptMemory(); got != "story fact" {
		t.Fatalf("LoadScriptMemory = %q", got)
	}
}

func TestAutoPersistUserWriteSerializedAcrossScopes(t *testing.T) {
	memStore := newFakeUserMemStore()
	lock := &sync.Mutex{}
	free := NewMemoryWithStoreForUser(t.TempDir(), memStore, "u_alice", "agt_rp")
	free.SetScope("free")
	free.SetUserLock(lock)
	script := NewMemoryWithStoreForUser(t.TempDir(), memStore, "u_alice", "agt_rp")
	script.SetScope("script:role-x")
	script.SetUserLock(lock)

	const perScope = 10
	var wg sync.WaitGroup
	for i := 0; i < perScope; i++ {
		wg.Add(2)
		go func(n int) {
			defer wg.Done()
			prov := &jsonProvider{content: fmt.Sprintf(`{"user_info":["用户喜欢「水果%d」"],"relationship":[],"story":[]}`, n)}
			AutoPersistMemory(context.Background(), free, prov, "model", "off", []provider.Message{{Role: "user", Content: fmt.Sprintf("我喜欢水果%d", n)}})
		}(i)
		go func(n int) {
			defer wg.Done()
			prov := &jsonProvider{content: fmt.Sprintf(`{"user_info":["用户喜欢「点心%d」"],"relationship":[],"story":[]}`, n)}
			AutoPersistMemory(context.Background(), script, prov, "model", "off", []provider.Message{{Role: "user", Content: fmt.Sprintf("我喜欢点心%d", n)}})
		}(i)
	}
	wg.Wait()

	user, err := memStore.GetWorkspaceFile(context.Background(), "agt_rp", "u_alice", "USER.md")
	if err != nil {
		t.Fatalf("USER.md missing: %v", err)
	}
	userS := string(user)
	fruit := strings.Count(userS, "水果")
	snack := strings.Count(userS, "点心")
	if fruit != perScope || snack != perScope {
		t.Fatalf("USER.md lost updates: 水果=%d 点心=%d, want %d each (cross-scope serialization broken)\n%s", fruit, snack, perScope, userS)
	}
}
