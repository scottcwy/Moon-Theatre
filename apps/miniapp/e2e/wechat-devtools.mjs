import fs from 'node:fs';

const DEFAULT_WECHAT_DEVTOOLS_CLI_CANDIDATES = [
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  '/Applications/微信开发者工具.app/Contents/MacOS/cli',
];

export function resolveWechatDevtoolsCli({
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  const configuredCli = env.WECHAT_DEVTOOLS_CLI?.trim();
  const candidates = configuredCli
    ? [configuredCli]
    : DEFAULT_WECHAT_DEVTOOLS_CLI_CANDIDATES;

  const cliPath = candidates.find((candidate) => exists(candidate));
  if (cliPath) return cliPath;

  throw new Error([
    'WeChat DevTools CLI was not found.',
    'Set WECHAT_DEVTOOLS_CLI to the absolute path of the DevTools cli binary,',
    'for example /Applications/wechatwebdevtools.app/Contents/MacOS/cli.',
  ].join(' '));
}
