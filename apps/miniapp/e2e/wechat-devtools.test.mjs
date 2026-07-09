import { describe, expect, it } from 'vitest';
import { resolveWechatDevtoolsCli } from './wechat-devtools.mjs';

describe('wechat devtools e2e config', () => {
  it('uses WECHAT_DEVTOOLS_CLI when provided', () => {
    const cliPath = '/custom/devtools/cli';

    expect(resolveWechatDevtoolsCli({
      env: { WECHAT_DEVTOOLS_CLI: cliPath },
      exists: (candidate) => candidate === cliPath,
    })).toBe(cliPath);
  });

  it('falls back to the common macOS wechatwebdevtools path', () => {
    const defaultCli = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

    expect(resolveWechatDevtoolsCli({
      env: {},
      exists: (candidate) => candidate === defaultCli,
    })).toBe(defaultCli);
  });

  it('explains how to configure the CLI when no candidate exists', () => {
    expect(() => resolveWechatDevtoolsCli({
      env: {},
      exists: () => false,
    })).toThrow(/WECHAT_DEVTOOLS_CLI/);
  });
});
