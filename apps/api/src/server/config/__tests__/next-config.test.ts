import { describe, expect, it } from 'vitest';
import nextConfig from '../../../../next.config';

describe('api next config', () => {
  it('emits standalone output for the Docker runner image', () => {
    expect(nextConfig.output).toBe('standalone');
  });
});
