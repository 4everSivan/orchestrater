import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig, HARD_FORBIDDEN_PATHS, validateConfig, validateWriteScope } from "../src/config.mjs";

const config = {
  version: 2,
  coordinator: { mode: "current-session" },
  permissions: { writeModel: "single-writer", allowParallelWrites: false, defaultWriteRole: "implementation" },
  roles: [
    { name: "implementation", agent: "codex", command: "codex", terminalTitle: "impl", writeAccess: true, responsibilities: [] },
    { name: "review", agent: "claude", command: "claude", terminalTitle: "review", writeAccess: false, responsibilities: [] },
  ],
};

test("validates a v2 config with a writable default role", () => {
  assert.equal(validateConfig(config).valid, true);
  assert.equal(validateConfig(defaultConfig()).valid, true);
});

test("returns a migration preview for v1 without silently accepting it", () => {
  const result = validateConfig({ ...config, version: 1 });
  assert.equal(result.valid, false);
  assert.equal(result.migration.version, 2);
});

test("rejects invalid write scopes and protected paths", () => {
  assert.throws(() => validateWriteScope({ allowedPaths: [], verification: { command: "node", args: [] } }), { code: "E_INPUT_WRITE_SCOPE" });
  assert.throws(() => validateWriteScope({ allowedPaths: ["../secret"], verification: { command: "node", args: [] } }), { code: "E_INPUT_WRITE_SCOPE_PATH" });
  assert.throws(() => validateWriteScope({ allowedPaths: [".git/**"], verification: { command: "node", args: [] } }), { code: "E_POLICY_FORBIDDEN_PATH" });
  assert.throws(() => validateWriteScope({ allowedPaths: [".git"], verification: { command: "node", args: [] } }), { code: "E_POLICY_FORBIDDEN_PATH" });
  assert.deepEqual(HARD_FORBIDDEN_PATHS, [".git/**", ".orchestrater/**", ".agents/**"]);
});
