import postgres from 'postgres';
import { expect, it } from 'vitest';
import { ownedTestTarget, assertTestDatabase } from './disposable-postgres.js';
import { verifyDatabaseIdentity } from '../../../../../../scripts/test-web-admin.mjs';

it('derived fixture connections refuse actual database, username and cluster mismatch before DDL', async () => {
  const { url, clusterName, username } = ownedTestTarget();
  const client = postgres(url.toString(), { max: 1, connection: { default_transaction_read_only: true } });
  try {
    const name = url.pathname.slice(1);
    await assertTestDatabase(client, name, clusterName, username);
    await expect(assertTestDatabase(client, 'web_admin_test_wrong', clusterName, username)).rejects.toThrow('identity');
    await expect(assertTestDatabase(client, name, 'web_admin_test_wrong', username)).rejects.toThrow('identity');
    await expect(assertTestDatabase(client, name, clusterName, 'wrong')).rejects.toThrow('identity');
    const readonlyIdentity = async () => {
      const [row] = await client`select current_database() as database, current_user as username`;
      const [setting] = await client`SHOW cluster_name`;
      return [{ ...row, cluster: setting!.cluster_name }];
    };
    await verifyDatabaseIdentity(readonlyIdentity, { database: name, username, clusterName });
    await expect(verifyDatabaseIdentity(readonlyIdentity, { database: 'web_admin_test_wrong', username, clusterName })).rejects.toThrow('identity');
    await expect(verifyDatabaseIdentity(readonlyIdentity, { database: name, username, clusterName: 'web_admin_test_wrong' })).rejects.toThrow('identity');
  } finally { await client.end(); }
});
