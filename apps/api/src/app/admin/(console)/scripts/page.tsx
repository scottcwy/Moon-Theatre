import Link from 'next/link';
import { listAdminScripts } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { AdminTable, formatAdminDate, LoadError } from '../../ui.js';

/**
 * The script-cover surface the media step needs. It deliberately edits only the cover: creating and
 * editing a script's text is a separate batch-3 capability, and this page must not pretend otherwise.
 */
export default async function ScriptCoverListPage() {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;

  let scripts: Awaited<ReturnType<typeof listAdminScripts>>;
  try {
    scripts = await listAdminScripts();
  } catch {
    return <LoadError subject="剧本封面" />;
  }

  return <div>
    <div className="page-heading">
      <div>
        <h1>剧本封面</h1>
        <p className="page-description">维护剧本封面素材（AC-01 的素材部分）：上传后自动填入封面地址，也可以继续手动粘贴已有外链。标题、简介、世界观等正文编辑不属于本页。</p>
      </div>
    </div>
    <p className="notice" role="note">
      素材保存在本地素材库，按内容区分：替换封面只会切换引用，不会删除旧文件；已发布版本引用的旧封面继续可访问。
    </p>
    <AdminTable
      label="剧本封面列表，可横向滚动"
      isEmpty={scripts.length === 0}
      emptyMessage="暂无剧本。剧本创建后可以在这里维护封面。"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">剧本</th>
            <th scope="col">上架状态</th>
            <th scope="col">封面</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {scripts.map(script => <tr key={script.id} data-script-id={script.id}>
            <td>
              <strong>{script.title}</strong>
              <span className="under identifier">{script.slug}</span>
            </td>
            <td><span className="tag" data-status={script.status}>{script.status === 'active' ? '已上架' : '未上架'}</span></td>
            <td>
              {script.coverUrl
                ? <img className="media-thumb" src={script.coverUrl} alt={`剧本《${script.title}》封面`} />
                : <span className="muted">封面未配置</span>}
            </td>
            <td>
              <Link className="button" href={`/admin/scripts/${script.id}`}>更新封面</Link>
              <span className="under">更新于 {formatAdminDate(script.updatedAt)}</span>
            </td>
          </tr>)}
        </tbody>
      </table>
    </AdminTable>
  </div>;
}
