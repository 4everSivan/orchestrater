import { evidenceError, policyError } from "./errors.mjs";
import { createHash } from "node:crypto";
import { head, requireClean, statusPaths } from "./git.mjs";
import { findTask } from "./orca.mjs";
import { pathAllowed, validateWriteScope } from "./config.mjs";
import { run } from "./process.mjs";

export async function captureEvidence({ client, taskId, scope, cwd }) {
  const writeScope = validateWriteScope(scope);
  await requireClean(cwd);
  const approval = createApproval(taskId, writeScope);
  const evidence = {
    version: 1,
    taskId,
    baseHead: await head(cwd),
    initialStatus: [],
    writeScope,
    approval,
  };
  await client.taskUpdate(taskId, "ready", { evidence });
  return evidence;
}

function canonicalScope(scope) {
  return JSON.stringify({
    allowedPaths: [...scope.allowedPaths],
    verification: { command: scope.verification.command, args: [...scope.verification.args] },
  });
}

export function scopeHash(scope) {
  return `sha256:${createHash("sha256").update(canonicalScope(scope)).digest("hex")}`;
}

export function createApproval(taskId, scope) {
  return {
    taskId,
    scope,
    scopeHash: scopeHash(scope),
    confirmedInCurrentSession: true,
  };
}

function evidenceFromTask(task) {
  const evidence = task?.result?.evidence ?? task?.result?.result?.evidence;
  if (!evidence || evidence.version !== 1) {
    throw evidenceError("E_BASELINE_MISSING", "Task has no valid dispatch baseline", "create a new task and capture evidence before dispatching");
  }
  const approval = evidence.approval;
  if (!approval?.confirmedInCurrentSession || approval.taskId !== evidence.taskId || approval.scopeHash !== scopeHash(evidence.writeScope) || approval.scopeHash !== scopeHash(approval.scope)) {
    throw evidenceError("E_APPROVAL_INVALID", "Task approval is missing or does not match the captured scope", "create a new approved task before dispatching");
  }
  return evidence;
}

export async function verifyEvidence({ client, taskId, cwd }) {
  const tasks = await client.taskList();
  const task = findTask(tasks, taskId);
  if (!task) throw evidenceError("E_BASELINE_MISSING", `Task ${taskId} was not found`, "refresh Orca tasks before verification");
  const evidence = evidenceFromTask(task);
  const pathsBefore = await statusPaths(cwd);
  const outOfScope = pathsBefore.filter((path) => !pathAllowed(path, evidence.writeScope.allowedPaths));
  if (outOfScope.length > 0) {
    throw evidenceError("E_EVIDENCE_OUT_OF_SCOPE", `Worker modified paths outside writeScope: ${outOfScope.join(", ")}`, "create a conflict gate and do not complete the task");
  }
  const verification = await run(evidence.writeScope.verification.command, evidence.writeScope.verification.args, { cwd });
  const pathsAfter = await statusPaths(cwd);
  const filesModified = [...new Set([...pathsBefore, ...pathsAfter])];
  const postVerificationOutOfScope = filesModified.filter((path) => !pathAllowed(path, evidence.writeScope.allowedPaths));
  if (postVerificationOutOfScope.length > 0) {
    throw evidenceError("E_EVIDENCE_OUT_OF_SCOPE", `Verification modified paths outside writeScope: ${postVerificationOutOfScope.join(", ")}`, "create a conflict gate and do not complete the task");
  }
  const result = {
    evidence: {
      ...evidence,
      filesModified,
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
