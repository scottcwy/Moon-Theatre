import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const LOCAL_API_BASE_URL = 'http://127.0.0.1:3000';

export function parseDotEnv(content) {
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = line.slice(separatorIndex + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadRootEnv(cwd) {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return {};
  return parseDotEnv(fs.readFileSync(envPath, 'utf8'));
}

export function createDevPlan(cwd = process.cwd(), rootEnv = loadRootEnv(cwd)) {
  const serviceEnv = {
    ...process.env,
    API_BASE_URL: LOCAL_API_BASE_URL,
    ...rootEnv,
  };

  return {
    setup: {
      label: 'postgres',
      command: 'docker',
      args: ['compose', 'up', '-d', 'postgres'],
      cwd,
    },
    services: [
      {
        label: 'api',
        command: 'pnpm',
        args: ['dev:api'],
        cwd,
        env: serviceEnv,
      },
      {
        label: 'fastclaw',
        command: './fastclaw/bin/fastclaw',
        args: ['gateway'],
        cwd,
        env: serviceEnv,
      },
      {
        label: 'miniapp',
        command: 'pnpm',
        args: ['dev:miniapp'],
        cwd,
        env: serviceEnv,
      },
    ],
  };
}

function runOnce(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${step.label} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

function pipeWithLabel(stream, label, target) {
  const lines = readline.createInterface({ input: stream });
  lines.on('line', (line) => {
    target.write(`[${label}] ${line}\n`);
  });
}

function spawnService(service) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: service.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pipeWithLabel(child.stdout, service.label, process.stdout);
  pipeWithLabel(child.stderr, service.label, process.stderr);

  child.on('error', (error) => {
    process.stderr.write(`[${service.label}] failed to start: ${error.message}\n`);
  });

  return { ...service, child };
}

async function runDev() {
  const plan = createDevPlan(process.cwd());

  process.stdout.write('[dev] starting postgres with docker compose\n');
  await runOnce(plan.setup);

  process.stdout.write('[dev] starting api, fastclaw, and miniapp\n');
  const services = plan.services.map(spawnService);
  let stopping = false;

  const stopAll = (signal = 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    for (const service of services) {
      if (!service.child.killed) service.child.kill(signal);
    }
  };

  process.on('SIGINT', () => stopAll('SIGINT'));
  process.on('SIGTERM', () => stopAll('SIGTERM'));

  await new Promise((resolve) => {
    for (const service of services) {
      service.child.on('exit', (code, signal) => {
        if (!stopping) {
          process.stderr.write(`[dev] ${service.label} stopped with ${signal ?? `code ${code}`}\n`);
          process.exitCode = code || 1;
          stopAll();
        }
        resolve();
      });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDev().catch((error) => {
    process.stderr.write(`[dev] ${error.message}\n`);
    process.exitCode = 1;
  });
}
