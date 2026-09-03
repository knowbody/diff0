import { describe, expect, it } from "vitest";
import { lastJsonDocument } from "./last-json-document.js";

describe("lastJsonDocument", () => {
  it("parses a bare compact document", () => {
    expect(lastJsonDocument('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a pretty-printed multiline document", () => {
    const doc = JSON.stringify({ results: [{ id: "x", nested: { deep: [1, 2] } }] }, null, 2);
    expect(lastJsonDocument(doc)).toEqual({ results: [{ id: "x", nested: { deep: [1, 2] } }] });
  });

  it("ignores noise before and after the document", () => {
    const text = `Listening on http://127.0.0.1:3000\nwarming up...\n${JSON.stringify(
      { ok: true },
      null,
      2,
    )}\nshutting down sandbox handles\nbye\n`;
    expect(lastJsonDocument(text)).toEqual({ ok: true });
  });

  it("returns the last of multiple documents", () => {
    const text = `${JSON.stringify({ first: 1 })}\n${JSON.stringify({ second: 2 }, null, 2)}\n`;
    expect(lastJsonDocument(text)).toEqual({ second: 2 });
  });

  it("is not confused by indented braces inside a pretty document", () => {
    // Inner objects/arrays start at indented line positions; the parser must
    // return the full outer document, not an inner fragment.
    const doc = JSON.stringify({ outer: { inner: { a: 1 } }, list: [{ b: 2 }] }, null, 2);
    expect(lastJsonDocument(`noise\n${doc}`)).toEqual({
      outer: { inner: { a: 1 } },
      list: [{ b: 2 }],
    });
  });

  it("handles braces and escapes inside JSON strings", () => {
    const doc = JSON.stringify({ tricky: '}{"]\\[', quote: 'she said "hi"' });
    expect(lastJsonDocument(`x\n${doc}`)).toEqual({ tricky: '}{"]\\[', quote: 'she said "hi"' });
  });

  it("skips unbalanced brace noise at line starts before the document", () => {
    const text = `{ oops unbalanced\n${JSON.stringify({ real: true }, null, 2)}`;
    expect(lastJsonDocument(text)).toEqual({ real: true });
  });

  it("skips balanced-but-invalid candidates after the document", () => {
    const text = `${JSON.stringify({ real: true })}\n{not json}\n`;
    expect(lastJsonDocument(text)).toEqual({ real: true });
  });

  it("parses arrays as documents (eve eval --list --json)", () => {
    const text = `banner line\n${JSON.stringify([{ id: "a" }, { id: "b" }], null, 2)}`;
    expect(lastJsonDocument(text)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("handles CRLF line endings", () => {
    const text = `noise\r\n${JSON.stringify({ crlf: true })}\r\n`;
    expect(lastJsonDocument(text)).toEqual({ crlf: true });
  });

  it("throws when no document is present", () => {
    expect(() => lastJsonDocument("just some logs\nno json here")).toThrow(/No JSON document/);
  });
});
