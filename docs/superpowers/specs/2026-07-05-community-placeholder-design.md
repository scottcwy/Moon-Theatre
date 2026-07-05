# Community Placeholder Design

## Goal

Turn the Community tab from a dead empty state into a polished placeholder page that sets expectations, avoids fake functionality, and gives users a real path back to existing content.

## Scope

- The Community tab remains a placeholder. No feed, posting, discussion, notification subscription, backend API, or fake "subscribed" state is introduced.
- The page fixes custom top bar safe-area behavior by reusing the same WeChat status bar and capsule metrics logic used by Home.
- The measured top bar CSS variables must live on a common `.community` parent so both the fixed header and body content inherit the same values.
- The page presents three static preview items: script recommendations, player moments, and story discussions.
- The page provides one real action: switch back to the Home tab.
- The tab bar should keep its original icon while Community is only a placeholder.

## UX Copy

- Title: `社区正在布景`
- Subtitle: `这里将用于剧本推荐、玩家动态和故事讨论。开放前，先去首页选择角色开始故事。`
- Primary action: `去首页看看`
- Preview items:
  - `剧本推荐`: `发现适合当下心情的新剧本。`
  - `玩家动态`: `围观角色互动里的高光片段。`
  - `故事讨论`: `聊聊剧情分支、关系走向和未解伏笔。`

## Constraints

- Do not add subscription UI until a real reminder capability exists.
- Do not make preview items clickable.
- Do not add a placeholder/status chip above the title.
- Do not reintroduce `.community__topbar-shell`; it breaks CSS variable inheritance for `.community__body`.
- Do not touch unrelated dirty files.
- Do not introduce new visual systems; follow existing Material Soft Roleplay tokens.
