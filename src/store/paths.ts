/**
 * Where the store lives, and which workspace a writer belongs to.
 *
 * `DEC-002` makes the **workspace stamp** the one enforced boundary in this engine. There is
 * no user model and no per-record access control; the realistic leak is not an attacker but
 * answering from the wrong project's store. `memory/src/workspace.ts` records that six separate
 * `.claude/memory` stores once existed under one repository, and `graph-engine/CLAUDE.md`
 * carries the same hazard as a standing rule.
 *
 * So resolution is **explicit, and fails rather than guessing**. `DEC-002` rejects trusting
 * `process.cwd()` by name — it is the mechanism that produced those six stores. The posture is
 * taken from `infra-mem/src/address.ts`, which was written as the deliberate inverse of a
 * detection cascade: a hard throw with no cwd fallback.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type WorkspaceMethod = 'env:GRAPH_ENGINE_WORKSPACE' | 'env:CLAUDE_PROJECT_DIR' | 'marker-walk';

export interface Workspace {
  readonly root: string;
  /** How the root was determined. Stamped on every record so a disagreement is explainable. */
  readonly method: WorkspaceMethod;
}

export class WorkspaceError extends Error {
  readonly code = 'workspace_unresolved' as const;
  constructor(message: string) {
    super(`workspace_unresolved: ${message}`);
    this.name = 'WorkspaceError';
  }
}

/** Markers that mean "this directory is a project root". */
const MARKERS = ['.claude', '.git'] as const;

export interface ResolveOptions {
  /** Injected for tests. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Where the marker walk starts. Required — there is deliberately no cwd default. */
  readonly startDir?: string;
}

/**
 * Resolve the workspace root, or throw.
 *
 * Order is explicit-first, and every step is recorded in `method` so a store that disagrees
 * with a writer can say *how* each of them decided rather than only that they differ.
 */
export function resolveWorkspace(opts: ResolveOptions = {}): Workspace {
  const env = opts.env ?? process.env;

  const explicit = env['GRAPH_ENGINE_WORKSPACE'];
  if (explicit !== undefined && explicit !== '') {
    return { root: resolve(explicit), method: 'env:GRAPH_ENGINE_WORKSPACE' };
  }

  const platform = env['CLAUDE_PROJECT_DIR'];
  if (platform !== undefined && platform !== '') {
    return { root: resolve(platform), method: 'env:CLAUDE_PROJECT_DIR' };
  }

  const start = opts.startDir;
  if (start === undefined) {
    throw new WorkspaceError(
      'no GRAPH_ENGINE_WORKSPACE, no CLAUDE_PROJECT_DIR, and no startDir was given. ' +
        'This engine does not fall back to the current working directory — DEC-002 rejects it ' +
        'by name, because a directory change would silently swap which store is read.',
    );
  }

  let dir = resolve(start);
  for (;;) {
    if (MARKERS.some((m) => existsSync(join(dir, m)))) {
      return { root: dir, method: 'marker-walk' };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new WorkspaceError(
        `walked from ${JSON.stringify(resolve(start))} to the filesystem root without finding ` +
          `any of ${MARKERS.join(', ')}. Set GRAPH_ENGINE_WORKSPACE to say explicitly which ` +
          'project this store belongs to.',
      );
    }
    dir = parent;
  }
}

export interface StorePaths {
  readonly workspace: Workspace;
  readonly dir: string;
  readonly log: string;
}

export function storePaths(workspace: Workspace): StorePaths {
  const dir = join(workspace.root, '.claude', 'graph-engine');
  return { workspace, dir, log: join(dir, 'log.jsonl') };
}

/**
 * Create the store directory, writing its `.gitignore` in the same operation.
 *
 * `DEC-005` requires exactly that ordering: there must be no window in which an uncommitted
 * store exists without the ignore rule protecting it. The monorepo constitution forbids
 * committing captured content, and a store is captured content by definition.
 */
export function ensureStoreDir(paths: StorePaths): void {
  if (!existsSync(paths.dir)) {
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  }
  const ignore = join(paths.dir, '.gitignore');
  if (!existsSync(ignore)) {
    writeFileSync(
      ignore,
      '# Captured context. Never committed — see DEC-005 and the monorepo constitution.\n*\n',
      { mode: 0o600 },
    );
  }
}
