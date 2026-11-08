import Link from 'next/link';
import { ROLEPLAY_AGENTS } from '@juben-sha/shared';
import { listAdminScripts } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { LoadError } from '../../../ui.js';
import { CharacterCreateForm } from '../../../character-forms.js';

/**
 * 新建角色 (§3). Creation is draft-only: the service writes an `inactive` character with draft
 * version 1 and no published pointer, and the agent id is chosen from the versioned roleplay agent
 * contract — never typed by the operator.
 */
export default async function NewCharacterPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;

  let scripts: Awaited<ReturnType<typeof listAdminScripts>>;
  try {
    scripts = await listAdminScripts();
  } catch {
    return <LoadError subject="新建角色" />;
  }

  return <div>
    <div className="page-heading">
      <div>
        <h1>新建角色卡</h1>
        <p className="page-description">填写展示资料、角色人设与开场引导，创建一张草稿角色卡。</p>
      </div>
      <Link className="button" href="/admin/characters">返回角色卡列表</Link>
    </div>
    <p className="notice" role="status">
      只创建草稿：新角色为未上架状态，不进入公开列表，也不能开始聊天；补全内容并发布后才生效。
    </p>
    <CharacterCreateForm
      agents={ROLEPLAY_AGENTS.map(agent => ({ agentId: agent.agentId, name: agent.name }))}
      scripts={scripts.map(script => ({ id: script.id, title: script.title, status: script.status }))}
    />
  </div>;
}
