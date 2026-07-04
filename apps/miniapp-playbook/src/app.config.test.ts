import { describe, expect, it } from 'vitest';
import appConfig from './app.config';

describe('miniapp playbook app config', () => {
  it('only exposes the component playbook page', () => {
    expect(appConfig.pages).toEqual(['pages/playbook/index']);
    expect(appConfig).not.toHaveProperty('tabBar');
  });

  it('does not include the forbidden API placeholder host', () => {
    expect(JSON.stringify(appConfig)).not.toContain('api.example.com');
  });
});
