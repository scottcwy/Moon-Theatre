import Link from 'next/link';
import { getAdminUser } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { NotFoundError } from '@/server/http/errors.js';
import { AdminTable, adminStatus, formatAdminDate, LoadError } from '../../../ui.js';
import { ADMIN_UUID } from '../../../character-data.js';
import { USER_BAN_EFFECT_NOTE, userStatusLabel } from '../../../user-copy.js';
import { UserStatusAction } from '../../../user-forms.js';

type UserProfile = Awaited<ReturnType<typeof getAdminUser>>;

function UserNotFound() {
  return <div>
    <h1>用户不存在</h1>
    <p>该用户可能已不存在，或链接中的用户 ID 不完整（需为完整 UUID）。封禁与解封不删除用户，因此这里不会出现已删除记录。</p>
    <p><Link href="/admin/users">返回用户列表</Link></p>
  </div>;
}

/**
 * One player (AC-11): account facts, wallet summary, usage totals and the recent sessions that lead
 * into the existing chat history. The ban/unban switch sits behind an explicit confirmation that says
 * the player's already-issued credentials stop authorizing new user requests. No chat body, persona
 * prompt, raw openid or credential material is rendered here.
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const { id } = await params;
  if (!ADMIN_UUID.test(id)) return <UserNotFound />;

  let profile: UserProfile;
  try {
    profile = await getAdminUser(id);
  } catch (error) {
    if (error instanceof NotFoundError) return <UserNotFound />;
    return <LoadError subject="用户" />;
  }

  return (
    <div>
      <div className="page-heading">
        <div>
          <h1>用户详情</h1>
          <p className="page-description">查看该用户的钱包概况、会话与消息用量，进入最近会话查看聊天历史，并按需封禁或解封。封禁只改变登录授权，不改动钱包、会话或消息。</p>
        </div>
        <Link className="button" href="/admin/users">返回用户列表</Link>
      </div>

      <section className="panel" aria-labelledby="user-profile">
        <h2 id="user-profile">账号信息</h2>
        <dl>
          <dt>昵称</dt><dd>{profile.user.nickname || '未设置昵称'}</dd>
          <dt>状态</dt>
          <dd><span className="tag" data-status={profile.user.status}>{userStatusLabel(profile.user.status)}</span></dd>
          <dt>头像</dt><dd>{profile.user.avatarUrl ? profile.user.avatarUrl : '未设置'}</dd>
          <dt>openid 前缀</dt><dd className="identifier">{profile.user.openidPreview}</dd>
          <dt>注册时间</dt><dd>{formatAdminDate(profile.user.createdAt)}</dd>
          <dt>更新时间</dt><dd>{formatAdminDate(profile.user.updatedAt)}</dd>
          <dt>用户 ID</dt><dd className="identifier">{profile.user.id}</dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="user-wallet">
        <h2 id="user-wallet">钱包概况</h2>
        {profile.wallet.exists
          ? <dl>
            <dt>余额点数</dt><dd className="numeric">{profile.wallet.balancePoints}</dd>
            <dt>累计充值</dt><dd className="numeric">+{profile.wallet.totalRechargedPoints}</dd>
            <dt>累计消费</dt><dd className="numeric">-{profile.wallet.totalConsumedPoints}</dd>
          </dl>
          : <p className="empty">该用户还没有钱包账户，余额与累计值为 0（未开通不表示数据缺失）。</p>}
        <p className="muted">封禁不改动钱包余额与流水，也不删除会话或消息。</p>
      </section>

      <section className="panel" aria-labelledby="user-usage">
        <h2 id="user-usage">使用概况</h2>
        <dl>
          <dt>会话数</dt><dd className="numeric">{profile.stats.sessionCount}</dd>
          <dt>消息数</dt><dd className="numeric">{profile.stats.messageCount}</dd>
          <dt>最后消息时间</dt><dd>{formatAdminDate(profile.stats.lastMessageAt)}</dd>
          <dt>最近会话时间</dt><dd>{formatAdminDate(profile.stats.lastSessionAt)}</dd>
        </dl>
        <p><Link href={`/admin/sessions?userId=${profile.user.id}`}>查看该用户全部会话</Link></p>
      </section>

      <section className="panel" aria-labelledby="user-status">
        <h2 id="user-status">封禁与解封</h2>
        <p className="muted">{USER_BAN_EFFECT_NOTE}</p>
        <p>当前状态：<span className="tag" data-status={profile.user.status}>{userStatusLabel(profile.user.status)}</span></p>
        <details>
          <summary>{profile.user.status === 'active' ? '封禁该用户' : '解除封禁'}</summary>
          <div className="action-disclosure">
            <UserStatusAction userId={profile.user.id} status={profile.user.status} />
          </div>
        </details>
      </section>

      <section className="panel" aria-labelledby="user-sessions">
        <h2 id="user-sessions">最近会话（最多 10 条）</h2>
        <AdminTable
          label="最近会话，可横向滚动"
          isEmpty={profile.recentSessions.length === 0}
          emptyMessage="该用户还没有会话。玩家开始聊天后，最近的会话会显示在这里。"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">会话</th>
                <th scope="col">角色</th>
                <th scope="col">模式</th>
                <th scope="col">状态</th>
                <th scope="col" className="numeric">消息数</th>
                <th scope="col">更新时间</th>
                <th scope="col">聊天历史</th>
              </tr>
            </thead>
            <tbody>
              {profile.recentSessions.map(session => (
                <tr key={session.id}>
                  <td className="identifier">{session.id.slice(0, 8)}</td>
                  <td>{session.characterName || session.characterId.slice(0, 8)}</td>
                  <td>{session.mode === 'script' ? '剧本模式' : '自由模式'}</td>
                  <td><span className="tag" data-status={session.status}>{adminStatus(session.status)}</span></td>
                  <td className="numeric">{session.messageCount}</td>
                  <td>{formatAdminDate(session.updatedAt)}</td>
                  <td><Link href={`/admin/sessions/${session.id}`}>查看聊天历史</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTable>
      </section>
    </div>
  );
}
