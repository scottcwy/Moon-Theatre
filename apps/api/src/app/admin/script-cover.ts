/** Pure body/key builders for the script cover form, so the strict PATCH body is testable. */

export function coverDraftBody(expectedUpdatedAt: string, manualUrl: string): {
  expectedUpdatedAt: string;
  coverUrl: string | null;
} {
  const coverUrl = manualUrl.trim();
  return { expectedUpdatedAt, coverUrl: coverUrl || null };
}

/** A client-generated publish key; the server treats one key as one publish attempt. */
export function newCoverPublishKey(scriptId: string): string {
  return `ui-script-cover-${scriptId}-${crypto.randomUUID()}`;
}

export function coverPublishBody(idempotencyKey: string): { action: 'publish'; idempotencyKey: string } {
  return { action: 'publish', idempotencyKey };
}

/** What `coverDraftBody` would store for a manual value: the trimmed URL, or `null` when empty. */
function storedCover(manualUrl: string): string | null {
  const trimmed = manualUrl.trim();
  return trimmed || null;
}

/**
 * Does "保存并发布封面" still need to write a draft first?
 *
 * Publishing activates the newest draft version, so an unchanged form that already has a draft must
 * NOT save again — that would append a second content-identical draft version plus a second
 * `admin.script.draft.update` audit for one cover change. When there is no draft at all (a script
 * that was just created or just published) the save is still required, because `publishScript`
 * answers `400 script_draft_required` without one.
 *
 * `savedUrl` is the value the form knows to be persisted (the page's editable cover, updated after
 * each successful save); `hasDraft` is `draftVersionNo != null` at the same moment.
 *
 * Residual limit of skipping the save: a publish always activates the newest draft version, so a draft
 * another admin created in the meantime would be published instead of answering
 * `script_edit_conflict`. Closing that window needs a publish body that names the version id, which
 * the shared script publish route does not accept yet.
 */
export function coverNeedsSaveBeforePublish(input: {
  savedUrl: string | null;
  hasDraft: boolean;
  manualUrl: string;
}): boolean {
  if (!input.hasDraft) return true;
  return storedCover(input.manualUrl) !== storedCover(input.savedUrl ?? '');
}
