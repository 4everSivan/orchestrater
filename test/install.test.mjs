import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, lstat, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const installer = new URL("../bin/install.mjs", import.meta.url);

function install(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [installer.pathname, ...args], { env: { ...process.env, ...env } });
    child.on("close", (exitCode) => resolve(exitCode));
  });
}

test("requires explicit authorization for custom destinations and rejects symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orchestrater-install-"));
  const custom = join(directory, "custom");
  try {
    assert.equal(await install(["--host", "codex"], { ORCHESTRATER_SKILL_DIR: custom }), 2);
    assert.equal(await install(["--host", "codex", "--allow-custom-destination"], { ORCHESTRATER_SKILL_DIR: custom }), 0);
    await symlink(custom, join(directory, "link"));
    assert.equal((await lstat(join(directory, "link"))).isSymbolicLink(), true);
    assert.equal(await install(["--host", "codex", "--allow-custom-destination", "--force"], { ORCHESTRATER_SKILL_DIR: join(directory, "link") }), 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
