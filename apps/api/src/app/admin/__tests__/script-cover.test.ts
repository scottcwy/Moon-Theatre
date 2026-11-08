import { describe, expect, it } from 'vitest';
import { coverDraftBody, coverNeedsSaveBeforePublish, newCoverPublishKey, coverPublishBody } from '../script-cover.js';

describe('script cover form bodies', () => {
  it('sends exactly the strict PATCH shape with the current baseline', () => {
    expect(coverDraftBody('2026-11-07T00:00:00.000Z', '  https://api.example.test/api/media/x  ')).toEqual({
      expectedUpdatedAt: '2026-11-07T00:00:00.000Z',
      coverUrl: 'https://api.example.test/api/media/x',
    });
  });

  it('clears the cover with null instead of an empty string', () => {
    expect(coverDraftBody('2026-11-07T00:00:00.000Z', '   ')).toEqual({
      expectedUpdatedAt: '2026-11-07T00:00:00.000Z',
      coverUrl: null,
    });
  });

  it('uses one stable publish key per editing session and rotates only on request', () => {
    const key = newCoverPublishKey('script-1');
    expect(key).toMatch(/^ui-script-cover-script-1-/);
    expect(coverPublishBody(key)).toEqual({ action: 'publish', idempotencyKey: key });
    expect(newCoverPublishKey('script-1')).not.toBe(key);
  });
});

describe('publish plan', () => {
  const url = 'https://api.example.test/api/media/1';

  it('publishes the draft that was just saved instead of writing a second identical draft', () => {
    expect(coverNeedsSaveBeforePublish({ savedUrl: url, hasDraft: true, manualUrl: url })).toBe(false);
    // The same thing with the whitespace the field allows: the stored value is already identical.
    expect(coverNeedsSaveBeforePublish({ savedUrl: url, hasDraft: true, manualUrl: `  ${url} ` })).toBe(false);
    // Both empty means "no cover", which is also already saved.
    expect(coverNeedsSaveBeforePublish({ savedUrl: '', hasDraft: true, manualUrl: '   ' })).toBe(false);
  });

  it('saves a changed cover before publishing it', () => {
    expect(coverNeedsSaveBeforePublish({ savedUrl: url, hasDraft: true, manualUrl: 'https://api.example.test/api/media/2' })).toBe(true);
    // Clearing the cover is a real change (null instead of the current URL).
    expect(coverNeedsSaveBeforePublish({ savedUrl: url, hasDraft: true, manualUrl: '' })).toBe(true);
    expect(coverNeedsSaveBeforePublish({ savedUrl: '', hasDraft: true, manualUrl: url })).toBe(true);
  });

  it('still saves when there is no draft yet, because a publish needs a draft version', () => {
    // A freshly published (or just created) script has no draft row, so `publishScript` would answer
    // 400 script_draft_required: this is the one case where an unchanged form must be written first.
    expect(coverNeedsSaveBeforePublish({ savedUrl: url, hasDraft: false, manualUrl: url })).toBe(true);
    expect(coverNeedsSaveBeforePublish({ savedUrl: '', hasDraft: false, manualUrl: '' })).toBe(true);
  });
});
