import { policyError, runtimeError } from "./errors.mjs";
import { run } from "./process.mjs";

async function git(args, options) {
  const result = await run("git", args, options);
  if (result.exitCode !== 0) {
    throw runtimeError("E_RUNTIME_GIT", result.stderr.trim() || "git command failed", "run orchestrater inside a Git repository");
  }
  return result.stdout;
}

export async function head(cwd) {
  return (await git(["rev-parse", "HEAD"], { cwd })).trim();
}

export async function statusPaths(cwd) {
  const output = await git(["status", "--porcelain=v1", "-z"], { cwd });
  const records = output.split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const code = record.slice(0, 2);
    paths.push(record.slice(3));
    if ((code[0] === "R" || code[0] === "C" || code[1] === "R" || code[1] === "C") && records[index + 1]) {
      paths.push(records[index + 1]);
      index += 1;
    }
  }
  return paths;
}

export async function requireClean(cwd) {
  const paths = await statusPaths(cwd);
  if (paths.length > 0) {
    throw policyError("E_POLICY_WORKTREE_DIRTY", "write tasks require a clean worktree", "commit, stash, or revert existing changes before dispatching");
  }
}
