import { describe, expect, it } from 'vitest';
import nextConfig from '../../../../next.config';

describe('api next config', () => {
  it('emits standalone output for the Docker runner image', () => {
    expect(nextConfig.output).toBe('standalone');
  });

  it('keeps the postgres driver out of the edge instrumentation bundle', () => {
    const webpack = nextConfig.webpack;
    expect(webpack).toBeDefined();

    const config = { resolve: {}, externals: [] as unknown[] };
    webpack!(config as never, { nextRuntime: 'edge' } as never);

    expect(config.externals).toContain('postgres');
  });

  it('does not externalize postgres for the nodejs server bundle', () => {
    const webpack = nextConfig.webpack;
    expect(webpack).toBeDefined();

    const config = { resolve: {}, externals: [] as unknown[] };
    webpack!(config as never, { nextRuntime: 'nodejs' } as never);

    expect(config.externals).not.toContain('postgres');
  });
});
