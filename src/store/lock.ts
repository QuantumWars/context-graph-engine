/**
 * VENDORED, not imported. Copied verbatim from `memory/src/lock.ts` (the sibling package in
 * the workspace this engine was built in), with only this header added.
 *
 * `DEC-001` decided to import it across packages by relative path rather than copy it, and
 * that was right while the engine lived inside that workspace. It stopped being right the
 * moment the engine became its own repository: `../../../../memory/src/lock` resolves only at
 * one exact filesystem depth, so a clone anywhere else fails at typecheck. `DEC-010` records
 * the reversal and what it costs.
 *
 * The original's header follows unaltered, including its own statement of limitations —
 * advisory not mandatory, POSIX-only in practice, and the stale-lock trade. Those still apply
 * here, and paraphrasing them would have quietly weakened them.
 *
 * If a fix lands upstream, it does not reach this copy. That is the price of vendoring and it
 * is stated here rather than discovered later.
 */

/**
 * A cross-process advisory lock over a single path — P16-2's mechanism for
 * making `Store.append()`/`Store.writeAll()` safe when a second OS process
 * (another MCP client) can be writing `memories.jsonl` at the same time.
 *
 * Built on POSIX `open(path, O_CREAT | O_EXCL)` (Node/Bun's `'wx'` flag):
 * the syscall that creates a file only if it does not already exist is a
 * single atomic kernel operation, so two processes racing to create the
 * same lock path can never both believe they hold it — one gets the file,
 * the other gets `EEXIST`. This is the same primitive traditional Unix
 * lockfile tools (`flock`-less PID-file locking, `procmail`'s `.lock`
 * files, etc.) have used for decades; nothing exotic. Verified directly
 * against this machine's real `node:fs/promises.open` under Bun 1.3.14
 * (two concurrent `open(path, 'wx')` calls: the second reliably throws
 * `EEXIST`, never silently succeeds) before being trusted here.
 *
 * Real guarantees:
 *  - Two callers of `withFileLock()` for the same `path`, whether in the
 *    same process (racing promises) or two separate OS processes on the
 *    same machine, never run their `fn` bodies concurrently.
 *  - The lock is always released — including when `fn` throws — so a
 *    caller's own error doesn't wedge every future writer.
 *
 * Real limitations, stated plainly, not glossed over:
 *  - Advisory, not mandatory: it only excludes writers that go through
 *    this function. A process that opens the target file directly is not
 *    stopped by this.
 *  - POSIX-only in practice. `O_EXCL` create semantics are part of the
 *    POSIX `open(2)` contract; this has been verified on macOS (Darwin,
 *    this development machine) and is expected to hold on Linux for the
 *    same reason, but has NOT been tested on Windows, and is explicitly
 *    unreliable over NFS/network filesystems (several NFS versions don't
 *    honor `O_EXCL` atomically). This project's own local `.claude/memory`
 *    store is same-machine local disk by construction, matching this
 *    phase's own framing ("two tool processes on the same machine") — this
 *    is not claimed to hold for a network-mounted store.
 *  - A process that crashes while holding the lock leaves the lockfile
 *    behind forever unless something breaks it. `staleMs` below is that
 *    something: a lockfile older than `staleMs` is treated as abandoned
 *    and removed by the next waiter. This trades one real risk for
 *    another, honestly: if a legitimate holder is still working (not
 *    crashed) past `staleMs`, a waiter can steal the lock and both can run
 *    `fn` concurrently. `staleMs` defaults to 30s, chosen to comfortably
 *    exceed this store's real write sizes (a JSONL append of a handful of
 *    memories, sub-millisecond of actual I/O) by four to five orders of
 *    magnitude — not proven safe for an arbitrarily slow `fn`.
 */

import { open, rename, rm, stat } from 'node:fs/promises';

export interface LockOptions {
  /** Total time to keep retrying before giving up and throwing. */
  timeoutMs?: number;
  /** Delay between retries while the lock is held by someone else. */
  retryMs?: number;
  /** A held lock older than this is treated as abandoned (crash) and broken. */
  staleMs?: number;
}

const DEFAULTS: Required<LockOptions> = {
  timeoutMs: 5000,
  retryMs: 15,
  staleMs: 30000,
};

export class LockTimeoutError extends Error {
  constructor(lockPath: string, timeoutMs: number, staleMs: number) {
    super(
      `withFileLock: timed out after ${timeoutMs}ms waiting for ${lockPath} — either another ` +
        `process genuinely holds it, or a crash left a stale lock older than ${staleMs}ms that a ` +
        `concurrent waiter hasn't broken yet.`,
    );
    this.name = 'LockTimeoutError';
  }
}

async function tryAcquire(lockPath: string): Promise<boolean> {
  try {
    const handle = await open(lockPath, 'wx');
    try {
      await handle.writeFile(`${process.pid}\n`);
    } finally {
      await handle.close();
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

async function breakIfStale(lockPath: string, staleMs: number): Promise<void> {
  try {
    const st = await stat(lockPath);
    if (Date.now() - st.mtimeMs > staleMs) {
      await rm(lockPath, { force: true });
    }
  } catch {
    // Lock vanished between the failed acquire and this check (the holder
    // released it, or another waiter already broke it) — fine, the next
    // acquire attempt resolves it either way.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` while holding the exclusive lock on `path + '.lock'`. See this
 * module's header for the real guarantees and real limitations.
 */
export async function withFileLock<T>(path: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const { timeoutMs, retryMs, staleMs } = { ...DEFAULTS, ...opts };
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await tryAcquire(lockPath)) break;
    await breakIfStale(lockPath, staleMs);
    if (Date.now() >= deadline) throw new LockTimeoutError(lockPath, timeoutMs, staleMs);
    await sleep(retryMs);
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

/**
 * Write `content` to `path` without a reader ever observing a partial
 * write: write to a sibling temp file, then `rename()` it over `path`.
 * POSIX `rename(2)` replaces the destination atomically when both paths
 * are on the same filesystem (true here — the temp file is a sibling of
 * `path`), so a concurrent reader sees either the old full content or the
 * new full content, never a torn write. This is independent of
 * `withFileLock` above: locking serializes *writers* against each other;
 * this protects *readers* (who don't take the lock — `Store.read()` is
 * called from hot paths like `recall()` and must stay lock-free) from ever
 * seeing a half-written file.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await Bun.write(tmp, content);
  await rename(tmp, path);
}
