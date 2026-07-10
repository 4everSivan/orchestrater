import test from "node:test";
import assert from "node:assert/strict";
import { assertCreatable, resolveTerminal } from "../src/terminal.mjs";

const role = { terminalTitle: "orchestrater:implementation" };

test("resolves exactly one connected writable terminal", () => {
  assert.deepEqual(resolveTerminal(role, { terminals: [{ title: role.terminalTitle, handle: "term_1", connected: true, writable: true }] }), { handle: "term_1", title: role.terminalTitle });
});

test("blocks duplicate and non-writable titles", () => {
  assert.throws(() => resolveTerminal(role, { terminals: [{ title: role.terminalTitle }, { title: role.terminalTitle }] }), { code: "E_TERMINAL_DUPLICATE" });
  assert.throws(() => resolveTerminal(role, { terminals: [{ title: role.terminalTitle, handle: "term_1", writable: false }] }), { code: "E_TERMINAL_NOT_WRITABLE" });
});

test("requires explicit confirmation for untrusted terminal commands", () => {
  assert.throws(() => assertCreatable({ command: "agy" }, false), { code: "E_POLICY_COMMAND_UNTRUSTED" });
  assert.doesNotThrow(() => assertCreatable({ command: "agy" }, true));
});
