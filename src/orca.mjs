import { runtimeError } from "./errors.mjs";
import { run, runJson } from "./process.mjs";

export const REQUIRED_CAPABILITIES = Object.freeze([
  { args: ["terminal", "list", "--help"], expected: "terminal list" },
  { args: ["terminal", "create", "--help"], expected: "terminal create" },
  { args: ["orchestration", "task-list", "--help"], expected: "--ready" },
  { args: ["orchestration", "task-update", "--help"], expected: "--result" },
  { args: ["orchestration", "dispatch", "--help"], expected: "--inject" },
]);

export async function probeCapabilities(command, cwd, runner = run) {
  for (const capability of REQUIRED_CAPABILITIES) {
    let result;
    try {
      result = await runner(command, capability.args, { cwd });
    } catch (error) {
      if (error.code === "ENOENT") throw runtimeError("E_RUNTIME_ORCA_MISSING", "Orca CLI is not installed", "install Orca before dispatching");
      throw error;
    }
    if (result.exitCode !== 0 || !result.stdout.includes(capability.expected)) {
      throw runtimeError("E_RUNTIME_ORCA_INCOMPATIBLE", `Orca capability missing: ${capability.args.slice(0, 2).join(" ")}`, "install an Orca CLI that supports the required orchestration commands");
    }
  }
  return true;
}

function unwrap(result) {
  if (result.exitCode !== 0) {
    throw runtimeError("E_RUNTIME_ORCA", result.stderr.trim() || "Orca command failed", "start Orca and retry preflight");
  }
  if (!result.data || result.data.ok === false) {
    throw runtimeError("E_RUNTIME_ORCA_JSON", "Orca did not return valid JSON", "verify the installed Orca CLI version");
  }
  return result.data.result ?? result.data;
}

export class OrcaClient {
  constructor({ command = process.env.ORCHESTRATER_ORCA_BIN ?? "orca", cwd = process.cwd() } = {}) {
    this.command = command;
    this.cwd = cwd;
  }

  async json(args) {
    try {
      return unwrap(await runJson(this.command, [...args, "--json"], { cwd: this.cwd }));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw runtimeError("E_RUNTIME_ORCA_MISSING", "Orca CLI is not installed", "install Orca or set ORCHESTRATER_ORCA_BIN");
      }
      throw error;
    }
  }

  async status() {
    const result = await this.json(["status"]);
    if (result.runtime?.reachable !== true || result.runtime?.state !== "ready") {
      throw runtimeError("E_RUNTIME_ORCA_DOWN", "Orca runtime is not ready", "start Orca before dispatching");
    }
    return result;
  }

  capabilities() {
    return probeCapabilities(this.command, this.cwd);
  }

  terminalList() {
    return this.json(["terminal", "list", "--worktree", "active"]);
  }

  taskList() {
    return this.json(["orchestration", "task-list"]);
  }

  taskUpdate(id, status, result) {
    return this.json(["orchestration", "task-update", "--id", id, "--status", status, "--result", JSON.stringify(result)]);
  }

  terminalCreate(title, command) {
    return this.json(["terminal", "create", "--worktree", "active", "--title", title, "--command", command]);
  }
}

export function listItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.terminals)) return value.terminals;
  if (Array.isArray(value.tasks)) return value.tasks;
  return [];
}

export function findTask(value, id) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTask(item, id);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (value.id === id) return value;
  for (const child of Object.values(value)) {
    const found = findTask(child, id);
    if (found) return found;
  }
  return undefined;
}
