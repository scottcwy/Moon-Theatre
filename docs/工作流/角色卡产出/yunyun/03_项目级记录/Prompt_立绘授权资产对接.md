# Prompt：立绘/授权资产对接（复制到新会话使用）

> 用途：在另一个 Codex/对话会话中，把现有立绘/授权素材与官方海报对应到《芸芸》所需前端资产（6 角色头像 + 剧本封面），并替换当前盲裁占位图。
> 准备：新会话需要能读取仓库 `/Users/macbookpro/Desktop/Codex/剧本杀角色扮演小程序` 与素材目录 `/Users/macbookpro/Desktop/芸芸/`、`芸芸素材/`。若你支持看图，请先逐张查看海报再裁切，保证脸部/主体居中不截断。

---

```
你在 /Users/macbookpro/Desktop/Codex/剧本杀角色扮演小程序 仓库执行「立绘/授权资产对接」。目标是让《芸芸》的前端资产与 seed 数据完全对应，并把现有占位头像替换为按海报校准后的版本。

## 一、背景与约束
1. 《芸芸》seed 已入库：slug=yunyun，6 角色头像 URL 固定为 /assets/characters/<latin>.jpg（nanchuang/fuxiao/cenyilan/jicanghai/zhihe/yeshangqiu）；剧本封面约定 /assets/home/yunyun-cover.jpg（本地映射在 apps/miniapp/src/pages/home/index.model.ts 的 LOCAL_SCRIPT_COVERS，若加封面需同步加 'yunyun' 条目）。
2. 现有 6 张占位头像（apps/miniapp/src/assets/characters/<latin>.jpg，600×600）是从官方海报“中心偏上盲裁”生成的，可能未对准人物；你的任务是用“看图”能力校准裁切区域后重新生成。
3. 素材来源：
   - 官方角色海报（竖版 PNG）：/Users/macbookpro/Desktop/Codex/剧本杀角色扮演小程序/芸芸素材/01_角色海报_南窗.png、02_赋霄、03_岑奕岚、04_季沧海、05_知何、06_叶上秋（均为官方宣传图，版权归不俗工作室，仅限学习/非商用，正式上架需替换为授权立绘）
   - 剧本主视觉封面：芸芸素材/00_主视觉封面_沧海浮尘.png
   - 额外金句/横幅：芸芸素材/07_金句_知何_抵御者.jpg、08_金句_知何_山高路远.jpg、09_剧情横幅_知何.jpg、10_剧情横幅_赋霄.jpg（可按需用于角色详情/宣传位）
4. 命名必须与 seed avatarUrl 完全一致（latin 小写）；格式 jpg；目标 600×600；单张 ≤100KB（仓库有主包 ≤2MB 的历史约束，apps/miniapp/scripts/verify-weapp-build.test.mjs 会校验，跑测试确认）。
5. 月满楼只是项目名，不是场景；本任务只做图片资产，不涉及世界观。

## 二、任务清单
1. 【看图校准】逐张查看 6 张角色海报，确定每个人物的最佳方形裁切区（脸/上半身居中、不截头顶、不被文字水印遮挡），裁切→缩放 600×600→JPEG（quality 80–85，optimize）→覆盖 apps/miniapp/src/assets/characters/<latin>.jpg。若某张海报裁不出合格头像，保留现有占位并注明。
2. 【剧本封面】从 00_主视觉封面_沧海浮尘.png 生成 apps/miniapp/src/assets/home/yunyun-cover.jpg（建议与现有 moon-garden-cover.jpg 尺寸/比例一致，先查看现有封面的宽高再定；压缩 ≤200KB）。若已生成，同步在 apps/miniapp/src/pages/home/index.model.ts 的 LOCAL_SCRIPT_COVERS 加 `'yunyun': '/assets/home/yunyun-cover.jpg'`。
3. 【可选】金句/横幅按需复制到 apps/miniapp/src/assets/ 下合适位置（命名自定，中文可保留），用于后续角色详情页；不做则跳过。
4. 【验证】跑 `pnpm --filter @juben-sha/miniapp test`（必须全绿，含 verify-weapp-build 主包校验）；如需构建再跑 `pnpm --filter @juben-sha/miniapp build`。
5. 【输出清单】Markdown 报告：每张资产的来源文件、裁切参数（x,y,w,h）、输出路径、文件大小、是否替换占位；封面是否生成及 LOCAL_SCRIPT_COVERS 是否更新；未完成项与原因。

## 三、不要做
- 不要修改 apps/api/src/server/seed/story-data.ts 里的 avatarUrl（已是最终路径）。
- 不要改动 6 个角色之外的头像/封面，不影响现有 moon-garden/moon-tower 资产。
- 不要使用网络下载的图片（版权）；只用上述本地素材。
- 不要写“月满楼”作为场景/世界观到任何资产元数据或文档。
```

---

### 完成后要回填
- 更新 `docs/工作流/角色卡产出/yunyun/03_项目级记录/角色处理进度.md`（资产项：占位→已校准/待授权）
- 若生成封面并改 home/index.model.ts，跑 miniapp 测试确认后同步 `项目对接草稿.md` 的资产段
