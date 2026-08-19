/**
 * The append-only log. One file, one canonical-JSON record per line.
 *
 * The lock comes from `./lock.ts`, which is **vendored** from the sibling `memory` package
 * rather than imported across packages. `DEC-001` chose the import; `DEC-010` reversed it when
 * this engine became its own repository, because a relative path four levels up resolves at
 * exactly one filesystem depth and nowhere else. The file records its own provenance.
 *
 * `DEC-007` requires append order to define `seq`, so concurrent writers must be serialised —
 * which is what the lock is for.
 */

import { existsSync, readFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { withFileLock } from './lock';
import { canonicalJson } from '../provenance/canonical';
import type { StoredRecord } from './records';
import { isRecordKind } from './records';
import type { StorePaths } from './paths';
import { ensureStoreDir } from './paths';

export type LogErrorCode = 'malformed_line' | 'unknown_kind' | 'workspace_mismatch';

export class LogError extends Error {
  readonly code: LogErrorCode;
  readonly line: number;
  constructor(code: LogErrorCode, line: number, message: string) {
    super(`${code}: line ${line}: ${message}`);
    this.name = 'LogError';
    this.code = code;
    this.line = line;
  }
}

/**
 * Read every record. A malformed line is a named error, never a skipped line — skipping would
 * silently shorten the chain and turn a corrupt log into a shorter valid-looking one.
 */
export function readLog(paths: StorePaths): readonly StoredRecord[] {
  if (!existsSync(paths.log)) return [];
  const text = readFileSync(paths.log, 'utf8');
  const out: StoredRecord[] = [];

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] as string;
    if (raw.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new LogError('malformed_line', i + 1, `not valid JSON (${(e as Error).message})`);
    }
    const rec = parsed as StoredRecord;
    if (!isRecordKind(rec.kind)) {
      throw new LogError('unknown_kind', i + 1, `${JSON.stringify(String(rec.kind))} is not a record kind`);
    }
    out.push(rec);
  }
  return out;
}

/**
 * Append records under the file lock.
 *
 * Every writer stamps its own workspace; a writer whose workspace disagrees with the store's
 * own is refused rather than accepted, per `DEC-002`. The refusal names both roots and both
 * methods, because "wrong workspace" with no detail is unactionable.
 */
export async function appendLog(
  paths: StorePaths,
  records: readonly StoredRecord[],
): Promise<void> {
  if (records.length === 0) return;

  for (const r of records) {
    if (r.meta.workspace !== paths.workspace.root) {
      throw new LogError(
        'workspace_mismatch',
        0,
        `record ${JSON.stringify(r.id)} is stamped ${JSON.stringify(r.meta.workspace)} ` +
          `(via ${r.meta.workspaceMethod}) but this store is ${JSON.stringify(paths.workspace.root)} ` +
          `(via ${paths.workspace.method}). Refusing to write across a workspace boundary.`,
      );
    }
  }

  ensureStoreDir(paths);
  const body = records.map((r) => canonicalJson(r as never)).join('\n') + '\n';
  await withFileLock(paths.log, async () => {
    await appendFile(paths.log, body, 'utf8');
  });
}

/**
 * Rewrite the whole log. Used only by purge, which must remove content from the file rather
 * than append a correction — an append cannot unpublish bytes that are already on disk.
 */
export async function rewriteLog(
  paths: StorePaths,
  records: readonly StoredRecord[],
): Promise<void> {
  ensureStoreDir(paths);
  const body = records.length === 0 ? '' : records.map((r) => canonicalJson(r as never)).join('\n') + '\n';
  await withFileLock(paths.log, async () => {
    const { writeFileSync: w } = await import('node:fs');
    w(paths.log, body, { encoding: 'utf8', mode: 0o600 });
  });
}
