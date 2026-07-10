import test from "node:test";
import assert from "node:assert/strict";
import { probeCapabilities, REQUIRED_CAPABILITIES } from "../src/orca.mjs";

test("accepts a CLI that exposes every required capability", async () => {
  await assert.doesNotReject(() => probeCapabilities("orca", process.cwd(), async (_command, args) => ({ exitCode: 0, stdout: `help ${args.join(" ")} ${REQUIRED_CAPABILITIES.find((item) => item.args.join(" ") === args.join(" ")).expected}` })));
});

test("blocks an incompatible Orca CLI", async () => {
  await assert.rejects(() => probeCapabilities("orca", process.cwd(), async () => ({ exitCode: 0, stdout: "old help" })), { code: "E_RUNTIME_ORCA_INCOMPATIBLE" });
});
