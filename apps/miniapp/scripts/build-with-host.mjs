#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostsPath = path.join(projectRoot, 'config', 'hosts.json');
const taroBin = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'taro.cmd' : 'taro',
);

function parseArgs(argv) {
  const args = { mode: undefined, watch: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--mode') args.mode = argv[i + 1];
    else if (argv[i] === '--watch') args.watch = true;
  }
  return args;
}

function loadHosts() {
  if (!fs.existsSync(hostsPath)) {
    throw new Error(`Missing API host config: ${hostsPath}`);
  }
  return JSON.parse(fs.readFileSync(hostsPath, 'utf8'));
}

function assertUrl(value, label) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error();
    }
  } catch {
    throw new Error(`${label} must be a valid http(s) URL, got: ${value}`);
  }
}

const { mode, watch } = parseArgs(process.argv.slice(2));
if (!mode) {
  console.error('Usage: node scripts/build-with-host.mjs --mode dev|lan|prod [--watch]');
  process.exit(2);
}

const hosts = loadHosts();
const apiBaseUrl = hosts[mode];
if (!apiBaseUrl) {
  if (mode === 'lan') {
    console.error(`hosts.json "lan" is empty; fill in your LAN IP, e.g. "http://192.168.1.5:3000"`);
  } else {
    console.error(`hosts.json has no "${mode}" host. Available: ${Object.keys(hosts).join(', ')}`);
  }
  process.exit(2);
}
assertUrl(apiBaseUrl, `hosts.json "${mode}"`);

const args = ['build', '--type', 'weapp'];
if (watch) args.push('--watch');

console.log(`[build-with-host] mode=${mode} API_BASE_URL=${apiBaseUrl}`);
const child = spawn(taroBin, args, {
  cwd: projectRoot,
  env: { ...process.env, API_BASE_URL: apiBaseUrl },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
