import test from "node:test";
import assert from "node:assert/strict";
import { execute } from "../src/cli.mjs";

test("does not capture evidence before an approved plan", async () => {
  await assert.rejects(
    () => execute(["evidence", "capture", "--task", "task_1", "--write-scope", "{\"allowedPaths\":[\"src/**\"],\"verification\":{\"command\":\"node\",\"args\":[]}}"]),
    { code: "E_POLICY_APPROVAL_REQUIRED" },
  );
});
