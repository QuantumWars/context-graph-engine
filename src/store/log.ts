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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

function assertWorkspace(paths: StorePaths, records: readonly StoredRecord[]): void {
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
}

const serialise = (records: readonly StoredRecord[]): string =>
  records.length === 0 ? '' : records.map((r) => canonicalJson(r as never)).join('\n') + '\n';

/** What a mutation decided to do, once it has seen the log's true current state. */
export interface Mutation<T> {
  /** Records to append to what is already there. */
  readonly append?: readonly StoredRecord[];
  /** The complete new contents, replacing the file. Used by purge. */
  readonly rewrite?: readonly StoredRecord[];
  readonly value: T;
}

/**
 * Read the log, decide, and write — **all inside one lock**.
 *
 * The read has to be inside the lock, and Phase 3's concurrency test is why. The first version
 * of this module locked only the write: a caller read the log, computed `seq` and `prev` from
 * that snapshot, and then took the lock to append. Two processes could therefore both open an
 * empty store, both compute `seq = 1`, and both write it:
 *
 *     chain_invalid: 2 problem(s); first is chain_break at seq 1 (B-0)
 *
 * The lock was real and in the wrong place. `seq` and `prev` are decided *from* the file's
 * current state, so the decision is part of the critical section, not a preamble to it. Nothing
 * single-process could have caught this — the promise queue serialises those anyway.
 */
export async function withLoggedMutation<T>(
  paths: StorePaths,
  decide: (current: readonly StoredRecord[]) => Promise<Mutation<T>> | Mutation<T>,
): Promise<T> {
  ensureStoreDir(paths);
  return withFileLock(paths.log, async () => {
    const current = readLog(paths);
    const m = await decide(current);

    if (m.rewrite !== undefined) {
      assertWorkspace(paths, m.rewrite);
      writeFileSync(paths.log, serialise(m.rewrite), { encoding: 'utf8', mode: 0o600 });
    } else if (m.append !== undefined && m.append.length > 0) {
      assertWorkspace(paths, m.append);
      await appendFile(paths.log, serialise(m.append), 'utf8');
    }
    return m.value;
  });
}

/**
 * Append without re-reading. Only for callers that already hold the true state — currently just
 * the workspace-boundary test, which needs to attempt a cross-workspace write directly.
 */
export async function appendLog(paths: StorePaths, records: readonly StoredRecord[]): Promise<void> {
  if (records.length === 0) return;
  assertWorkspace(paths, records);
  ensureStoreDir(paths);
  await withFileLock(paths.log, async () => {
    await appendFile(paths.log, serialise(records), 'utf8');
  });
}
