import { spawn } from "node:child_process";

export function run(command, args, { cwd = process.cwd(), input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ stdout, stderr, exitCode }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function runJson(command, args, options) {
  const result = await run(command, args, options);
  if (result.exitCode !== 0) return { ...result, data: undefined };
  try {
    return { ...result, data: JSON.parse(result.stdout) };
  } catch {
    return { ...result, data: undefined };
  }
}
