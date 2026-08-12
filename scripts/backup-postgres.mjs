import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDotEnv } from './dev.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadRootEnv(cwd) {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return {};
  return parseDotEnv(fs.readFileSync(envPath, 'utf8'));
}

async function main() {
  const rootEnv = loadRootEnv(repoRoot);
  const password = rootEnv.POSTGRES_PASSWORD;
  if (!password) {
    console.error('POSTGRES_PASSWORD not found in root .env; cannot back up postgres');
    process.exit(1);
  }

  const backupsDir = path.join(repoRoot, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dumpPath = path.join(backupsDir, `juben-sha-${timestamp}.dump`);
  const dumpStream = fs.createWriteStream(dumpPath);

  const child = spawn(
    'docker',
    [
      'compose', 'exec', '-T',
      '-e', `PGPASSWORD=${password}`,
      'postgres',
      'pg_dump', '-U', 'postgres', '-d', 'juben_sha', '-Fc',
    ],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  child.stdout.pipe(dumpStream);

  const exitCode = await new Promise((resolve) => {
    child.on('error', (err) => {
      console.error(`failed to run docker compose exec: ${err.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });

  await new Promise((resolve) => {
    if (dumpStream.closed) return resolve();
    dumpStream.on('close', resolve);
  });

  if (exitCode !== 0) {
    fs.rmSync(dumpPath, { force: true });
    console.error(`pg_dump failed with exit code ${exitCode}; partial dump removed`);
    process.exit(1);
  }

  const stats = fs.statSync(dumpPath);
  console.log(`backup written: ${dumpPath} (${stats.size} bytes)`);
}

main().catch((err) => {
  console.error(`backup failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
