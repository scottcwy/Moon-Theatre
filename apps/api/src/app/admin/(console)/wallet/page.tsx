import Link from 'next/link';
import { listWalletAccounts, listWalletTransactions } from '@/server/modules/admin/index.js';
import { AdminIdentityRequired, requireAdminPageAuth } from '@/server/modules/admin/page-auth.js';
import { AdminTable, adminStatus, formatAdminDate, LoadError } from '../../ui.js';
import { WalletAdjustmentForm } from '../../wallet-forms.js';
import {
  WALLET_LEDGER_NOTE,
  WALLET_TYPE_FILTER_INVALID,
  WALLET_USER_FILTER_INVALID,
  formatSignedPoints,
} from '../../wallet-copy.js';

type SearchParams = Record<string, string | string[] | undefined>;
type WalletTransactionType = 'recharge' | 'consume' | 'adjust';

const PAGE_SIZE = 30;
const TRANSACTION_TYPES: readonly WalletTransactionType[] = ['recharge', 'consume', 'adjust'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
}

/**
 * Wallet ledger and manual adjustments (AC-14). The existing service contract already accepts
 * `userId`/`type` on both listings; this page surfaces them instead of inventing a parallel query.
 * An unusable filter is reported and not applied, so the operator never mistakes an ignored filter
 * for "no rows". The adjustment form is the only write surface and never invents a balance.
 */
export default async function WalletPage(props: { searchParams?: Promise<SearchParams> }) {
  if (!await requireAdminPageAuth()) return <AdminIdentityRequired />;
  const query = (await props?.searchParams) ?? {};
  const rawUserId = first(query.userId);
  const rawType = first(query.type);
  const userId = rawUserId && UUID.test(rawUserId.trim()) ? rawUserId.trim() : undefined;
  const type = TRANSACTION_TYPES.includes(rawType as WalletTransactionType) ? rawType as WalletTransactionType : undefined;
  const userIdInvalid = Boolean(rawUserId?.trim()) && !userId;
  const typeInvalid = Boolean(rawType?.trim()) && !type;

  let accounts: Awaited<ReturnType<typeof listWalletAccounts>>;
  let transactions: Awaited<ReturnType<typeof listWalletTransactions>>;
  try {
    [accounts, transactions] = await Promise.all([
      listWalletAccounts({ page: 1, pageSize: PAGE_SIZE, ...(userId ? { userId } : {}) }),
      listWalletTransactions({ page: 1, pageSize: PAGE_SIZE, ...(userId ? { userId } : {}), ...(type ? { type } : {}) }),
    ]);
  } catch {
    return <LoadError subject="钱包与流水" />;
  }

  const activeFilters = [
    ...(userId ? [`玩家 ${userId.slice(0, 8)}…`] : []),
    ...(type ? [adminStatus(type)] : []),
  ];
  const hasFilters = activeFilters.length > 0;

  return (
    <div>
      <h1>钱包与流水</h1>
      <p className="page-description">
        查看玩家钱包账户与点数流水，并按需人工加减点数。人工调整须填写原因，提交后显示结果余额与幂等标识。
      </p>
      <div className="notice" role="note"><p>{WALLET_LEDGER_NOTE}</p></div>

      <WalletAdjustmentForm />

      <form className="filter-bar" method="get" action="/admin/wallet" aria-label="筛选钱包流水">
        <label>玩家 ID
          <input name="userId" defaultValue={rawUserId ?? ''} maxLength={40} spellCheck={false}
            autoCapitalize="none" placeholder="完整 UUID" />
        </label>
        <label>流水类型
          <select name="type" defaultValue={type ?? ''}>
            <option value="">全部</option>
            <option value="recharge">充值</option>
            <option value="consume">消费</option>
            <option value="adjust">调整</option>
          </select>
        </label>
        <button className="primary" type="submit">筛选</button>
        {hasFilters && <Link className="button" href="/admin/wallet">清除筛选</Link>}
      </form>

      {hasFilters && <p className="muted filter-summary" role="status">当前筛选：{activeFilters.join(' · ')}</p>}
      {userIdInvalid && <div className="notice warning" role="status">{WALLET_USER_FILTER_INVALID}</div>}
      {typeInvalid && <div className="notice warning" role="status">{WALLET_TYPE_FILTER_INVALID}</div>}

      <h2>钱包账户</h2>
      <AdminTable label="钱包账户，可横向滚动" isEmpty={accounts.items.length === 0} emptyMessage="暂无钱包账户。玩家开通钱包后可在此查看。">
        <table>
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col" className="numeric">余额点数</th>
              <th scope="col" className="numeric">累计充值</th>
              <th scope="col" className="numeric">累计消费</th>
              <th scope="col">详情</th>
            </tr>
          </thead>
          <tbody>
            {(accounts.items as Array<Record<string, unknown>>).map(a => (
              <tr key={a.id as string}>
                <td>{String((a.userName as string) || (a.userId as string).slice(0, 8))}</td>
                <td className="numeric">{a.balancePoints as number}</td>
                <td className="numeric">+{a.totalRechargedPoints as number}</td>
                <td className="numeric">-{a.totalConsumedPoints as number}</td>
                <td><Link href={`/admin/users/${a.userId as string}`}>查看用户</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminTable>

      <h2>近期流水</h2>
      <AdminTable label="近期流水，可横向滚动" isEmpty={transactions.items.length === 0} emptyMessage="暂无钱包流水。产生点数变动后可在此查看。">
        <table>
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col">类型</th>
              <th scope="col" className="numeric">金额</th>
              <th scope="col" className="numeric">变动后余额</th>
              <th scope="col">原因</th>
              <th scope="col">幂等标识</th>
              <th scope="col">时间（北京时间）</th>
            </tr>
          </thead>
          <tbody>
            {(transactions.items as Array<Record<string, unknown>>).map(t => (
              <tr key={t.id as string}>
                <td>{String((t.userName as string) || (t.userId as string).slice(0, 8))}</td>
                <td><span className="tag" data-status={t.type as string}>{adminStatus(t.type as string)}</span></td>
                <td className="numeric">{formatSignedPoints(t.type as string, t.amount as number)}</td>
                <td className="numeric">{t.balanceAfter as number}</td>
                <td className="note-cell">{(t.adjustmentReason as string) || (t.description as string) || '—'}</td>
                <td className="identifier">{(t.idempotencyKey as string) || '—'}</td>
                <td>{t.createdAt ? formatAdminDate(t.createdAt as string) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </AdminTable>
    </div>
  );
}
