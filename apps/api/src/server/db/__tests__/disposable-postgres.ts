import { readFileSync } from 'node:fs';
import type postgres from 'postgres';
import { validateDatabaseUrl } from '../../../../../../scripts/test-web-admin.mjs';

// Only used by database-creating fixtures, after the runner verifies Docker ownership.
export function ownedTestTarget(): { url: URL; clusterName: string; username: string } {
  const state = JSON.parse(readFileSync(process.env.WEB_ADMIN_TEST_STATE!, 'utf8'));
  const target = validateDatabaseUrl(process.env.WEB_ADMIN_TEST_DATABASE_URL);
  if (process.env.DATABASE_URL !== target.url || target.database !== state.database || target.username !== state.username ||
      target.port !== state.port || state.clusterName !== `web_admin_test_${state.nonce}` ||
      Object.keys(process.env).some(key => /^PG/i.test(key))) throw new Error('Unsafe disposable fixture target');
  return { url: new URL(target.url), clusterName: state.clusterName, username: target.username };
}

export async function assertTestDatabase(client: ReturnType<typeof postgres>, name: string, cluster: string, username: string) {
  const [row] = await client`select current_database() as database, current_user as username, current_setting('cluster_name') as cluster`;
  if (row?.database !== name || row?.username !== username || row?.cluster !== cluster)
    throw new Error('Disposable fixture database identity mismatch');
}
