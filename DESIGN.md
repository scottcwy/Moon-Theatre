# 剧本杀角色扮演小程序 DESIGN.md

## 1. 文档定位

本文档是项目的长期设计系统源文档，用于指导微信小程序 C 端和简单 admin 的界面设计与前端实现。

本文档参考 Material Design 3 / Material You 的设计方法，但不照搬通用紫色 seed。项目采用更贴合角色陪伴、剧本关系和轻量沉浸感的 Material Soft Roleplay 方向。

参考来源：

- `docs/prd-v1.md`
- `docs/technical-spec-v1.md`
- `docs/ui-design-prd-google-stitch.md`
- 用户确认的 Figma 设计稿：<https://www.figma.com/design/ACLI3DRcjPUZ1RzKOIFoCS/%E8%A7%92%E8%89%B2%E6%89%AE%E6%BC%94%E5%B0%8F%E7%A8%8B%E5%BA%8F%E8%AE%BE%E8%AE%A1?t=Sn2XRppnDNQoPotV-0>
- 用户提供的 Material You 设计系统 prompt

范围优先级：

1. 第一版功能范围以 `docs/prd-v1.md` 和 `docs/technical-spec-v1.md` 为准。
2. 小程序首版只做首页、对话、记忆、我的四个底部 tab。
3. 首版不做群聊、Galgame、复杂表情包、社区、宿舍、正式实名、防沉迷。
4. 界面细节以用户确认的 Figma 设计稿和本文档为准，尤其是底部导航、页面结构、角色页和对话页细节。
5. 点数、额度包、真实第三方聚合支付、微信小程序支付拉起、回调验签和幂等入账为 V1 必做闭环，不做 demo 占位。

## 2. 产品气质

产品不是普通 AI 聊天工具，也不是硬质侦探档案或深色游戏面板。

它应该像一个柔和、可持续进入的角色世界：用户能快速理解角色、关系、情绪和点数状态，在聊天时感到清晰、亲近、有一点故事感，但不会被重装饰、复杂动效或游戏 UI 压住。

设计关键词：

- 柔和
- 角色关系
- 陪伴感
- 轻量沉浸
- 清晰聊天
- Material tonal surfaces
- 克制 admin

禁用方向：

- 大面积暗黑游戏 UI
- 硬质侦探档案风
- 大面积紫蓝渐变
- 高压迫红黑悬疑风
- 复杂纹理、羊皮纸、血迹、金属边框
- 卡片堆叠过重的装饰化界面
- 纯营销落地页式首屏

## 3. 设计原则

### 3.1 C 端原则

- 角色优先：角色头像、昵称、身份、关系状态应始终是高优先级信息。
- 聊天可读：聊天页要比视觉装饰更重要，气泡、输入区、流式状态必须稳定清楚。
- 状态可感知：羁绊、mood、模型档位、点数余额需要轻量但明确。
- 柔和沉浸：通过 tonal surface、圆角、微弱 elevation 和角色文案营造氛围，不依赖重纹理。
- 不暴露复杂系统：记忆、成就、点数、模型档位都要用户能理解，但不能像后台参数面板。

### 3.2 Admin 原则

- 表格优先：admin 主要服务查看、筛选、标记、配置。
- 密度适中：比 C 端更紧凑，但不要压缩到难读。
- 状态醒目：异常、支付失败、待处理、已完成等状态必须可扫描。
- 与 C 端共享 tokens：颜色、圆角、状态标签语义一致，但布局更克制。

## 4. 视觉方向

设计方向名：Material Soft Roleplay。

基于 Material You 的核心方法：

- 使用 tonal surfaces 代替纯白和重边框。
- 使用柔和、统一的大圆角。
- 使用 pill button、chip、segmented control 表达状态和选择。
- 使用轻微 elevation 和状态层表达交互。
- 使用顺滑、短促的微动效，不做夸张游戏动效。

项目特化：

- Primary 不使用通用 MD3 紫色，改为柔和莓果色。
- Secondary 使用鼠尾草绿或灰青色，承接关系、记忆、正向状态。
- Tertiary 使用柔和琥珀色，专门承接点数、支付、额度包。
- 背景保持暖白和浅灰粉，不使用纯白。
- 角色相关页面允许少量暖色氛围，但不能出现大面积渐变背景。

## 5. 色彩系统

颜色实现建议使用 CSS variables。小程序端可落到 SCSS/CSS 变量，admin Web 可映射到 Tailwind theme 或 shadcn CSS variables。

### 5.1 Light Theme

| Token | Hex | 用途 |
| --- | --- | --- |
| `--color-background` | `#FFFBF8` | App 主背景，暖白，不用纯白 |
| `--color-on-background` | `#211A1C` | 主文字，温暖近黑 |
| `--color-surface` | `#FFFBF8` | 页面基础 surface |
| `--color-surface-container-low` | `#F8F0EE` | 输入区、低强调容器 |
| `--color-surface-container` | `#F1E7E4` | 卡片、列表、底部导航 |
| `--color-surface-container-high` | `#EADFDB` | 高层级卡片、sheet |
| `--color-on-surface` | `#211A1C` | surface 上主文字 |
| `--color-on-surface-variant` | `#5A4A4E` | 次级文字、图标 |
| `--color-outline` | `#897A7E` | 低频边框、分割 |
| `--color-outline-variant` | `#D8C2C7` | 弱分割、表格线 |
| `--color-primary` | `#8B4258` | 主按钮、当前态、关键关系动作 |
| `--color-on-primary` | `#FFF7F8` | primary 上文字 |
| `--color-primary-container` | `#FFD9E1` | tonal 主色容器 |
| `--color-on-primary-container` | `#3A0718` | 主色容器文字 |
| `--color-secondary` | `#5D6F5A` | 记忆、关系、正向辅助 |
| `--color-on-secondary` | `#F7FFF3` | secondary 上文字 |
| `--color-secondary-container` | `#DDE8D4` | secondary tonal 容器 |
| `--color-on-secondary-container` | `#192517` | secondary 容器文字 |
| `--color-tertiary` | `#8A5A16` | 点数、支付、额度包 |
| `--color-on-tertiary` | `#FFF8EF` | tertiary 上文字 |
| `--color-tertiary-container` | `#FFDFA7` | 点数 tonal 容器 |
| `--color-on-tertiary-container` | `#2C1700` | 点数容器文字 |
| `--color-error` | `#BA1A1A` | 错误、安全拦截 |
| `--color-error-container` | `#FFDAD6` | 错误 tonal 容器 |
| `--color-success` | `#3E6B47` | 支付成功、保存成功 |
| `--color-warning` | `#8A5A16` | 余额不足、待确认 |

### 5.2 Dark Theme

C 端首版不建议默认暗色。若后续提供暗色主题，应避免侦探档案式黑红压迫感，使用温暖深棕灰和低饱和莓果色。

| Token | Hex | 用途 |
| --- | --- | --- |
| `--color-background-dark` | `#1B1718` | 暗色背景 |
| `--color-on-background-dark` | `#F2E4E4` | 暗色主文字 |
| `--color-surface-dark` | `#241F20` | 暗色 surface |
| `--color-surface-container-dark` | `#30292B` | 暗色容器 |
| `--color-primary-dark` | `#F4B6C5` | 暗色 primary |
| `--color-secondary-dark` | `#C1CCB8` | 暗色 secondary |
| `--color-tertiary-dark` | `#F6C677` | 暗色 tertiary |

### 5.3 Mood Tokens

| Mood | Token | 表现 |
| --- | --- | --- |
| Neutral | `--mood-neutral` | 灰粉 tonal chip |
| Happy | `--mood-happy` | 柔和绿 / 暖黄 chip |
| Sad | `--mood-sad` | 蓝灰 chip |
| Angry | `--mood-angry` | 柔和红 chip |
| Thinking | `--mood-thinking` | 灰紫 / 灰蓝 chip，允许轻微 loading 点 |

首版 mood 枚举只使用 Neutral、Happy、Sad、Angry、Thinking。不要新增 Shy 等未在 PRD 中冻结的状态，除非同步更新 PRD、接口和文案。

## 6. 字体系统

### 6.1 C 端小程序

微信小程序端优先使用系统字体，保证性能和兼容性：

```text
font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
```

字号层级：

| Token | Size | Line Height | 用途 |
| --- | --- | --- | --- |
| `display-sm` | 28px | 36px | 首页世界观标题、角色详情主标题 |
| `headline-md` | 22px | 30px | 页面标题、重点模块标题 |
| `title-lg` | 18px | 26px | 卡片标题、角色昵称 |
| `title-md` | 16px | 24px | 分区标题、按钮文字 |
| `body-lg` | 16px | 26px | 聊天正文 |
| `body-md` | 14px | 22px | 普通说明、列表正文 |
| `label-md` | 13px | 18px | chip、tab、metadata |
| `label-sm` | 12px | 16px | 时间、弱提示、水印 |

规则：

- 聊天正文优先可读，建议 `16px / 26px`。
- 标签和按钮使用 500 或 600 字重。
- 不使用负 letter spacing。
- 长文案限制在 65-75 个中文字符等效宽度内，移动端自然换行。

### 6.2 Admin

Admin 可使用更中性的系统字体或项目 Web 已有字体。字号更紧凑：

- 页面标题：24px / 32px
- 表格正文：14px / 22px
- 表格辅助信息：12px / 16px
- 按钮和筛选控件：13-14px

## 7. Shape、Spacing、Elevation

### 7.1 Radius

| Token | Value | 用途 |
| --- | --- | --- |
| `radius-xs` | 8px | 小标签、紧凑控件 |
| `radius-sm` | 12px | 输入框、小卡片 |
| `radius-md` | 16px | 默认容器、列表项 |
| `radius-lg` | 24px | 角色卡、额度包卡、成就卡 |
| `radius-xl` | 28px | Dialog、bottom sheet |
| `radius-2xl` | 32px | 角色详情头部、页面重点容器 |
| `radius-full` | 999px | 按钮、chips、badge、segmented control |

按钮、chips、badge 默认使用 pill。卡片可以大圆角，但不要玩具化；C 端默认 20-24px，admin 默认 12-16px。

### 7.2 Spacing

基础单位：4px。

| Token | Value | 用途 |
| --- | --- | --- |
| `space-1` | 4px | 图标和文字间距 |
| `space-2` | 8px | 小元素间距 |
| `space-3` | 12px | 紧凑组件内边距 |
| `space-4` | 16px | 移动端页面左右边距 |
| `space-5` | 20px | 卡片内边距 |
| `space-6` | 24px | 大卡片内边距 |
| `space-8` | 32px | 模块间距 |
| `space-10` | 40px | 页面大段落间距 |

移动端页面左右安全边距默认 16px。底部输入区、底部导航、支付按钮必须考虑 iOS safe area。

### 7.3 Elevation

Material Soft Roleplay 主要依赖 tonal surfaces，而不是厚重投影。

| Level | 表现 | 用途 |
| --- | --- | --- |
| 0 | 无阴影，仅 surface 分层 | 普通列表、底部导航 |
| 1 | 极轻阴影 | 普通卡片 |
| 2 | 轻微浮起 | 可点击角色卡、额度包卡 hover/press |
| 3 | 中等浮起 | Dialog、bottom sheet、分享预览 |

移动端点击反馈以状态层和轻微 scale 为主，避免大投影跳动。

## 8. Motion

动效目标：顺滑、短促、可预测，像 Material You 的触感反馈，而不是游戏特效。

统一 easing：

```text
cubic-bezier(0.2, 0, 0, 1)
```

时长：

- 点击反馈：120-180ms
- 颜色 / 状态层变化：180-220ms
- 卡片进入和页面局部过渡：240-300ms
- Dialog / bottom sheet：300-400ms

允许：

- 按钮按下 `scale(0.96-0.98)`
- 卡片点击轻微浮起或 tonal state layer
- Thinking mood 的小点 loading
- 流式生成的柔和 typing dots
- 支付成功的短促确认动效

禁止：

- 弹跳、橡皮筋、夸张旋转
- 持续闪烁
- 大范围视差背景
- 影响聊天阅读的动效
- 动画导致布局跳动

必须支持 `prefers-reduced-motion`：用户减少动态效果时，移除 scale、translate 和循环动画，仅保留必要的 opacity/color 反馈。

## 9. 核心组件规范

### 9.1 Button

变体：

- Filled：主要 CTA，例如进入对话、发送、确认支付。
- Tonal：次要动作，例如查看详情、购买入口、保存分享图。
- Outlined：低频操作或 admin 筛选。
- Text：轻量入口，例如 AI 内容说明。
- Icon Button：发送、分享、关闭、更多操作。

规则：

- C 端按钮默认 pill。
- 高度不低于 44px。
- 主要 CTA 使用 primary，支付相关 CTA 可使用 tertiary。
- 发送按钮可使用圆形 icon button，但必须有可访问标签。
- Disabled 状态不只靠颜色，需降低 opacity 并禁用点击。

### 9.2 Card

用途：

- 角色卡
- 额度包卡
- 成就 / 称号卡
- 记忆摘要卡
- Admin 数据卡

规则：

- 默认使用 `surface-container`。
- 通过头像、标题、关系信息和轻微状态标签建立层级。
- 不使用厚边框区分卡片。
- 可点击卡片需要 pressed state。
- 不做嵌套卡片套卡片。需要分组时使用列表、分割线或 tonal section。

### 9.3 Chips / Badge

用途：

- Mood
- 模型档位状态
- 羁绊等级
- 点数余额
- 支付状态
- Admin review 状态

规则：

- 使用 pill。
- 文案短，不超过 6 个中文字符优先。
- 状态不能只靠颜色，应带文字。
- 点数余额使用 tertiary tonal chip。

### 9.4 Segmented Control

用于模型档位：

- 轻松
- 标准
- 沉浸

规则：

- 默认选中标准。
- 选中态使用 primary-container 或 primary。
- 沉浸可显示轻量推荐或高消耗提示，但不做刺激消费话术。
- 切换后应有明确反馈，失败时回滚并提示。

### 9.5 Chat Bubble

AI 气泡：

- 左侧展示角色头像。
- 气泡使用 `surface-container` 或角色轻 tint。
- mood chip 放在气泡头部或底部，不遮挡正文。
- 流式生成时正文区域稳定，不因 loading 变宽变窄。

用户气泡：

- 右侧对齐。
- 可使用 primary-container。
- 文本颜色使用 on-primary-container，保证可读。

规则：

- 聊天正文 16px / 26px。
- 长文本自动换行。
- 错误消息使用 error-container。
- 安全拦截提示不伪装成 AI 回复，应有明确系统状态。

### 9.6 Input

小程序聊天输入区：

- 使用底部固定输入栏。
- 输入框圆角 20-24px。
- 支持多行增长，但设置最大高度。
- 发送按钮固定尺寸，不随文字变化。
- 不展示语音、图片、群聊入口。

Admin 表单输入：

- 可使用 Material filled input 或现有 shadcn input。
- focus ring 明确。
- 错误状态有文字说明。

### 9.7 Dialog / Bottom Sheet

C 端优先使用 bottom sheet：

- 支付确认
- 分享图预览
- 点数不足提示
- AI 内容说明

规则：

- 圆角 28px。
- 底部 CTA 固定且考虑 safe area。
- 关闭按钮使用 icon button。
- 不用 modal 承载复杂流程。

Admin 可使用 dialog、drawer 或详情页：

- 消息详情建议详情页或右侧 drawer。
- 标记异常可用 dialog。
- 大表单避免小 modal。

## 10. 页面规范

### 10.1 登录 / 授权页

目标：让用户知道这是 AI 角色互动产品，并完成微信登录。

结构：

- 产品名或剧本世界标题
- 一句柔和世界观引导
- 微信登录 filled button
- AI 生成内容说明

视觉：

- 背景用暖白 surface。
- 可有轻微角色世界氛围，但不要营销海报化。

### 10.2 首页 / 角色列表

结构：

- 顶部世界观区域
- 点数余额 chip
- 当前模型档位简短状态
- 3 个角色卡片
- 底部导航

规则：

- 首屏应看到世界观和至少一部分角色卡。
- 角色卡之间要有身份和关系差异。
- 不展示群聊、社区、宿舍入口。

### 10.3 角色详情

结构：

- 角色头像 / 半身图
- 昵称、身份
- 人设简介
- 世界观关联
- 初始关系
- 羁绊等级 / 进度
- 当前 mood
- 进入对话 CTA

规则：

- 角色是主视觉。
- 页面像角色介绍卡，不像普通个人主页。
- CTA 固定清楚，不能被装饰抢走。

### 10.4 聊天页

结构：

- 顶部角色栏：头像、昵称、身份、羁绊等级
- 点数余额
- 模型档位 segmented control
- 消息列表
- mood chip
- 流式生成状态
- 输入区
- 分享入口

规则：

- 聊天页以阅读和输入为主。
- 点数和模型档位可见但不能压迫用户。
- Thinking、发送失败、点数不足、安全拦截都要有明确状态。

### 10.5 会话历史

结构：

- 会话列表
- 角色头像
- 标题或首句摘要
- 最近消息预览
- 更新时间

状态：

- 空状态
- 加载
- 错误重试
- 分页 / 分批加载

### 10.6 记忆页

结构：

- 角色维度记忆摘要
- 重要时刻
- 关系状态
- 剧情状态摘要

规则：

- 首版只读。
- 不展示编辑、删除、复杂管理入口。
- 文案应解释“系统整理”，避免让用户误以为这是绝对事实。

### 10.7 我的页

结构：

- 用户头像 / 昵称
- 点数余额
- 购买点数入口
- 已获得称号
- 已获得成就
- AI 内容说明入口

规则：

- 成就展示轻量，不做复杂成就树。
- 点数入口清楚但不营销化。

### 10.8 额度包购买

结构：

- 当前点数
- 3 个额度包
- 价格、点数、说明
- 推荐标签
- 支付按钮
- 支付说明

视觉：

- 额度包使用 tertiary tonal system。
- 推荐包可以轻微 elevation，但不使用强刺激样式。

状态：

- 支付成功
- 支付失败
- 支付取消
- 等待确认
- 点数到账

### 10.9 分享图预览

结构：

- 角色头像
- 昵称
- 精选对话
- AI 内容标识 / 水印
- 产品名或品牌占位

规则：

- 分享图清晰可读。
- 长文本合理截断。
- 不做复杂模板编辑。

### 10.10 Admin

页面：

- 登录页
- Dashboard
- 会话列表
- 消息详情
- 订单列表
- 余额流水
- 额度包配置
- 模型调用日志

布局：

- 桌面端左侧导航 + 顶部标题区 + 内容区。
- 表格优先，卡片只用于概览数据。
- 筛选栏靠近表格，避免把筛选做成大卡片。

状态：

- 正常
- 异常
- 待处理
- 已标记
- 已支付
- 支付失败
- 已退款（后续预留，不在首版复杂实现）

## 11. 空、错、加载状态

C 端必须覆盖：

- 首次登录
- 加载中
- 无会话
- 流式生成中
- 发送失败
- 点数不足
- 支付成功
- 支付失败
- 支付取消
- 安全拦截
- 内容生成完成

Admin 必须覆盖：

- 表格空状态
- 加载中
- 筛选无结果
- 登录失败
- 标记成功
- 保存备注成功
- 支付状态异常

规则：

- 空状态要给下一步，不写空泛鼓励文案。
- 错误状态要说明发生了什么，以及用户能做什么。
- 加载状态使用 skeleton 或明确 loading，不让页面空白。

## 12. Accessibility

基础要求：

- 文字对比度满足 WCAG AA。
- 所有点击目标不小于 44px。
- icon-only button 必须有 `aria-label` 或小程序等价说明。
- 状态不能只靠颜色表达。
- 表单错误必须有文字说明。
- 弹窗打开后焦点或操作范围要清楚。
- 支持减少动态效果。

聊天特殊要求：

- 流式生成中不要频繁移动已读文本。
- mood chip 不能遮挡正文。
- 安全提示和 AI 回复视觉上要区分。

## 13. 实现映射建议

### 13.1 Taro 小程序

建议目录：

```text
apps/miniapp/src/
  styles/
    tokens.scss
    theme.scss
    motion.scss
  components/
    Button/
    Card/
    Chip/
    SegmentedControl/
    ChatBubble/
    BottomSheet/
    EmptyState/
    StatusTag/
```

规则：

- tokens 放在全局样式中，不在页面里散落硬编码颜色。
- 页面样式优先引用 token。
- 角色头像、世界观图、分享图水印放入 assets 并统一命名。
- 不把 admin Web 组件直接复用到小程序。

### 13.2 Next.js Admin

如果使用 shadcn/Tailwind：

- 将本文档 tokens 映射到 `globals.css` CSS variables。
- `primary` 使用莓果色，`secondary` 使用鼠尾草，`chart` 可派生但不要一页多彩。
- 保留 lucide icons。
- 表格、badge、button、dialog 使用统一组件，不在页面内重复写 one-off classes。
- 避免 `zinc-*`、`violet-*`、`gradient-*` 在业务页面中直接硬编码，除非它们已被定义为设计 token。

## 14. 验收清单

设计稿或页面提交前检查：

- 背景不是纯白或大面积纯黑。
- C 端底部 tab 是：首页、对话、记忆、我的。
- 没有群聊、社区、宿舍、语音、图片入口。
- 角色卡有头像、昵称、身份、关系信息。
- 聊天页有角色栏、模型档位、点数余额、mood、流式状态、输入区。
- mood 只使用 Neutral、Happy、Sad、Angry、Thinking。
- 点数和支付使用 tertiary，而不是 error 或 primary。
- 所有主要按钮是 pill。
- 卡片使用 tonal surface，不依赖厚边框。
- 错误、空、加载状态完整。
- 分享图带 AI 内容标识。
- Admin 表格状态可扫描。
- 颜色、圆角、字号来自 tokens，不散落硬编码。

## 15. 待补充

以下内容需要项目方或后续设计阶段补充：

- 产品正式名称
- 剧本世界观标题
- 三个角色名称、身份、头像或半身图
- 品牌 logo
- 分享图水印
- 额度包价格和点数
- 是否需要正式暗色主题
- 是否需要为不同角色配置专属轻 tint 色
