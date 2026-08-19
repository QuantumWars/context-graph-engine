import { describe, expect, test } from 'bun:test';
import { canonicalJson, CanonicalError, type Json } from '../src/provenance/canonical';

describe('canonicalJson', () => {
  test('key order does not change the output — the whole reason this exists', () => {
    const a: Json = { b: 1, a: 2, c: 3 };
    const b: Json = { c: 3, a: 2, b: 1 };
    expect(canonicalJson(a)).toBe('{"a":2,"b":1,"c":3}');
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    // Anti-vacuity: prove JSON.stringify really does differ on the same input, so this
    // test is measuring a real hazard rather than agreeing with itself.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  test('keys sort by UTF-16 code unit, not by locale', () => {
    // Locale-aware collation puts 'a' before 'B'; code-unit order does not.
    expect(canonicalJson({ B: 1, a: 2 })).toBe('{"B":1,"a":2}');
  });

  test('array order is preserved, unlike object key order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  test('an absent key is omitted and stays distinct from an explicit null', () => {
    // DEC-007 requires this distinction to survive a write and a reload.
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1, b: null })).toBe('{"a":1,"b":null}');
    expect(canonicalJson({ a: 1, b: undefined })).not.toBe(canonicalJson({ a: 1, b: null }));
  });

  test('no insignificant whitespace anywhere', () => {
    expect(canonicalJson({ a: [1, { b: 'x' }] })).toBe('{"a":[1,{"b":"x"}]}');
  });

  test('nesting is canonicalised at every depth, not only at the root', () => {
    expect(canonicalJson({ z: { b: 1, a: 2 } })).toBe('{"z":{"a":2,"b":1}}');
  });

  test('NaN and Infinity are refused with a reason code, never coerced to null', () => {
    // JSON.stringify turns both into null, which would make two different records hash
    // identically. A silent coercion here is a false "no tampering" later.
    expect(JSON.stringify({ a: NaN })).toBe('{"a":null}');
    for (const bad of [NaN, Infinity, -Infinity]) {
      let code: string | undefined;
      try {
        canonicalJson({ a: bad });
      } catch (e) {
        code = (e as CanonicalError).code;
      }
      expect(code).toBe('non_finite_number');
    }
  });

  test('undefined inside an array is refused rather than written as null', () => {
    let code: string | undefined;
    try {
      canonicalJson([1, undefined as unknown as Json, 3]);
    } catch (e) {
      code = (e as CanonicalError).code;
    }
    expect(code).toBe('unsupported_type');
  });

  test('unicode and quotes round-trip through JSON.parse unchanged', () => {
    const v: Json = { 'k"q': 'line\nbreak — é 😀' };
    expect(JSON.parse(canonicalJson(v))).toEqual(v as object);
  });
});
