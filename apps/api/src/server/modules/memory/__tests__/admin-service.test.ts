import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/index.js', () => ({
  db: {},
}));

import { buildAdminMemoryUpdate } from '../admin-service.js';

describe('memory admin service helpers', () => {
  it('builds a disable update without requiring content', () => {
    expect(buildAdminMemoryUpdate({ enabled: false })).toMatchObject({
      enabled: false,
    });
  });

  it('trims overridden content and updates timestamp', () => {
    const update = buildAdminMemoryUpdate({ content: '  新的角色记忆  ', enabled: true });

    expect(update.content).toBe('新的角色记忆');
    expect(update.enabled).toBe(true);
    expect(update.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects empty override content', () => {
    expect(() => buildAdminMemoryUpdate({ content: '   ' })).toThrow('Memory content cannot be empty');
  });

  it('rejects a patch with no editable fields', () => {
    expect(() => buildAdminMemoryUpdate({})).toThrow('No memory updates provided');
  });
});
