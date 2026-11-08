/**
 * Chinese copy for the model tier console (AC-15 / AC-17). One module so the list, the editor, the
 * version history and the check panel cannot drift, and so the sentences that carry the honesty
 * contract (no provider round-trip, no credential input, restore is append-only, disabled is not
 * usable) are asserted as text instead of scattered JSX literals.
 */
import type { ModelConsistencyCheck, ModelConsistencyStatus } from '@/server/modules/admin/index.js';
import type { ModelRuntimeParams } from '@/server/modules/admin/model-runtime-params.js';
import { describeModelFields, formatModelRuntimeParams } from './model-patch.js';

export const MODEL_RUNTIME_NOTE =
  '实际推理模型由 FastClaw Agent 配置决定：档位只承载计费、展示与声明的运行参数，本页不修改 FastClaw 的模型设置，也不向请求体添加 model。';

export const MODEL_SECRET_NOTE =
  '本页不保存、不接收任何密钥：模型密钥只配置在服务器环境变量中，控制台只显示服务商与模型名；任何密钥字段都会被接口拒绝。';

export const MODEL_DISABLED_NOTE =
  '禁用档位后，新回合会被直接拒绝（model_profile_unavailable）；已接受的在途回合仍按接受时的快照继续，不会被暗中改档。';

export const MODEL_RESTORE_NOTE = '恢复会生成新版本，不改动历史：历史版本不可变，也不会被删除。';

export const MODEL_CHECK_NOTE =
  '只读一致性核对：只读取 FastClaw 报告的运行配置，不做真实服务商调用，也不需要在本页输入任何密钥。';

export const MODEL_CHECK_HONESTY_NOTE = '无法核对不等于成功：FastClaw 未配置、没有映射到 Agent 或读取失败时，结论都是「无法核对」。';

export const MODEL_DISABLED_TIER_WARNING =
  '该档位已禁用：禁用状态下即使发布也不会被新回合使用（model_profile_unavailable），恢复历史版本同样只改配置。';

export const MODEL_EMPTY = '暂无模型档位。档位由迁移或初始化写入，本页不创建新档位。';
export const MODEL_VERSION_EMPTY = '该档位还没有版本记录。';

export const MODEL_FORM_LABEL_HINTS = {
  provider: '服务商',
  modelName: '模型名',
  pointsPerCall: '每次点数',
  description: '说明',
} as const;

export const MODEL_DESCRIPTION_LABEL_NOTE = '说明只用于后台展示，不参与推理。';

export const MODEL_PUBLISH_CONFIRMATION =
  '我确认发布当前保存的配置：会生成一个新的已发布版本，之后的新回合使用它；禁用档位即使发布也不会被新回合使用。';

/**
 * The restore confirmation. Restore copies the whole declared payload, so when the named version
 * declares runtime parameters the confirmation names them instead of letting the operator believe only
 * the visible price changes.
 */
export function modelRestoreConfirmation(versionNo: number, runtimeParams?: ModelRuntimeParams): string {
  const base = `我确认恢复版本 v${versionNo}：恢复会生成新版本，不改动历史；历史版本保持原样，不会被改写或删除。`;
  if (!runtimeParams) return base;
  return `${base}恢复后的声明运行参数：${formatModelRuntimeParams(runtimeParams)}。`;
}

export const MODEL_CHECK_STATUS_LABELS: Record<ModelConsistencyStatus, string> = {
  match: '一致',
  mismatch: '不一致',
  unavailable: '无法核对',
};

export const MODEL_CHECK_REASON_COPY: Record<string, string> = {
  no_published_version: '该档位还没有已发布的版本，没有可核对的配置。',
  no_agent_mapped: '当前没有可映射的 Agent（没有绑定 Agent 的已启用角色，也没有配置默认 Agent），无法核对。',
  fastclaw_not_configured: '当前环境没有配置 FastClaw 地址或密钥，无法核对。',
  agents_unavailable: '至少一个 Agent 的运行配置读取失败，无法核对（读取失败不等于一致）。',
};

export const MODEL_OPS_NOTES = {
  runtime: MODEL_RUNTIME_NOTE,
  secret: MODEL_SECRET_NOTE,
  disabled: MODEL_DISABLED_NOTE,
  restore: MODEL_RESTORE_NOTE,
} as const;

export function describeModelSave(result: {
  changed: boolean;
  changedFields: string[];
  auditStatus?: string;
  dedupeKey?: string | null;
}): string {
  if (result.auditStatus === 'pending') {
    return `配置已保存并生成新版本（${describeModelFields(result.changedFields)}），但审计尚未收尾（审计待恢复）。`
      + `不要重复提交同一改动；可用幂等标识 ${result.dedupeKey ?? '（未返回）'} 走收尾接口核对。`;
  }
  if (!result.changed) return '当前档位已经是最新配置，本次没有写入，也没有新增版本或审计记录。';
  return `已保存并发布新版本；本次变更：${describeModelFields(result.changedFields)}。历史版本保持不变。`;
}

export function describeModelPublish(result: {
  created: boolean;
  sourceVersion?: { versionNo: number } | null;
  version: { versionNo: number };
  changedFields?: string[];
  auditStatus?: string;
  dedupeKey?: string | null;
}): string {
  if (result.auditStatus === 'pending') {
    return `版本 v${result.version.versionNo} 已写入，但审计尚未收尾（审计待恢复）。`
      + `不要重复发布同一配置；可用幂等标识 ${result.dedupeKey ?? '（未返回）'} 走收尾接口核对。`;
  }
  if (!result.created) return '当前配置已经是最新发布版本，本次没有生成新版本。';
  if (result.sourceVersion) {
    return `已从版本 v${result.sourceVersion.versionNo} 恢复：生成了新版本 v${result.version.versionNo} 并发布；历史版本未被改动。`;
  }
  return `已发布为版本 v${result.version.versionNo}；之后的新回合使用该版本。`;
}

export function describeModelCheck(check: ModelConsistencyCheck): string {
  const label = MODEL_CHECK_STATUS_LABELS[check.status];
  if (check.status === 'unavailable') {
    return `${label}：${MODEL_CHECK_REASON_COPY[check.reason ?? ''] ?? '无法完成核对。'}`;
  }
  if (check.status === 'mismatch') {
    const agents = check.agents.filter(agent => agent.status === 'mismatch').map(agent => agent.agentId);
    return `${label}：FastClaw 报告的运行配置与该档位声明不符（${agents.join('、')}）。`;
  }
  return `${label}：${check.agents.length} 个 Agent 报告的运行配置与该档位声明一致（未做真实服务商调用）。`;
}

/** Server error codes are stable keys; the console maps them instead of echoing English text. */
export function modelFailureCopy(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'model_edit_conflict':
      return '该档位已被其他管理员保存，页面数据已过期。请刷新后重新编辑，本次没有覆盖任何配置。';
    case 'model_publish_idempotency_conflict':
      return '该幂等标识已用于另一次模型发布，本次未做任何修改。请重新生成幂等标识后重试。';
    case 'model_tier_immutable':
      return '档位（casual/standard/immersive）不可修改，只能修改该档位的配置。';
    case 'model_secret_field_rejected':
      return '请求里包含密钥类字段，已拒绝：控制台不接受任何密钥，密钥只能配置在服务器环境变量中。';
    case 'admin_input_invalid':
      return '填写内容不符合要求，请检查服务商、模型名、点数与运行参数后重试。';
    case 'model_publish_audit_conflict':
      return '审计收尾失败：原有审计意图无法确认，未做收尾，也未重复发布。';
    default:
      return fallback;
  }
}
