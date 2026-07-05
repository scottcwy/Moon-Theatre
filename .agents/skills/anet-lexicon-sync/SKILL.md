---
name: anet-lexicon-sync
description: Synchronise the working glossary for the current task — hunt down vague / overloaded / conflicting terms in the user's plan, lock each one to a single canonical definition, and pin the resolved vocabulary into living docs (CONTEXT.md glossary + ADRs) inline as decisions crystallise. 词表同步——把本次任务里模棱两可、同名异义、一词多义的表述全部拍死，锁定 canonical 名称，并当场落档到 CONTEXT.md / ADR。Use when the user's plan contains vague nouns ("account", "job", "task") that could mean multiple things, OR when stress-testing a plan against the project's existing language and documented decisions.
---

# anet-lexicon-sync · 词表同步 📘

> One-liner: **Same word, same thing — across the user, the code, and the docs.** 拍死一词多义 / 多词一意 / 到底指啥不明，让本次任务说的每个名词都只指一件东西。

---

## What to do · 做什么

Optionally inherit the grilling loop from [anet-intent-grill](../anet-intent-grill/SKILL.md) when intent itself is unclear; otherwise this skill stands on its own and focuses purely on **language alignment**.
如果 intent 本身也不清楚，先用 [anet-intent-grill](../anet-intent-grill/SKILL.md) 烤一轮；如果 intent 已明确、只是词义乱，单独用本 skill 即可。

Layer **four moves**:

1. **Domain awareness** · 领域感知（先扫现有词表与代码）
2. **Glossary challenges** · 词表对峙（术语冲突 / 含糊当场喊停）
3. **Adversarial scenarios** · 对抗场景（用具体例子戳关系）
4. **Inline documentation** · 决议即落档（CONTEXT.md / ADR 现写）

---

## 1. Domain awareness · 领域感知

Before grilling starts, **scan the repo** for existing domain artefacts:

```
/
├── CONTEXT.md                   ← single-context project
├── docs/
│   └── adr/                     ← architectural decisions
│       ├── 0001-*.md
│       └── 0002-*.md
└── src/
```

Or for multi-context repos:

```
/
├── CONTEXT-MAP.md               ← points to per-context CONTEXT.md
├── docs/adr/                    ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/            ← context-scoped decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

Inference rules · 推断规则:

- `CONTEXT-MAP.md` exists → multi-context repo, read it to find the right context.
- Only root `CONTEXT.md` exists → single context.
- Neither exists → create root `CONTEXT.md` **lazily** when the first term is resolved.

**Create files lazily.** Don't pre-create empty `CONTEXT.md` or empty `docs/adr/` — create them when you have something to write. 文档目录懒创建：有东西可写时再 `mkdir`。

When asking about how the system works, **read the relevant code first**. Cross-reference user statements against actual implementation. 凡是问"它现在怎么工作"，先读代码，再用代码事实和 user 描述对峙。

---

## 2. Glossary challenges · 词表对峙

When the user uses a term that **conflicts with the existing glossary**, call it out immediately:

> "Your `CONTEXT.md` defines 'cancellation' as **refund-after-shipment**, but you seem to mean **abort-before-shipment**——which is it?"
> "你的词表里 'cancellation' 指的是 X，但你这次说的像 Y——确认一下？"

When the user uses **vague or overloaded terms**, propose a precise canonical alternative:

> "You're saying 'account' — do you mean **Customer** or **User**? They're different things in this codebase."
> "你说的 'account' 是 Customer 还是 User？这俩在你的 codebase 是两个东西。"

Aliases & avoid-list:
- When two words exist for the same concept, **pick the best one and list the others as aliases to avoid**. 同义异形词：选一个 canonical，其余写进 `_Avoid_:`。
- When a single word covers two concepts, **split them**, name each, document the split under "Flagged ambiguities". 一词多义：拆成两个，写到"已澄清歧义"章节。

---

## 3. Adversarial scenario probing · 对抗场景拷问

When relationships between concepts come up, **invent specific edge-case scenarios** that force the user to be precise:

- "An **Order** has 3 line items. The customer cancels item #2 only — does the **Order** stay open, or split?"
- "Two **Invoices** point to the same **Shipment** — can that ever happen? If yes, who reconciles? If no, what enforces it?"
- "A user changes email mid-checkout — does the in-flight **Order** carry the old or new identity?"

These probes do two things:
1. They surface invariants the user assumed but never wrote down. 暴露 user 默认成立但从未明说的不变量。
2. They feed real examples into the **example dialogue** section of `CONTEXT.md`. 顺手给 CONTEXT.md 攒"示例对话"语料。

When user says how X works, **check whether the code agrees**. Surface contradictions on the spot:

> "Your code cancels entire **Orders** atomically, but you just said partial cancellation is supported — which is right? `src/ordering/cancel.ts:42` says all-or-nothing."

---

## 4. Inline documentation · 决议即落档

**Update `CONTEXT.md` the moment a term resolves.** Don't batch — capture as it happens.
术语一旦敲定，**当场更新 CONTEXT.md**，别攒到最后整理。

**Don't couple `CONTEXT.md` to implementation details.** Only include terms meaningful to a domain expert (a non-engineer who understands the business). General programming concepts (timeouts, retry policy, error types) don't belong even if heavily used.
**词表只收领域术语**，不收通用工程概念。判断标准：一个不懂编程的领域专家会不会用这个词？

### CONTEXT.md format · CONTEXT.md 格式

```md
# {Context Name}

{One or two sentences on what this context is and why it exists.}

## Language · 词表

**Order**:
A confirmed customer purchase awaiting fulfillment.
_Avoid_: Purchase, transaction, deal

**Invoice**:
A request for payment sent to a customer after dispatch.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places **Orders**.
_Avoid_: Client, buyer, account

## Relationships · 关系

- An **Order** produces one or more **Invoices**.
- An **Invoice** belongs to exactly one **Customer**.

## Example dialogue · 示例对话

> **Dev:** "When a **Customer** places an **Order**, do we create the **Invoice** immediately?"
> **Domain expert:** "No — an **Invoice** is only generated once a **Fulfillment** is confirmed."

## Flagged ambiguities · 已澄清歧义

- "account" was used to mean both **Customer** and **User** — resolved: distinct concepts.
```

Rules · 规则:
- **Be opinionated.** Pick the canonical term, list aliases under `_Avoid_:`. 只选一个 canonical 词，其它列入 `_Avoid_`。
- **Keep definitions tight.** One sentence max. Define what it IS, not what it does. 定义只写"是什么"，不写"做什么"，一句话上限。
- **Show relationships with cardinality.** "An X produces one or more Y", not "X has Y". 关系一定带 cardinality。
- **Group under sub-headings** when natural clusters emerge; flat list is fine for small contexts.

### ADRs — offer sparingly · ADR 用得克制

Only offer to write an ADR when **all three** are true:

1. **Hard to reverse** — meaningful cost to change your mind later. 难逆——改主意代价大。
2. **Surprising without context** — a future reader will wonder "why did they do it this way?" 不自明——后人会问"为啥这样？"
3. **Result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons. 真权衡——确实有被拒掉的备选方案。

If any of the three is missing, **skip the ADR**. 三件不齐就别写——避免文档膨胀。

#### ADR template · ADR 模板

ADRs live in `docs/adr/` (or `<context>/docs/adr/`), sequentially numbered: `0001-slug.md`, `0002-slug.md`, …
Scan existing files for the highest number, increment by one. 扫现有 ADR 取最大编号 +1。

```md
# {Short title of the decision}

{1–3 sentences: context, decision, why.}
```

That's it. An ADR can be a single paragraph. The value is recording **that** a decision was made and **why** — not in filling out template sections. ADR 可以只有一段话，价值在"决定了 + 为什么"，不在格式完整度。

#### Optional sections · 可选章节

Add only when they earn their keep · 仅在确实有价值时添加:

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful when decisions get revisited. 决策被反复修订时有用。
- **Considered Options** — only when the rejected alternatives are worth remembering. 只有当被拒方案值得后人知道时才写。
- **Consequences** — only when non-obvious downstream effects need to be flagged. 只写非显然的下游影响。

#### What qualifies for an ADR · 什么够格写 ADR

- **Architectural shape** · 架构形态. "Monorepo." "Event-sourced write model with projected read model in Postgres."
- **Integration patterns between contexts** · 上下文间集成方式. "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in** · 带锁定的技术选型. Database, message bus, auth provider, deploy target — not every library, just the ones that take a quarter to swap.
- **Boundary & scope decisions** · 边界与范围. "Customer data is owned by the Customer context; others reference by ID only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path** · 故意反直觉的选择. "Manual SQL instead of an ORM because X." Stops the next engineer from "fixing" what was deliberate.
- **Constraints invisible in code** · 代码里看不见的约束. "No AWS due to compliance." "p99 < 200ms because partner SLA."
- **Rejected alternatives when rejection is non-obvious** · 非显然的拒绝. If you considered GraphQL and picked REST for subtle reasons, record it — otherwise someone will re-propose GraphQL in six months.

---

## Stop condition · 停止条件

Stop when **all** are true:

1. All applicable grill axes resolved (per anet-intent-grill stop condition, if invoked). 所有适用维度已决。
2. Every confirmed term is in `CONTEXT.md`. 每条术语都进了 CONTEXT.md。
3. Every qualifying decision has an ADR (and decisions that didn't qualify were explicitly skipped, not forgotten). 够格的决策都有 ADR；不够格的是明确跳过、不是遗漏。
4. No outstanding contradictions between user statements and code. user 描述和代码之间没有未解的矛盾。

Output a **closing summary** with:

> ✅ Plan frozen.
> 📄 Docs updated: `<list of CONTEXT.md / ADR paths created or modified>`
> ⚠️ Open items: `<any [assumed] flags or deferred risks>`
> ⏭️ Suggested next step: `<implementation entry point>`
