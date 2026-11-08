/**
 * Quota package field bounds (AC-13). Kept in a dependency-free module so the admin form and the
 * server schema share one source of truth without pulling the database into the browser bundle.
 */
export const QUOTA_PACKAGE_NAME_MAX = 64;
export const QUOTA_PACKAGE_DESCRIPTION_MAX = 256;
