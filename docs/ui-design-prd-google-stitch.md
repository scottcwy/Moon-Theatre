# Google Stitch 界面设计 PRD v1

## 1. 文档目的

本文档用于交付给 Google Stitch 生成第一版界面设计稿。

本文档只描述界面、信息结构、视觉方向和关键交互状态，不展开技术实现细节。

当前版本是设计系统讨论稿，参考 Google Material Design / Material You 的柔和方向，尚未冻结为最终视觉规范。

设计范围包括：

- 微信小程序 C 端界面
- 简单 admin 界面

第一版不做 C 端 Web/H5/安卓。

## 2. 产品一句话

一个剧本杀角色扮演小程序。用户在一个固定剧本世界观中选择 3 个 AI 角色之一，通过文本流式对话推进关系、记忆和羁绊，并可购买点数继续体验。

## 3. 设计目标

### 3.1 C 端设计目标

- 有剧本杀和角色扮演的沉浸感，但整体表达要柔和、亲近。
- 聊天体验清晰、轻量、易读。
- 让用户明确感知角色、世界观、羁绊、情绪和点数。
- 不做过重游戏 UI，不做复杂装饰。
- 不要像普通 AI 聊天工具，但也不要做成过硬的悬疑档案风；需要保留角色感和陪伴感。

### 3.2 admin 设计目标

- 简单、清楚、可执行。
- 优先满足内部查看、标记、统计、配置。
- 不做复杂运营平台，不做花哨视觉。

## 4. 设计关键词

C 端关键词：

- 柔和
- 沉浸
- 角色关系
- 陪伴感
- Material Design
- 清晰聊天

admin 关键词：

- 克制
- 表格清晰
- 快速筛选
- 状态可辨认
- 内部工具

## 5. 视觉方向

### 5.1 C 端视觉方向

建议方向：**Material Soft Roleplay**。

参考 Google Material Design / Material You 的系统感：柔和表面、清晰层级、圆润组件、可读排版、适度动效。整体要像一个温和的角色互动应用，而不是硬质侦探档案或深色游戏面板。

视觉特征：

- 页面使用柔和的 tonal surfaces，避免大面积纯黑或高压迫暗色。
- 角色卡片使用 Material card 语言：圆角、轻微阴影、清晰头像和关系信息。
- 聊天气泡清晰易读，保留角色头像和情绪状态。
- 关键按钮使用 filled button 或 tonal button。
- 模型档位用 segmented button。
- mood 用 small chips 或 assist chips。
- 点数余额用 compact badge / pill。
- 页面整体亲近、干净、有呼吸感。

建议配色：

| 用途 | 建议 |
| --- | --- |
| 主背景 | 柔和浅色 surface，如 warm off-white / soft gray |
| Surface 容器 | 轻微分层的 surface container |
| Primary | 柔和玫瑰棕或莓果色 |
| Secondary | 鼠尾草绿或灰青色 |
| Tertiary | 柔和琥珀，用于点数和支付 |
| Error | Material 风格红色，不做高饱和血红 |
| 文字 | 高可读深灰，不使用纯黑压迫感 |

注意：

- 不要做硬质侦探档案风。
- 不要大面积暗黑。
- 不要大面积紫蓝渐变。
- 不要过度装饰。
- 卡片和按钮可以使用 Material 风格圆角，但要保持清爽，不要变成玩具感。

### 5.2 admin 视觉方向

建议方向：**Material Admin Console**。

视觉特征：

- 左侧导航 + 顶部标题区 + 内容表格，使用 Material table / card 风格。
- 表格密度适中，支持状态标签。
- 异常内容和支付状态要容易扫描。
- 不需要强视觉装饰，但要和 C 端共享柔和、清晰的 Material 系统语言。

### 5.3 Material 设计系统草案

建议 Stitch 按以下设计系统生成：

| 设计项 | 建议 |
| --- | --- |
| 基础风格 | Material Design 3 / Material You inspired |
| 页面基调 | 柔和、清晰、陪伴感、轻量沉浸 |
| Shape | 中等圆角，cards/buttons/chips 使用一致圆角系统 |
| Elevation | 轻微阴影和 tonal elevation，不做厚重投影 |
| Buttons | Filled button、tonal button、text button |
| Chips | Assist chips、filter chips，用于 mood、标签、模型状态 |
| Cards | Elevated card 或 filled card，用于角色、额度包、成就 |
| Navigation | Material bottom navigation，小程序底部 tab |
| Dialog | Material dialog / bottom sheet，用于支付确认和分享预览 |
| Motion | 轻微、顺滑，不做夸张游戏动效 |

建议 mood 视觉：

| Mood | 视觉建议 |
| --- | --- |
| Neutral | 灰色 tonal chip |
| Happy | 柔和绿色或暖黄色 chip |
| Sad | 柔和蓝灰 chip |
| Angry | 柔和红色 chip |
| Thinking | 灰紫/灰蓝 chip，带轻微 loading 状态 |

建议模型档位视觉：

| 档位 | 视觉建议 |
| --- | --- |
| 轻松 | low emphasis tonal segment |
| 标准 | default selected segment |
| 沉浸 | higher emphasis segment，可带小标签 |

## 6. 全局组件规范

### 6.1 小程序组件

需要设计以下通用组件：

- 底部导航
- 顶部页面标题
- 角色卡片
- 角色详情头图
- 羁绊进度条
- 模型档位切换控件
- 点数余额展示
- 聊天气泡
- 流式输入中状态
- AI 情绪标签
- 成就/称号卡片
- 额度包卡片
- 支付确认弹窗
- 分享图预览弹窗
- 空状态
- 错误状态
- 加载状态

### 6.2 admin 组件

需要设计以下通用组件：

- 左侧导航
- 顶部筛选栏
- 数据卡片
- 表格
- 状态标签
- 详情抽屉或详情页
- 标记异常弹窗
- 备注输入框
- 额度包编辑弹窗

## 7. C 端页面清单

### 7.1 登录/授权页

用途：用户首次进入小程序时完成微信登录。

页面内容：

- 产品名称
- 简短世界观引导文案
- 微信登录按钮
- AI 内容提示

文案方向：

- 不要营销腔。
- 强调“进入角色世界”和“AI 生成内容”。

验收：

- 用户能明确看到登录入口。
- 用户能理解这是 AI 角色互动产品。

### 7.2 首页/角色列表

用途：展示剧本世界观和 3 个可互动角色。

页面内容：

- 剧本世界观标题
- 简短世界观简介
- 3 个角色卡片
- 每个角色卡片包含头像、昵称、身份、简短人设、初始关系状态
- 点数余额入口
- 模型档位当前状态

布局建议：

- 顶部是剧本世界观区域。
- 中部是 3 张柔和 Material 角色卡。
- 底部为导航。

验收：

- 一屏内能看到当前剧本和至少部分角色卡。
- 角色之间有明显区分。
- 点击角色卡可进入详情。

### 7.3 角色详情页

用途：让用户了解角色并进入对话。

页面内容：

- 角色头像
- 昵称
- 身份
- 人设简介
- 世界观关联
- 初始关系
- 羁绊等级/进度
- 当前 mood 默认状态
- 进入对话按钮

设计重点：

- 角色是页面主视觉。
- 信息像“角色介绍卡”，不要像普通个人主页，也不要过硬地做成侦探档案。
- 进入对话按钮要明确。

验收：

- 用户能快速理解角色是谁。
- 用户能看到关系/羁绊状态。
- 用户能进入聊天页。

### 7.4 聊天页

用途：用户与单个 AI 角色进行文本流式对话。

页面内容：

- 顶部角色栏：头像、昵称、身份、羁绊等级
- 模型档位切换：轻松、标准、沉浸
- 点数余额
- 消息列表
- AI 情绪标签：Neutral、Happy、Sad、Angry、Thinking
- 流式回复状态
- 输入框
- 发送按钮
- 分享图入口

聊天气泡要求：

- 用户消息和 AI 消息明显区分。
- AI 消息显示角色头像。
- AI 回复流式展示时要有正在生成的状态。
- 情绪标签不要遮挡正文。

不做：

- 语音按钮
- 图片上传
- 多人群聊
- 表情包面板

验收：

- 用户能发送文本。
- AI 回复能逐段显示。
- 用户能切换模型档位。
- 用户能看到点数余额。
- 用户能看到 mood 状态。

### 7.5 会话历史页

用途：用户查看并恢复历史会话。

页面内容：

- 会话列表
- 角色头像
- 会话标题或首句摘要
- 更新时间
- 最近一条消息预览

状态：

- 空状态：暂无会话
- 加载状态
- 错误重试

验收：

- 用户能打开历史会话。
- 长列表以分页或分批加载方式呈现。

### 7.6 记忆页

用途：展示系统整理出的用户与角色关系摘要。

页面内容：

- 角色维度的记忆摘要
- 重要时刻
- 关系状态
- 剧情状态摘要

限制：

- 第一版用户不可编辑记忆。
- 不做复杂记忆管理面板。

验收：

- 用户能看到系统整理出的关系和重要信息。
- 页面不出现编辑、删除等复杂入口。

### 7.7 我的页

用途：展示用户个人状态、点数、成就和称号。

页面内容：

- 用户头像/昵称
- 点数余额
- 购买点数入口
- 已获得称号
- 已获得成就
- AI 内容说明入口

验收：

- 用户能看到点数余额。
- 用户能进入额度包购买页。
- 用户能看到已获得称号/成就。

### 7.8 额度包购买页

用途：用户购买点数。

页面内容：

- 点数余额
- 3 个额度包
- 每个包展示价格、获得点数、推荐标签
- 支付按钮
- 支付说明

额度包名称可先用占位：

- 体验包
- 标准包
- 沉浸包

待补充：

- 具体价格
- 对应点数

验收：

- 用户能看到 3 个包。
- 用户能选择一个包并发起支付。
- 支付成功后有成功反馈。

### 7.9 支付结果页/弹窗

用途：反馈支付状态。

状态：

- 支付成功
- 支付失败
- 支付取消
- 等待确认

页面内容：

- 状态图标
- 状态文案
- 点数到账信息
- 返回聊天/返回我的按钮

验收：

- 用户能知道支付结果。
- 支付成功后能看到点数增加。

### 7.10 分享图预览

用途：生成并保存轻量对话分享图。

分享图内容：

- 角色头像
- 角色昵称
- 精选对话
- AI 内容标识/水印
- 产品名称或品牌占位

限制：

- 不做复杂 HTML 编辑。
- 不做多模板编辑。
- 不做拖拽排版。

验收：

- 用户能预览分享图。
- 用户能保存到相册。

## 8. Admin 页面清单

### 8.1 admin 登录页

用途：内部人员进入 admin。

页面内容：

- 登录表单
- 登录按钮
- 错误提示

验收：

- 内部人员可登录。
- 登录失败有提示。

### 8.2 admin 首页

用途：查看基础概览。

页面内容：

- 今日消息数
- 今日活跃用户数
- 今日订单数
- 今日支付金额
- 异常消息数量
- 模型调用次数

验收：

- 内部人员可快速看到基础统计。

### 8.3 会话列表

用途：查看所有留存会话。

页面内容：

- 会话列表表格
- 用户 ID
- 角色
- 最近消息摘要
- 消息数
- 更新时间
- review 状态
- 筛选：角色、时间、状态

验收：

- 会话列表分页显示。
- 可进入消息详情。

### 8.4 消息详情

用途：查看单个会话的消息内容。

页面内容：

- 会话基础信息
- user messages
- assistant messages
- mood
- 模型档位
- 点数消耗
- 标记异常按钮
- 备注输入

验收：

- 可查看完整会话消息。
- 可标记异常。
- 可保存备注。

### 8.5 订单列表

用途：查看用户购买额度包的订单。

页面内容：

- 订单号
- 用户 ID
- 额度包
- 金额
- 支付状态
- 创建时间
- 支付时间

验收：

- 可查看订单列表。
- 可筛选支付状态。

### 8.6 余额流水

用途：查看用户点数变化。

页面内容：

- 用户 ID
- 变动类型
- 变动点数
- 关联订单或模型调用
- 创建时间

验收：

- 可追踪点数来源和消耗。

### 8.7 额度包配置

用途：admin 配置 3 个固定额度包。

页面内容：

- 包名称
- 价格
- 点数
- 展示文案
- 上下架状态

验收：

- admin 可修改价格和点数。
- admin 可上下架额度包。

### 8.8 模型调用日志

用途：查看基础模型调用情况。

页面内容：

- 用户 ID
- 角色
- 模型档位
- 模型名称
- token 估算
- 费用估算
- 调用状态
- 时间

验收：

- admin 可查看基础模型调用记录。

## 9. 关键状态设计

小程序需覆盖：

- 首次登录
- 加载中
- 空角色/无会话
- 流式生成中
- 发送失败
- 点数不足
- 支付成功
- 支付失败
- 安全拦截
- 内容生成完成

admin 需覆盖：

- 表格空状态
- 加载中
- 筛选无结果
- 登录失败
- 标记成功
- 保存备注成功
- 支付状态异常

## 10. 给 Google Stitch 的总提示词

可直接复制给 Stitch：

```text
Design a WeChat mini program UI for a soft Material Design inspired AI role-playing chat product.

The product lets users enter one script-world, choose one of three AI characters, and have streaming text conversations. The UI should feel soft, emotional, readable, and Material You inspired. It should have role-playing atmosphere without becoming a hard detective dossier or dark game interface.

First version screens:
- Login / authorization
- Home with script-world intro and 3 character cards
- Character detail
- Single-character streaming chat
- Chat history
- Read-only memory summary
- My page
- Points package purchase
- Payment result
- Lightweight share poster preview

Core constraints:
- WeChat mini program, mobile portrait
- No web/H5/Android consumer UI
- No group chat in v1
- No voice or image input
- Text streaming chat only
- Use model tiers: 轻松, 标准, 沉浸
- Use mood labels: Neutral, Happy, Sad, Angry, Thinking
- User quota unit is 点数
- Show AI generated content notice

Visual style:
- Soft Material Design / Material You inspired
- Use tonal surfaces, rounded cards, clear hierarchy, soft elevation
- Character cards should feel warm, personal, and story-driven
- Chat should be highly readable and calm
- Use soft warm surfaces, berry primary, sage secondary, amber for points/payment
- Avoid hard detective dossier styling
- Avoid generic purple gradients
- Avoid dark game UI
- Avoid overly decorative textures

Also design a simple internal admin UI:
- Dashboard
- Conversation list
- Message detail
- Order list
- Wallet transaction list
- Quota package config
- Model usage log

Admin style should be restrained, table-first, clear, and operational.
```

## 11. Stitch 分屏提示词

### 11.1 小程序首页

```text
Create the home screen for a WeChat mini program soft Material AI role-playing app.
Show one script-world intro at the top and three warm character cards below.
Each character card includes avatar, name, identity, short description, and relationship hint.
Include points balance and current model tier.
Bottom tabs: 首页, 对话, 记忆, 我的.
Style: soft Material Design, readable, warm, rounded, calm, not too dark.
```

### 11.2 聊天页

```text
Create a single-character streaming chat screen.
Header shows character avatar, name, identity, bond level, and points balance.
Include segmented model tier control: 轻松, 标准, 沉浸.
Chat bubbles distinguish user and AI.
AI bubble shows mood label: Neutral, Happy, Sad, Angry, Thinking.
Show streaming generation state.
Input area supports text only.
Include share poster button.
No voice, no image, no group chat.
```

### 11.3 我的页与点数购买

```text
Create the My page and points purchase page for a WeChat mini program.
My page shows user profile, points balance, achievements, titles, and purchase entry.
Purchase page shows three quota packages with price, points, description, and one recommended package.
Use 点数 as the quota unit.
Include payment result states: success, failed, cancelled, pending.
```

### 11.4 admin

```text
Create a simple internal admin dashboard for the AI role-playing mini program.
Use a left sidebar and table-first layout.
Pages: dashboard, conversation list, message detail, order list, wallet transactions, quota package config, model usage logs.
Keep it clean, operational, dense but readable.
Do not make it a marketing page.
```

## 12. 待补充设计素材

- 三个角色头像
- 角色名称与身份
- 剧本世界观标题
- 品牌名称
- 分享图水印
- 三个额度包价格和点数
- 是否有指定 logo
