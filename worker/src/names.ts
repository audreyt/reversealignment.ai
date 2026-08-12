/** Stable name key for duplicate-publish guards (NFKC, lower case, collapse space). */
export function normalizeNameKey(fullName: string): string {
  return fullName.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}
