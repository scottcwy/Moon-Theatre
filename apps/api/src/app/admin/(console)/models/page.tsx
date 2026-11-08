import { listAdminModels, listAdminModelVersions } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { AdminTable, LoadError, formatAdminDate } from '../../ui.js';
import { ModelCheckPanel, ModelTierEditor, ModelVersionHistory } from '../../model-forms.js';
import { MODEL_EMPTY, MODEL_OPS_NOTES } from '../../model-copy.js';
import { formatModelRuntimeParams, modelTierLabel } from '../../model-patch.js';

/**
 * Model tier console (AC-15 / AC-17).
 *
 * Three tiers, each with: the live configuration table row, an inline editor with an exact
 * `expectedUpdatedAt` baseline, an explicit publish action, an append-only version history with
 * restore, and a read-only 配置一致性检查 that compares the declared configuration with what FastClaw
 * reports. Nothing on this page accepts a key; the check never performs a provider round-trip and its
 * `unavailable` result is rendered as 无法核对, never as success. The page performs its own identity
 * guard before the first query (the console layout is only a redirect boundary).
 */
export default async function ModelsPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;

  let tiers: Array<{
    profile: Awaited<ReturnType<typeof listAdminModels>>[number];
    versions: Awaited<ReturnType<typeof listAdminModelVersions>>;
  }>;
  try {
    const profiles = await listAdminModels();
    tiers = await Promise.all(profiles.map(async profile => ({
      profile,
      versions: await listAdminModelVersions(profile.id),
    })));
  } catch {
    return <LoadError subject="模型档位" />;
  }

  return (
    <div>
      <h1>模型档位</h1>
      <p className="page-description">
        维护 casual / standard / immersive 三档的计费与展示配置：服务商、模型名、每次消耗点数、展示名、启用状态与声明的运行参数。
        每次保存生成一个新的已发布版本，历史版本只读。
      </p>

      <div className="notice" role="note">
        <p>{MODEL_OPS_NOTES.runtime}</p>
        <p>{MODEL_OPS_NOTES.secret}</p>
        <p>{MODEL_OPS_NOTES.disabled}</p>
        <p>{MODEL_OPS_NOTES.restore}</p>
      </div>

      <h2>档位总览</h2>
      <AdminTable label="模型档位列表，可横向滚动" isEmpty={tiers.length === 0} emptyMessage={MODEL_EMPTY}>
        <table>
          <thead>
            <tr>
              <th scope="col">档位</th>
              <th scope="col">状态</th>
              <th scope="col">服务商 / 模型</th>
              <th scope="col" className="numeric">每次点数</th>
              <th scope="col">当前版本</th>
              <th scope="col">声明运行参数</th>
              <th scope="col">维护</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map(({ profile, versions }) => {
              const current = versions.find(version => version.isCurrent) ?? null;
              return (
                <tr key={profile.id} data-tier={profile.tier} data-profile-id={profile.id}>
                  <td>{modelTierLabel(profile.tier)}</td>
                  <td>
                    <span className="tag" data-status={profile.enabled ? 'active' : 'inactive'}>
                      {profile.enabled ? '已启用' : '已禁用'}
                    </span>
                    {!profile.enabled && <span className="tag" data-status="flagged">新回合会被拒绝</span>}
                  </td>
                  <td>{profile.provider} / {profile.modelName}</td>
                  <td className="numeric" data-points={profile.pointsPerCall}>{profile.pointsPerCall}</td>
                  <td>{current ? `v${current.versionNo}` : '未发布'}</td>
                  <td>{formatModelRuntimeParams(current?.runtimeParams ?? {})}</td>
                  <td><a href={`#model-${profile.id}`}>编辑</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </AdminTable>

      {tiers.length > 0 && <section aria-labelledby="model-editors">
        <h2 id="model-editors">编辑、发布与版本恢复</h2>
        <p className="muted">保存或发布会写入新版本；恢复历史版本同样生成新版本，不改动、不删除任何历史记录。</p>
        {tiers.map(({ profile, versions }) => {
          const current = versions.find(version => version.isCurrent) ?? null;
          return (
            <article className="panel" id={`model-${profile.id}`} key={profile.id}>
              <h3>
                {modelTierLabel(profile.tier)}
                <span className="tag" data-status={profile.enabled ? 'active' : 'inactive'}>
                  {profile.enabled ? '已启用' : '已禁用'}
                </span>
              </h3>
              <ModelTierEditor
                profile={profile}
                initial={{
                  enabled: profile.enabled,
                  provider: profile.provider,
                  modelName: profile.modelName,
                  pointsPerCall: profile.pointsPerCall,
                  displayName: profile.displayName,
                  description: profile.description,
                  runtimeParams: current?.runtimeParams ?? {},
                }}
              />
              <ModelCheckPanel profileId={profile.id} tier={profile.tier} />
              <ModelVersionHistory
                profileId={profile.id}
                tier={profile.tier}
                versions={versions}
                expectedUpdatedAt={profile.updatedAt.toISOString()}
              />
              <p className="muted">最后一次保存：{formatAdminDate(profile.updatedAt)}</p>
            </article>
          );
        })}
      </section>}
    </div>
  );
}
