export const cases = [
  {
    name: "ttl-boundary-bug",
    request:
      "Fix TTL cache expiration: an entry is expired exactly at expiresAt, not one millisecond later. Preserve zero values, allow replacing a key, and remove expired entries. Keep the public API unchanged.",
    source: `export class TTLCache {
  constructor(now = Date.now) { this.now = now; this.entries = new Map(); }
  set(key, value, ttlMs) { this.entries.set(key, { value, expiresAt: this.now() + ttlMs }); }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() > entry.expiresAt) { this.entries.delete(key); return undefined; }
    return entry.value;
  }
}
`,
    tests: `let now = 100; const cache = new subject.TTLCache(() => now);
cache.set('a', 0, 10); assert.equal(cache.get('a'), 0);
now = 109; assert.equal(cache.get('a'), 0);
now = 110; assert.equal(cache.get('a'), undefined);
assert.equal(cache.entries.has('a'), false);
cache.set('b', 'old', 5); cache.set('b', 'new', 20); now = 116;
assert.equal(cache.get('b'), 'new'); assert.equal(cache.get('absent'), undefined);
cache.set('instant', 1, 0); assert.equal(cache.get('instant'), undefined);`,
  },
  {
    name: "chunk-feature",
    request:
      "Add exported chunk(items, size): return arrays of at most size elements preserving order, without mutating the input; [] returns []. Reject nonpositive, noninteger, or nonfinite sizes with RangeError, including when items is empty. Preserve the existing unique API.",
    source: "export function unique(items) { return [...new Set(items)]; }\n",
    tests: `assert.deepEqual(subject.unique([1,1,2]), [1,2]);
assert.deepEqual(subject.chunk([1,2,3,4,5], 2), [[1,2],[3,4],[5]]);
const input = Object.freeze([1,2,3]); assert.deepEqual(subject.chunk(input, 8), [[1,2,3]]);
assert.deepEqual(subject.chunk([], 1), []); assert.deepEqual(subject.chunk([null,undefined], 1), [[null],[undefined]]);
for (const n of [0,-1,1.5,NaN,Infinity]) { assert.throws(() => subject.chunk([1], n), RangeError); assert.throws(() => subject.chunk([], n), RangeError); }`,
  },
  {
    name: "summary-refactor",
    request:
      "Refactor summarize to replace repeated status filtering with one pass over the entries. Preserve every return field and current behavior. Keep its public API; do not mutate input. Existing tests must continue to pass.",
    source: `export function summarize(entries) {
  const passed = entries.filter(e => e.status === 'passed').length;
  const failed = entries.filter(e => e.status === 'failed').length;
  const skipped = entries.filter(e => e.status === 'skipped').length;
  return { total: entries.length, passed, failed, skipped, passRate: entries.length === 0 ? null : passed / entries.length };
}
`,
    tests: `assert.deepEqual(subject.summarize([]), {total:0,passed:0,failed:0,skipped:0,passRate:null});
const input = Object.freeze([Object.freeze({status:'passed'}),Object.freeze({status:'failed'}),Object.freeze({status:'skipped'}),Object.freeze({status:'other'})]);
assert.deepEqual(subject.summarize(input), {total:4,passed:1,failed:1,skipped:1,passRate:0.25});
assert.deepEqual(subject.summarize([{status:'passed'},{status:'passed'}]), {total:2,passed:2,failed:0,skipped:0,passRate:1});`,
  },
];
