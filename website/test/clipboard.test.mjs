import assert from "node:assert/strict";
import { test } from "node:test";
import { copyText } from "../lib/clipboard.ts";

function browser(t, { writeText, legacy = () => true } = {}) {
  const calls = [];
  class Element {
    focus() {
      calls.push("focus");
    }
  }
  const field = {
    style: {},
    value: "",
    select() {
      calls.push("select");
    },
    remove() {
      calls.push("remove");
    },
    setAttribute() {},
  };
  const values = {
    navigator: { clipboard: writeText ? { writeText } : undefined },
    HTMLElement: Element,
    document: {
      activeElement: new Element(),
      createElement() {
        calls.push("create");
        return field;
      },
      body: {
        appendChild() {
          calls.push("append");
        },
      },
      execCommand(command) {
        calls.push(command);
        return legacy();
      },
    },
  };
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  return { calls, field };
}

test("uses the async clipboard without a selection fallback when it succeeds", async (t) => {
  let written;
  const { calls } = browser(t, {
    writeText: async (text) => {
      written = text;
    },
  });
  assert.equal(await copyText("command"), true);
  assert.equal(written, "command");
  assert.deepEqual(calls, []);
});

test("returns the fallback's actual success and always removes its field", async (t) => {
  const { calls, field } = browser(t, {
    writeText: async () => {
      throw new Error("denied");
    },
    legacy: () => false,
  });
  assert.equal(await copyText("command"), false);
  assert.equal(field.value, "command");
  assert.deepEqual(calls, ["create", "append", "select", "copy", "remove", "focus"]);
});

test("cleans up when the fallback throws and accurately reports failure", async (t) => {
  const { calls } = browser(t, {
    legacy: () => {
      throw new Error("denied");
    },
  });
  assert.equal(await copyText("command"), false);
  assert.deepEqual(calls.slice(-2), ["remove", "focus"]);
});

test("supports browsers without navigator.clipboard via a successful fallback", async (t) => {
  browser(t);
  assert.equal(await copyText("command"), true);
});
