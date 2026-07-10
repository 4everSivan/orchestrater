import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { captureEvidence, verifyEvidence } from "../src/evidence.mjs";

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function repository() {
  const cwd = await mkdtemp(join(tmpdir(), "orchestrater-evidence-"));
  git(cwd, "init");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  await writeFile(join(cwd, "README.md"), "base\n");
  git(cwd, "add", "README.md");
  git(cwd, "commit", "-m", "base");
  return cwd;
}

test("captures and verifies only in-scope changes", async () => {
  const cwd = await repository();
  let result;
  const client = {
    taskUpdate: async (_id, _status, next) => { result = next; },
    taskList: async () => ({ tasks: [{ id: "task_1", result }] }),
  };
  await captureEvidence({ client, taskId: "task_1", cwd, scope: { allowedPaths: ["src/**"], verification: { command: "node", args: ["-e", "process.exit(0)"] } } });
  await writeFile(join(cwd, "src.js"), "outside\n");
  await assert.rejects(() => verifyEvidence({ client, taskId: "task_1", cwd }), { code: "E_EVIDENCE_OUT_OF_SCOPE" });
});

test("returns verification failure with structured evidence", async () => {
  const cwd = await repository();
  let result;
  const client = {
    taskUpdate: async (_id, _status, next) => { result = next; },
    taskList: async () => ({ tasks: [{ id: "task_2", result }] }),
  };
  await captureEvidence({ client, taskId: "task_2", cwd, scope: { allowedPaths: ["src.js"], verification: { command: "node", args: ["-e", "process.exit(9)"] } } });
  await writeFile(join(cwd, "src.js"), "changed\n");
  await assert.rejects(() => verifyEvidence({ client, taskId: "task_2", cwd }), (error) => error.code === "E_EVIDENCE_VERIFICATION_FAILED" && error.details.evidence.verification.exitCode === 9);
});

test("rejects files created by verification outside the approved scope", async () => {
  const cwd = await repository();
  let result;
  const client = {
    taskUpdate: async (_id, _status, next) => { result = next; },
    taskList: async () => ({ tasks: [{ id: "task_3", result }] }),
  };
  await captureEvidence({ client, taskId: "task_3", cwd, scope: { allowedPaths: ["src.js"], verification: { command: "node", args: ["-e", "require('node:fs').writeFileSync('coverage.txt', 'generated')"] } } });
  await writeFile(join(cwd, "src.js"), "changed\n");
  await assert.rejects(() => verifyEvidence({ client, taskId: "task_3", cwd }), { code: "E_EVIDENCE_OUT_OF_SCOPE" });
});

test("rejects evidence whose approval no longer matches its captured scope", async () => {
  const cwd = await repository();
  let result;
  const client = {
    taskUpdate: async (_id, _status, next) => { result = next; },
    taskList: async () => ({ tasks: [{ id: "task_4", result }] }),
  };
  await captureEvidence({ client, taskId: "task_4", cwd, scope: { allowedPaths: ["src.js"], verification: { command: "node", args: ["-e", "process.exit(0)"] } } });
  result.evidence.writeScope.allowedPaths = ["README.md"];
  await assert.rejects(() => verifyEvidence({ client, taskId: "task_4", cwd }), { code: "E_APPROVAL_INVALID" });
});
