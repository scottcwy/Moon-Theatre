/**
 * Presentation vocabulary for the character editor and publish surfaces.
 *
 * Pure functions only: the same labels are used by server-rendered pages and by the client forms,
 * and nothing here talks to a service or to an image. Field-level messages come from the shared
 * content contract (`ValidationIssue.path`/`message`); the raw English text is never rendered.
 */

const FIELD_LABELS: Record<string, string> = {
  name: '姓名',
  avatarUrl: '头像',
  identity: '身份',
  description: '简介',
  initialRelationship: '关系起点',
  agentId: 'Agent 标识',
  sortOrder: '排序',
  scriptId: '归属剧本',
  starterQuestions: '开场引导',
  'starterQuestions.script': '剧本开场引导',
  'starterQuestions.free': '自由开场引导',
  'prompt.systemPrompt': '系统人设',
  'prompt.personalityPrompt': '性格人设',
  'prompt.scenarioPrompt': '场景人设',
  'prompt.safetyPrompt': '安全约束',
  'prompt.outputFormatPrompt': '输出格式',
  prompt: '角色人设',
};

export interface ValidationIssueLike {
  path: string;
  message: string;
}

export function characterFieldLabel(path: string): string {
  const base = path.replace(/\[\d+\]$/, '');
  return FIELD_LABELS[base] ?? path;
}

function issueMessage(message: string): string {
  if (message === 'is required') return '为必填项';
  if (message === 'must be a string') return '必须为文本';
  if (message === 'must be an array') return '必须为列表';
  if (message === 'must contain at most 12 questions') return '最多 12 条';
  const characters = /^must be at most (\d+) characters$/.exec(message);
  if (characters) return `最多 ${characters[1]} 个字符`;
  if (message === 'must be a stable role-* routing id') return '须为稳定的 role-* 标识';
  if (message === 'script questions require a scriptId') return '剧本开场引导需要先归属剧本';
  if (message === 'must be an integer') return '必须为整数';
  if (message === 'must be between 0 and 100000') return '须在 0 到 100000 之间';
  return '格式不符合要求';
}

/** One Chinese sentence per validation issue, e.g. `系统人设：为必填项`. */
export function fieldIssueText(issue: ValidationIssueLike): string {
  return `${characterFieldLabel(issue.path)}：${issueMessage(issue.message)}`;
}

export interface CharacterReadiness {
  level: 'none' | 'warning';
  label: string;
  missingFields: string[];
  details: string[];
}

const READY: CharacterReadiness = { level: 'none', label: '', missingFields: [], details: [] };

/**
 * Turns the stored validation state into the reason an operator can act on. Only content that is
 * live (or would be republished) is flagged: an unpublished character is a deliberate state, and
 * nothing is flagged without evidence from the published version.
 */
export function describeCharacterReadiness(input: {
  status: string;
  publishedVersionId: string | null;
  validity: { valid: boolean; issues: ValidationIssueLike[] } | null;
}): CharacterReadiness {
  if (input.status !== 'active') return READY;
  if (!input.publishedVersionId) {
    return { level: 'warning', label: '线上版本缺失：新回合会被拒绝，需发布一次', missingFields: [], details: [] };
  }
  if (!input.validity || input.validity.valid) return READY;
  const missingFields = [...new Set(input.validity.issues.map(issue => characterFieldLabel(issue.path)))];
  return {
    level: 'warning',
    label: `内容待补全：${missingFields.join('、')}`,
    missingFields,
    details: input.validity.issues.map(fieldIssueText),
  };
}

/**
 * Publishing needs the bound script to be on the shelf (`character_script_unavailable`). The status is
 * already stored, so the warning is a preflight fact, not a guess — content validation passing does
 * not make the character publishable while the script is inactive.
 */
export const SCRIPT_UNAVAILABLE_WARNING = '归属剧本未上架：发布前需先上架剧本，否则发布会失败。';

export function scriptPublishWarning(scriptStatus: string | null | undefined): string | null {
  if (!scriptStatus || scriptStatus === 'active') return null;
  return SCRIPT_UNAVAILABLE_WARNING;
}

export interface ImageRisk {
  level: 'warning' | 'info';
  message: string;
}

const IMAGE_NOTE = '尺寸与裁切需人工确认：后台不处理图片，头像按 1:1、剧本封面按 16:9 展示，超出比例可能被裁切。';

/**
 * Display risks that can be told from the payload alone. No image is fetched, decoded or resized,
 * so the aspect-ratio question stays an explicit manual check.
 */
export function describeImageRisks(input: {
  avatarUrl: string;
  scriptCoverUrl: string | null;
  scriptTitle: string | null;
}): ImageRisk[] {
  const risks: ImageRisk[] = [];
  const avatar = input.avatarUrl.trim();
  if (!avatar) risks.push({ level: 'warning', message: '头像为空：小程序卡片会显示占位图，请补充头像地址。' });
  else if (!avatar.startsWith('https://')) risks.push({ level: 'warning', message: '头像地址不是 HTTPS：正式环境可能无法加载。' });
  if (input.scriptTitle) {
    const cover = (input.scriptCoverUrl ?? '').trim();
    if (!cover) risks.push({ level: 'warning', message: `剧本《${input.scriptTitle}》没有封面：剧本卡片会显示占位图。` });
    else if (!cover.startsWith('https://')) risks.push({ level: 'warning', message: '剧本封面地址不是 HTTPS：正式环境可能无法加载。' });
  }
  risks.push({ level: 'info', message: IMAGE_NOTE });
  return risks;
}

export interface PublishTaskState {
  tone: 'ok' | 'warn' | 'error' | 'none';
  label: string;
}

/**
 * Batch 3 step 1 (plan W) — presentation of the derived FastClaw base context.
 *
 * Two independent facts are shown, never merged: the RECORDED base context (`b#` + capture time) and
 * whether the live FastClaw files still match it. "控制台已被手改" is only said when the files were
 * actually read and differ; an unreachable FastClaw says so instead.
 */
export type BaseContextStatusLike = 'synced' | 'pending' | 'unchanged' | 'failed';
export type BaseContextDriftLike = 'in-sync' | 'drifted' | 'unavailable' | 'unrecorded';

export interface BaseContextView {
  status: BaseContextDriftLike;
  recorded: { displayNo: number; createdAt: string | Date; source: string } | null;
  live: { readable: boolean };
  matchesPublished: boolean | null;
}

/** One sync outcome as the API reports it: a status, a machine reason and whether files really landed. */
export interface BaseContextSyncLike {
  status: BaseContextStatusLike;
  reason?: string | null;
  written?: boolean;
}

export const BASE_CONTEXT_DRIFT_NOTICE = '控制台已被手改，与已发布版本不一致';
export const BASE_CONTEXT_UNRECORDED = '基础上下文未记录';
export const BASE_CONTEXT_UNAVAILABLE = 'FastClaw 不可用，无法核对基础上下文';

const BASE_CONTEXT_SOURCE_LABELS: Record<string, string> = {
  publish: '发布时记录',
  manual: '手动重建',
  startup: '启动时记录',
};

export function baseContextSourceLabel(source: string): string {
  return BASE_CONTEXT_SOURCE_LABELS[source] ?? source;
}

/**
 * One Chinese label + sentence per sync outcome. Each status says only what is true of that call:
 * `written` is false unless all three files really landed, a failed read-back is 校验失败 (not a write
 * failure: the PUT returned 200), and `record_failed` says the files ARE updated while the record is
 * missing — never "FastClaw 未更新".
 */
export function describeBaseContextSync(result: BaseContextSyncLike): PublishTaskState & { note: string } {
  const reason = result.reason ?? '';
  if (result.status === 'synced') {
    return {
      tone: 'ok',
      label: '已同步',
      note: result.written === false
        ? 'FastClaw 中的基础上下文已与已发布版本一致，本次只补记录了版本。'
        : '已按已发布版本重新生成 SOUL.md / IDENTITY.md / USER.md，写入并通过回读校验，同时记录了基础上下文版本。',
    };
  }
  if (result.status === 'unchanged') {
    return { tone: 'ok', label: '内容未变', note: '基础上下文已与已发布版本一致，没有写入文件，也没有新增记录。' };
  }
  if (result.status === 'pending') {
    return {
      tone: 'warn',
      label: '待同步',
      note: 'FastClaw 当前不可用：没有写入任何文件，也没有记录新版本；FastClaw 恢复后可重建基础上下文。',
    };
  }
  if (reason === 'record_failed') {
    if (result.written) {
      return {
        tone: 'warn',
        label: '未记录',
        note: '三份文件已写入 FastClaw 并通过回读校验，但基础上下文版本记录失败：FastClaw 内容已是该版本，可再执行一次重建以补记录。',
      };
    }
    return {
      tone: 'warn',
      label: '未记录',
      note: '本次重建没有写入任何文件（内容已是最新），但补记录失败：FastClaw 内容未变，可再执行一次重建以补记录。',
    };
  }
  if (reason === 'base_context_sync_error') {
    return {
      tone: 'error',
      label: '同步异常',
      note: '基础上下文同步过程出现异常，未达到可确认的结果：没有记录新版本，请稍后重试。',
    };
  }
  if (reason.startsWith('write_not_verified')) {
    return {
      tone: 'error',
      label: '校验失败',
      note: '写入请求返回成功，但回读内容与已发布版本不一致：没有记录新版本，请稍后重试并确认 FastClaw 可用。',
    };
  }
  return {
    tone: 'error',
    label: '写入失败',
    note: reason === 'character_version_unavailable' || reason === 'character_agent_unavailable'
      ? '没有可写入的已发布版本或 Agent 标识：没有写入文件，也没有记录新版本。'
      : 'FastClaw 没有接受这次写入：没有记录新版本，已发布版本保持不变；可稍后重建重试。',
  };
}

/** `基础上下文：b1 · 2026-11-07 10:00 · 已同步` or the honest "not recorded"/"unavailable" text. */
export function describeBaseContext(view: BaseContextView | null): {
  tone: 'ok' | 'warn' | 'error' | 'none';
  label: string;
  badge: string;
  notice: string | null;
} {
  if (!view || !view.recorded) {
    return { tone: 'warn', label: BASE_CONTEXT_UNRECORDED, badge: BASE_CONTEXT_UNRECORDED, notice: null };
  }
  const badge = `b${view.recorded.displayNo}`;
  if (view.status === 'in-sync') {
    return { tone: 'ok', label: '已同步', badge, notice: null };
  }
  if (view.status === 'drifted') {
    return { tone: 'warn', label: '不一致', badge, notice: BASE_CONTEXT_DRIFT_NOTICE };
  }
  // `unavailable`: the files could not be read, so nothing is claimed about them.
  return { tone: 'warn', label: '不可用', badge, notice: BASE_CONTEXT_UNAVAILABLE };
}

/** A task that only committed its audit intent is never described as complete success. */
export function describePublishTask(task: { status: string; recoveryState: string | null } | null): PublishTaskState {
  if (!task) return { tone: 'none', label: '暂无发布任务' };
  // A failed attempt is reported as a failure even when its audit step is still pending: a pending
  // audit never upgrades the outcome, and only a committed task can be "awaiting audit recovery".
  if (task.status === 'failed') return { tone: 'error', label: '发布失败' };
  if (task.recoveryState === 'audit_pending') return { tone: 'warn', label: '已提交，审计待恢复' };
  if (task.status === 'committed') return { tone: 'ok', label: '发布成功' };
  if (task.status === 'processing') return { tone: 'warn', label: '处理中' };
  return { tone: 'warn', label: '结果未知' };
}
