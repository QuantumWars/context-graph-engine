/**
 * The labelled set.
 *
 * ─── THE LABELLING RULE, written before any constant was looked at ───────────────────────
 *
 * A record is RELEVANT to a query when, shown only the query and the record's text, a
 * competent engineer would say the record helps answer the query. Concretely, one of:
 *
 *   (a) the record is ABOUT the query's subject — it names the same system, incident or
 *       decision; or
 *   (b) the record is the direct CAUSE or the direct CONSEQUENCE of a record satisfying (a),
 *       and the graph records that link explicitly.
 *
 * A record is NOT relevant merely because it shares a word with the query. "deploy" appearing
 * in a cafeteria note does not make the cafeteria note relevant to a deploy question. Clause
 * (b) is deliberately limited to ONE hop and to edges that actually exist — it is what makes a
 * structural channel worth having, and widening it to two hops would make almost everything
 * relevant to almost everything.
 *
 * A query is labelled `expectNothing` when no record satisfies (a) or (b). An engine that
 * abstains must be graded on abstaining, so these are not padding — they are a third of the
 * failure modes.
 *
 * ─── WHO LABELLED IT, AND WHAT THAT IS WORTH ─────────────────────────────────────────────
 *
 * These labels were written by the **same session that wrote the retrieval code**. That is the
 * weakest thing about this dataset and it is stated here rather than in a footnote. It means
 * the numbers in `docs/constants-ledger.md` are evidence that the retrieval path behaves as
 * intended on cases its author considered — not evidence that it behaves well on cases its
 * author did not think of.
 *
 * Two things were done to limit the damage, and neither eliminates it:
 *
 *   1. The rule above was written first, and every label follows from the rule rather than
 *      from what the engine happens to return. Where the two disagreed, the label stood and
 *      the disagreement became a finding.
 *   2. `sweep.ts` is required to be capable of REJECTING a shipped constant, demonstrated
 *      against a case where the shipped value is measurably wrong. A harness that can only
 *      endorse what we already chose would be decoration.
 *
 * What would genuinely fix it: labels from someone who did not write the code, or from real
 * usage. Neither is available offline, and pretending otherwise would be worse than saying so.
 */

export interface EvalRecord {
  readonly id: string;
  readonly kind: 'decision' | 'node';
  readonly text: string;
}

export interface EvalEdge {
  readonly source: string;
  readonly target: string;
  readonly type: 'CAUSED' | 'INFLUENCED' | 'PRECEDENT_FOR';
  readonly weight: number;
}

export interface EvalQuery {
  readonly id: string;
  readonly query: string;
  /** Ids that must be returned. Empty when the correct answer is to abstain. */
  readonly relevant: readonly string[];
  /** Ids that must NOT be returned. Named explicitly where a plausible confusion exists. */
  readonly irrelevant?: readonly string[];
  /** Why this query is labelled the way it is. One line, for the reader who disagrees. */
  readonly note: string;
}

/** 34 records: four themes that interlink, plus deliberate noise that shares vocabulary. */
export const CORPUS: readonly EvalRecord[] = [
  // ── deploy / availability ───────────────────────────────────────────────────────────────
  { id: 'checkout-outage', kind: 'decision', text: 'checkout was unavailable for forty minutes after the friday afternoon deploy' },
  { id: 'deploy-freeze', kind: 'decision', text: 'no production deploys after thursday noon until a release gate exists' },
  { id: 'canary-gate', kind: 'decision', text: 'every release must pass a canary on five percent of traffic before full rollout' },
  { id: 'rollback-runbook', kind: 'node', text: 'to roll back, promote the previous image tag and drain the old pods' },
  { id: 'deploy-window', kind: 'node', text: 'the agreed release window is tuesday and wednesday, ten in the morning to four' },
  { id: 'oncall-rota', kind: 'node', text: 'primary and secondary rotate weekly with a handover note on friday' },
  { id: 'sre-headcount', kind: 'decision', text: 'approved two additional site reliability engineers for the platform team' },

  // ── database ────────────────────────────────────────────────────────────────────────────
  { id: 'migration-lock', kind: 'decision', text: 'the orders table migration held an exclusive lock and stalled writes for nine minutes' },
  { id: 'online-ddl', kind: 'decision', text: 'schema changes must use online DDL and never take an exclusive table lock' },
  { id: 'index-orders-created', kind: 'node', text: 'added a btree index on orders.created_at to stop the nightly report scanning the table' },
  { id: 'connection-pool', kind: 'node', text: 'the pool is capped at eighty connections per instance and queues beyond that' },
  { id: 'replica-lag', kind: 'decision', text: 'reads that must be fresh go to the primary, because replica lag reaches four seconds under load' },
  { id: 'backup-schedule', kind: 'node', text: 'full backup nightly at two, incremental every hour, retained for thirty days' },

  // ── authentication ──────────────────────────────────────────────────────────────────────
  { id: 'session-expiry', kind: 'decision', text: 'idle sessions expire after twelve hours rather than thirty days' },
  { id: 'token-rotation', kind: 'decision', text: 'signing keys rotate every ninety days with an overlap window of one week' },
  { id: 'logout-bug', kind: 'decision', text: 'logging out did not clear the refresh token, so a stolen token stayed valid' },
  { id: 'auth-runbook', kind: 'node', text: 'to revoke a compromised session, delete the refresh token row and bump the key version' },
  { id: 'mfa-rollout', kind: 'decision', text: 'multi factor authentication became mandatory for anyone with production access' },

  // ── observability ───────────────────────────────────────────────────────────────────────
  { id: 'alert-fatigue', kind: 'decision', text: 'alerts that fired more than ten times a week without action were deleted' },
  { id: 'trace-sampling', kind: 'decision', text: 'sample traces at one percent normally and one hundred percent for errors' },
  { id: 'dashboard-latency', kind: 'node', text: 'the latency dashboard shows p50, p95 and p99 for every public endpoint' },
  { id: 'log-retention', kind: 'node', text: 'application logs are kept for fourteen days and then deleted' },

  // ── deliberate noise: shares vocabulary, shares no subject ──────────────────────────────
  { id: 'cafeteria-menu', kind: 'node', text: 'the cafeteria deploys a new menu every wednesday and serves laksa on fridays' },
  { id: 'office-move', kind: 'node', text: 'the team moves to the third floor in march, desks by the window' },
  { id: 'laptop-refresh', kind: 'node', text: 'laptops older than four years are replaced on request' },
  { id: 'bike-shed', kind: 'node', text: 'the bike shed will be repainted blue after a lengthy discussion' },
  { id: 'expense-policy', kind: 'node', text: 'expenses over two hundred need a manager approval before submission' },
  { id: 'coffee-machine', kind: 'node', text: 'the coffee machine on the second floor is broken again and a ticket is open' },
  { id: 'parking-permit', kind: 'node', text: 'parking permits renew in january and cost nothing for cyclists' },
  { id: 'team-offsite', kind: 'node', text: 'the offsite is in june, two days, agenda to be decided' },
  { id: 'stationery-order', kind: 'node', text: 'stationery orders go through the office manager every second week' },
  { id: 'plant-watering', kind: 'node', text: 'the plants are watered on mondays by whoever arrives first' },
  { id: 'fire-drill', kind: 'node', text: 'the fire drill is scheduled for the last thursday of the quarter' },
  { id: 'welcome-pack', kind: 'node', text: 'new joiners get a welcome pack with a mug and a lanyard' },
];

/** Edges. Only explicit, asserted links — clause (b) depends on these being real. */
export const EDGES: readonly EvalEdge[] = [
  { source: 'checkout-outage', target: 'deploy-freeze', type: 'CAUSED', weight: 0.95 },
  { source: 'deploy-freeze', target: 'canary-gate', type: 'CAUSED', weight: 0.9 },
  { source: 'checkout-outage', target: 'sre-headcount', type: 'INFLUENCED', weight: 0.6 },
  { source: 'checkout-outage', target: 'rollback-runbook', type: 'CAUSED', weight: 0.8 },
  { source: 'migration-lock', target: 'online-ddl', type: 'CAUSED', weight: 0.95 },
  { source: 'migration-lock', target: 'index-orders-created', type: 'INFLUENCED', weight: 0.5 },
  { source: 'replica-lag', target: 'connection-pool', type: 'INFLUENCED', weight: 0.4 },
  { source: 'logout-bug', target: 'session-expiry', type: 'CAUSED', weight: 0.9 },
  { source: 'logout-bug', target: 'auth-runbook', type: 'CAUSED', weight: 0.85 },
  { source: 'logout-bug', target: 'token-rotation', type: 'INFLUENCED', weight: 0.7 },
  { source: 'alert-fatigue', target: 'trace-sampling', type: 'INFLUENCED', weight: 0.5 },
];

/** 18 queries. Three expect nothing; several need clause (b) to be answered at all. */
export const QUERIES: readonly EvalQuery[] = [
  { id: 'q01', query: 'checkout outage after the friday deploy', relevant: ['checkout-outage', 'deploy-freeze', 'sre-headcount', 'rollback-runbook'],
    irrelevant: ['cafeteria-menu'], note: '(a) the outage; (b) its three direct consequences. The cafeteria shares "deploy" and nothing else.' },
  { id: 'q02', query: 'why did we stop deploying on fridays', relevant: ['deploy-freeze', 'checkout-outage', 'canary-gate'],
    irrelevant: ['deploy-window', 'cafeteria-menu'], note: '(a) the freeze; (b) its cause and its consequence. The window is a different fact about scheduling.' },
  { id: 'q03', query: 'canary rollout requirement before full traffic', relevant: ['canary-gate', 'deploy-freeze'], note: '(a) the gate; (b) the decision that caused it.' },
  { id: 'q04', query: 'how do I roll back a bad release', relevant: ['rollback-runbook', 'checkout-outage'], note: '(a) the runbook; (b) the incident that caused it.' },
  { id: 'q05', query: 'exclusive table lock stalled writes', relevant: ['migration-lock', 'online-ddl', 'index-orders-created'], note: '(a) the incident; (b) both consequences.' },
  { id: 'q06', query: 'schema change policy online DDL', relevant: ['online-ddl', 'migration-lock'], note: '(a) the policy; (b) the incident that caused it.' },
  { id: 'q07', query: 'replica lag and reading fresh data', relevant: ['replica-lag', 'connection-pool'], note: '(a) the decision; (b) the linked pool note.' },
  { id: 'q08', query: 'nightly report scanning the orders table', relevant: ['index-orders-created', 'migration-lock'], note: '(a) the index; (b) the incident it came from.' },
  { id: 'q09', query: 'stolen refresh token stayed valid after logout', relevant: ['logout-bug', 'session-expiry', 'auth-runbook', 'token-rotation'], note: '(a) the bug; (b) its three consequences.' },
  { id: 'q10', query: 'how long before an idle session expires', relevant: ['session-expiry', 'logout-bug'], note: '(a) the decision; (b) its cause.' },
  { id: 'q11', query: 'revoke a compromised session', relevant: ['auth-runbook', 'logout-bug'], note: '(a) the runbook; (b) the bug that caused it.' },
  { id: 'q12', query: 'signing key rotation window', relevant: ['token-rotation', 'logout-bug'], note: '(a) rotation; (b) the bug that influenced it.' },
  { id: 'q13', query: 'multi factor for production access', relevant: ['mfa-rollout'], note: '(a) only. It has no edges, so clause (b) contributes nothing.' },
  { id: 'q14', query: 'noisy alerts that nobody acts on', relevant: ['alert-fatigue', 'trace-sampling'], note: '(a) the decision; (b) the linked sampling change.' },
  { id: 'q15', query: 'trace sampling rate for errors', relevant: ['trace-sampling', 'alert-fatigue'], note: '(a) sampling; (b) its cause.' },
  { id: 'q16', query: 'how long are application logs kept', relevant: ['log-retention'], note: '(a) only. log-retention has no edges, so clause (b) contributes nothing here.' },

  // Three that must return nothing. An engine that abstains is graded on abstaining.
  { id: 'q17', query: 'kubernetes ingress certificate renewal', relevant: [],
    irrelevant: ['token-rotation'], note: 'Nothing in the corpus is about ingress or certificates. Rotation is about signing keys, a different subject.' },
  { id: 'q18', query: 'quarterly revenue forecast by region', relevant: [], note: 'No record concerns revenue or forecasting.' },
  { id: 'q19', query: 'graphql schema stitching strategy', relevant: [],
    irrelevant: ['online-ddl'], note: 'No record concerns graphql. "schema" appears in a database policy, which is a different subject.' },
];
