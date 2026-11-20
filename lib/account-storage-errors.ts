/**
 * Database errors from D1, native SQLite and the desktop storage bridge should
 * never be turned into a false "email is already in use" warning.
 * Do not expose SQL statements, bound values or password hashes to users.
 */
export type AccountStorageIssue = 'email_taken' | 'schema_missing' | 'storage_unavailable' | 'unexpected';
export type AccountStorageFailure = { issue: AccountStorageIssue; status: number; message: string };

/**
 * Drizzle wraps D1 and SQLite failures with a "Failed query" error while
 * placing the actual constraint/schema error in `cause`. Inspect only a
 * bounded chain; NEVER surface the SQL text, bound values or passwords.
 */
function diagnosticChain(error: unknown): string {
  const segments: string[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  for (let level = 0; level < 6 && current != null && !visited.has(current); level++) {
    visited.add(current);
    if (typeof current === 'string') segments.push(current.slice(0, 1000));
    else if (typeof current === 'object') {
      const wrapped = current as { message?: unknown; cause?: unknown; code?: unknown };
      if (typeof wrapped.message === 'string') segments.push(wrapped.message.slice(0, 1500));
      if (typeof wrapped.code === 'string') segments.push(wrapped.code.slice(0, 100));
      current = wrapped.cause;
      continue;
    }
    break;
  }
  return segments.join(' | ');
}

export function classifyAccountStorageFailure(error: unknown): AccountStorageFailure {
  const detail = diagnosticChain(error);
  if (/no such table|table (?:[\w.]+ )?does not exist|SQLITE_ERROR.*missing table|no such column|unknown column/i.test(detail))
    return {
      issue: 'schema_missing', status: 503,
      message: 'PaletteIQ account database tables are missing. Apply migration 0005_accounts_and_stores.sql. On Windows local web, stop npm run dev and run: PowerShell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\setup-local.ps1 -SkipInstall',
    };
  if (/UNIQUE constraint failed:\s*paletteiq_accounts\.email|paletteiq_accounts_email_unique|unique index.*paletteiq_accounts.*email|SQLITE_CONSTRAINT_UNIQUE.*paletteiq_accounts\.email/i.test(detail))
    return { issue: 'email_taken', status: 409, message: 'This email is already registered. Choose Sign in instead.' };
  if (/D1 binding.*unavailable|\bDB\b.*unavailable|database is locked|SQLITE_BUSY|Desktop storage: 5\d\d|fetch failed|ECONNREFUSED|database connection/i.test(detail))
    return {
      issue: 'storage_unavailable', status: 503,
      message: 'PaletteIQ account database is unavailable. Check that the local database is initialized and the backend is running; then retry.',
    };
  return {
    issue: 'unexpected', status: 500,
    message: 'Could not save your account because of a database error. The email is not necessarily registered. Check the PaletteIQ backend logs.',
  };
}
