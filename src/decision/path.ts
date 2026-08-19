/**
 * Reconstruct the node sequence of a chain, in reading order.
 *
 * One function, used by both the CLI and the MCP server, because they had the same bug written
 * out twice — the second copy inherited it verbatim.
 *
 * WHY IT IS NOT `hops.map(h => h.from)` PLUS THE LAST `to`. `findChains` walks upstream by
 * following edges whose TARGET is the current node, so an upstream hop list arrives in reverse:
 *
 *     hop[0] = { from: parent,      to: start  }
 *     hop[1] = { from: grandparent, to: parent }
 *
 * Mapping `from` gives `[parent, grandparent]`, and appending the last hop's `to` appends
 * `parent` again — a node that is already in the list. The rendered path then visits it twice.
 *
 * It is correct at one hop, which is exactly why it survived six phases and 254 tests: every
 * causal fixture in the suite is a single hop or is walked downstream. It was caught by reading a
 * real two-hop chain on screen.
 */
import type { Hop } from './causal';

export function chainPath(hops: readonly Hop[], direction: 'upstream' | 'downstream'): readonly string[] {
  if (hops.length === 0) return [];
  return direction === 'downstream'
    // Forward order: start, then each hop's destination.
    ? [hops[0]!.from, ...hops.map((h) => h.to)]
    // Reverse order: the first hop's target IS the start, then walk back through the sources.
    : [hops[0]!.to, ...hops.map((h) => h.from)];
}
