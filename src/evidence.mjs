import { evidenceError, policyError } from "./errors.mjs";
import { head, requireClean, statusPaths } from "./git.mjs";
import { findTask } from "./orca.mjs";
import { pathAllowed, validateWriteScope } from "./config.mjs";
import { run } from "./process.mjs";

export async function captureEvidence({ client, taskId, scope, cwd }) {
  const writeScope = validateWriteScope(scope);
  await requireClean(cwd);
  const evidence = {
    version: 1,
    taskId,
    baseHead: await head(cwd),
    initialStatus: [],
    writeScope,
  };
  await client.taskUpdate(taskId, "ready", { evidence });
  return evidence;
}

function evidenceFromTask(task) {
  const evidence = task?.result?.evidence ?? task?.result?.result?.evidence;
  if (!evidence || evidence.version !== 1) {
    throw evidenceError("E_BASELINE_MISSING", "Task has no valid dispatch baseline", "create a new task and capture evidence before dispatching");
  }
  return evidence;
}

export async function verifyEvidence({ client, taskId, cwd }) {
  const tasks = await client.taskList();
  const task = findTask(tasks, taskId);
  if (!task) throw evidenceError("E_BASELINE_MISSING", `Task ${taskId} was not found`, "refresh Orca tasks before verification");
  const evidence = evidenceFromTask(task);
  const paths = await statusPaths(cwd);
  const outOfScope = paths.filter((path) => !pathAllowed(path, evidence.writeScope.allowedPaths));
  if (outOfScope.length > 0) {
    throw evidenceError("E_EVIDENCE_OUT_OF_SCOPE", `Worker modified paths outside writeScope: ${outOfScope.join(", ")}`, "create a conflict gate and do not complete the task");
  }
  const verification = await run(evidence.writeScope.verification.command, evidence.writeScope.verification.args, { cwd });
  const result = {
    evidence: {
      ...evidence,
      filesModified: paths,
      verification: {
        ...evidence.writeScope.verification,
        exitCode: verification.exitCode,
      },
    },
  };
  if (verification.exitCode !== 0) {
    const error = evidenceError("E_EVIDENCE_VERIFICATION_FAILED", "Verification command failed", "create a conflict gate and inspect the recorded exit code");
    error.details = result;
    throw error;
  }
  return result;
}

export function requireWriteRole(config, roleName) {
  const role = config.roles.find((candidate) => candidate.name === roleName);
  if (!role?.writeAccess) {
    throw policyError("E_POLICY_WRITE_ROLE", `Role ${roleName} cannot write`, "select a writable configured role");
  }
  return role;
}
