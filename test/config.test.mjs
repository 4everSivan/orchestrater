import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configBackupPath, defaultConfig, HARD_FORBIDDEN_PATHS, validateConfig, validateWriteScope, writeConfig } from "../src/config.mjs";

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
  assert.equal(defaultConfig().roles.length, 2);
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
  assert.throws(() => validateWriteScope({ allowedPaths: ["src/**"], verification: { command: "node", args: ["--token=secret"] } }), { code: "E_INPUT_VERIFICATION_SECRET" });
  assert.deepEqual(HARD_FORBIDDEN_PATHS, [".git/**", ".orchestrater/**", ".agents/**"]);
});

test("rejects unknown execution fields", () => {
  assert.throws(() => validateConfig({ ...config, extra: true }), { code: "E_INPUT_UNKNOWN_FIELD" });
  assert.throws(() => validateWriteScope({ allowedPaths: ["src/**"], verification: { command: "node", args: [], unexpected: true } }), { code: "E_INPUT_UNKNOWN_FIELD" });
});

test("creates configs atomically and preserves a migration backup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orchestrater-config-"));
  const path = join(directory, "config.json");
  await writeConfig(path, { version: 1 }, { createOnly: true });
  await assert.rejects(() => writeConfig(path, defaultConfig(), { createOnly: true }), { code: "E_POLICY_CONFIG_EXISTS" });
  await writeConfig(path, defaultConfig(), { backup: true });
  assert.deepEqual(JSON.parse(await readFile(configBackupPath(path), "utf8")), { version: 1 });
  assert.equal(JSON.parse(await readFile(path, "utf8")).version, 2);
});
