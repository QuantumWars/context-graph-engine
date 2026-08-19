/**
 * Canonical JSON — the one serialisation every digest in this engine goes through.
 *
 * `DEC-007` fixes the rule and names it: the JSON Canonicalization Scheme, RFC 8785.
 * Keys sorted by UTF-16 code unit, no insignificant whitespace, `null` explicit, an
 * absent key omitted entirely so omission and `null` stay distinct.
 *
 * Why this exists at all, rather than `JSON.stringify`: JSON is not deterministic.
 * `JSON.stringify` emits keys in insertion order, so the same logical record hashed on
 * two code paths produces two digests, and the difference surfaces as tampering. The
 * failure mode is a false accusation, which is worse than no check.
 *
 * What it replaces in the ported original: `semantica/semantica/provenance/integrity.py:74-116`
 * concatenates sixteen field values with no separator, so `("ab","c")` and `("a","bc")`
 * hash identically. A separator would not fix it — any separator can occur inside a value.
 * JSON is self-delimiting, which is the actual fix.
 */

/** A value that can be canonicalised. `undefined` in an object means "omit this key". */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [k: string]: Json | undefined };

export type CanonicalErrorCode =
  | 'non_finite_number'
  | 'unsupported_type'
  | 'undefined_root';

/**
 * Every guard in this engine fails with a reason code rather than a bare throw or a
 * silent return — HARD RULE 4. The code is the stable part; the message is for humans.
 */
export class CanonicalError extends Error {
  readonly code: CanonicalErrorCode;
  constructor(code: CanonicalErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'CanonicalError';
    this.code = code;
  }
}

/** Sort by UTF-16 code unit, which is what RFC 8785 specifies — not by locale. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function write(value: Json | undefined, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }

  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;

    case 'number':
      // JSON has no NaN or Infinity. `JSON.stringify` silently turns them into `null`,
      // which would make two different records hash the same — so this is an error,
      // not a coercion.
      if (!Number.isFinite(value)) {
        throw new CanonicalError(
          'non_finite_number',
          `${String(value)} has no JSON representation and must not be silently coerced`,
        );
      }
      // RFC 8785 defers number formatting to ECMAScript's own Number-to-String, which
      // is exactly what JSON.stringify applies here.
      out.push(JSON.stringify(value));
      return;

    case 'string':
      // JSON.stringify's string escaping is the minimal escaping RFC 8785 requires.
      out.push(JSON.stringify(value));
      return;

    case 'object':
      break;

    default:
      throw new CanonicalError(
        'unsupported_type',
        `${typeof value} cannot appear in a canonical record`,
      );
  }

  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      // An array hole or an explicit `undefined` has no JSON form. JSON.stringify writes
      // `null` for it; we refuse, for the same reason as non-finite numbers.
      const item = value[i];
      if (item === undefined) {
        throw new CanonicalError(
          'unsupported_type',
          `undefined at array index ${i} has no canonical form`,
        );
      }
      write(item, out);
    }
    out.push(']');
    return;
  }

  const obj = value as { readonly [k: string]: Json | undefined };
  // Omission is meaningful and must be stable: a key whose value is `undefined` is not
  // written at all, which is distinct from a key written as `null`. DEC-007 requires
  // that distinction to survive a write and a reload unchanged.
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort(byCodeUnit);

  out.push('{');
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) out.push(',');
    const k = keys[i] as string;
    out.push(JSON.stringify(k), ':');
    write(obj[k], out);
  }
  out.push('}');
}

/** Serialise `value` to its canonical form. Throws `CanonicalError` rather than coercing. */
export function canonicalJson(value: Json): string {
  if (value === undefined) {
    throw new CanonicalError('undefined_root', 'undefined is not a canonicalisable value');
  }
  const out: string[] = [];
  write(value, out);
  return out.join('');
}
