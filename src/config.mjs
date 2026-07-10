import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inputError, policyError } from "./errors.mjs";

export const HARD_FORBIDDEN_PATHS = Object.freeze([".git/**", ".orchestrater/**", ".agents/**"]);
export const TRUSTED_COMMANDS = new Set(["codex", "claude"]);

const DEFAULTS = Object.freeze({
  worktree: "active",
  strategy: "plan-first",
  autoCreateTerminals: true,
  onMissingRole: "ask",
  maxConcurrentReadWorkers: 2,
});

export function defaultConfig() {
  return {
    version: 2,
    coordinator: { mode: "current-session" },
    defaults: { ...DEFAULTS },
    permissions: { writeModel: "single-writer", allowParallelWrites: false, defaultWriteRole: "implementation" },
    roles: [
      { name: "implementation", agent: "codex", command: "codex", terminalTitle: "orchestrater:implementation", session: "dedicated", writeAccess: true, responsibilities: ["implement", "run targeted verification"] },
      { name: "review", agent: "claude", command: "claude", terminalTitle: "orchestrater:review", session: "dedicated", writeAccess: false, responsibilities: ["review", "report findings"] },
    ],
  };
}

function assertKnownKeys(value, allowed, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError("E_INPUT_CONFIG_FIELD", `${location} must be an object`, `set ${location} to an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw inputError("E_INPUT_UNKNOWN_FIELD", `Unknown field ${location}.${key}`, "remove the field or migrate to a schema version that supports it");
    }
  }
}

const TOP_LEVEL_FIELDS = new Set(["version", "coordinator", "defaults", "permissions", "roles"]);
const COORDINATOR_FIELDS = new Set(["mode"]);
const DEFAULT_FIELDS = new Set(["worktree", "strategy", "autoCreateTerminals", "onMissingRole", "maxConcurrentReadWorkers"]);
const PERMISSION_FIELDS = new Set(["writeModel", "allowParallelWrites", "defaultWriteRole"]);
const ROLE_FIELDS = new Set(["name", "agent", "command", "terminalTitle", "session", "writeAccess", "responsibilities"]);
const WRITE_SCOPE_FIELDS = new Set(["allowedPaths", "verification"]);
const VERIFICATION_FIELDS = new Set(["command", "args"]);

export async function readConfig(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw policyError("E_POLICY_CONFIG_MISSING", `Missing config: ${path}`, "run config migrate or initialize orchestrater");
    }
    throw inputError("E_INPUT_CONFIG_JSON", `Invalid JSON in ${path}`, "fix the config JSON before dispatching");
  }
}

export function migrateV1(config) {
  const roles = Array.isArray(config.roles) ? config.roles.map((role) => ({
    name: role.name,
    agent: role.agent,
    command: role.command,
    terminalTitle: role.terminalTitle,
    session: role.session ?? "dedicated",
    writeAccess: Boolean(role.writeAccess),
    responsibilities: Array.isArray(role.responsibilities) ? role.responsibilities : [],
  })) : [];
  const requestedWriteRole = config.permissions?.defaultWriteRole;
  const validWriteRole = roles.some((role) => role.name === requestedWriteRole && role.writeAccess);
  const { maxConcurrentWorkers: _legacyConcurrency, ...legacyDefaults } = config.defaults ?? {};
  return {
    version: 2,
    coordinator: { mode: config.coordinator?.mode ?? "current-session" },
    defaults: {
      ...DEFAULTS,
      ...legacyDefaults,
      maxConcurrentReadWorkers: config.defaults?.maxConcurrentReadWorkers ?? config.defaults?.maxConcurrentWorkers ?? DEFAULTS.maxConcurrentReadWorkers,
    },
    permissions: {
      writeModel: "single-writer",
      allowParallelWrites: false,
      defaultWriteRole: validWriteRole ? requestedWriteRole : null,
    },
    roles,
  };
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw inputError("E_INPUT_CONFIG_FIELD", `${field} must be a non-empty string`, `set ${field} in config v2`);
  }
  return value;
}

export function validateConfig(config) {
  assertKnownKeys(config, TOP_LEVEL_FIELDS, "config");
  if (config.version === 1) {
    return { valid: false, migration: migrateV1(config), warnings: ["config v1 requires explicit migration to v2"] };
  }
  if (config.version !== 2) {
    throw inputError("E_INPUT_CONFIG_VERSION", "config.version must be 2", "migrate the config before dispatching");
  }
  assertKnownKeys(config.coordinator, COORDINATOR_FIELDS, "config.coordinator");
  assertKnownKeys(config.defaults ?? {}, DEFAULT_FIELDS, "config.defaults");
  assertKnownKeys(config.permissions ?? {}, PERMISSION_FIELDS, "config.permissions");
  if (config.coordinator?.mode !== "current-session") {
    throw inputError("E_INPUT_COORDINATOR", "coordinator.mode must be current-session", "set coordinator.mode to current-session");
  }
  if (!Array.isArray(config.roles) || config.roles.length === 0) {
    throw inputError("E_INPUT_ROLES", "config.roles must contain at least one role", "add a read or write role");
  }
  const names = new Set();
  const titles = new Set();
  const roles = config.roles.map((role, index) => {
    assertKnownKeys(role, ROLE_FIELDS, `config.roles[${index}]`);
    const name = requireString(role.name, `roles[${index}].name`);
    const terminalTitle = requireString(role.terminalTitle, `roles[${index}].terminalTitle`);
    if (names.has(name)) throw inputError("E_INPUT_ROLE_DUPLICATE", `duplicate role: ${name}`, "use unique role names");
    if (titles.has(terminalTitle)) throw inputError("E_INPUT_TITLE_DUPLICATE", `duplicate terminalTitle: ${terminalTitle}`, "use unique terminal titles");
    names.add(name);
    titles.add(terminalTitle);
    return {
      name,
      agent: requireString(role.agent, `roles[${index}].agent`),
      command: requireString(role.command, `roles[${index}].command`),
      terminalTitle,
      session: role.session === "shared" ? "shared" : "dedicated",
      writeAccess: Boolean(role.writeAccess),
      responsibilities: Array.isArray(role.responsibilities) ? role.responsibilities : [],
    };
  });
  const permissions = config.permissions ?? {};
  if (permissions.writeModel !== "single-writer" || permissions.allowParallelWrites !== false) {
    throw policyError("E_POLICY_WRITE_MODEL", "v2 supports only single-writer worktrees", "set single-writer and disable parallel writes");
  }
  const defaultWriteRole = permissions.defaultWriteRole;
  if (defaultWriteRole !== null && defaultWriteRole !== undefined) {
    const role = roles.find((candidate) => candidate.name === defaultWriteRole);
    if (!role || !role.writeAccess) {
      throw inputError("E_INPUT_DEFAULT_WRITE_ROLE", "defaultWriteRole must reference a writable role", "select a role with writeAccess=true");
    }
  }
  return {
    valid: true,
    config: {
      version: 2,
      coordinator: { mode: "current-session" },
      defaults: { ...DEFAULTS, ...(config.defaults ?? {}) },
      permissions: { writeModel: "single-writer", allowParallelWrites: false, defaultWriteRole: defaultWriteRole ?? null },
      roles,
    },
  };
}

export function validateWriteScope(scope) {
  assertKnownKeys(scope, WRITE_SCOPE_FIELDS, "writeScope");
  if (!scope || typeof scope !== "object" || !Array.isArray(scope.allowedPaths) || scope.allowedPaths.length === 0) {
    throw inputError("E_INPUT_WRITE_SCOPE", "writeScope.allowedPaths must be non-empty", "provide repository-relative allowed paths");
  }
  const allowedPaths = scope.allowedPaths.map((pattern) => {
    if (typeof pattern !== "string" || pattern.trim() === "" || pattern.startsWith("/") || pattern.split("/").includes("..")) {
      throw inputError("E_INPUT_WRITE_SCOPE_PATH", `invalid allowed path: ${String(pattern)}`, "use a repository-relative path pattern");
    }
    if (HARD_FORBIDDEN_PATHS.some((forbidden) => globMatches(pattern, forbidden) || globMatches(forbidden, pattern)) || [".git", ".orchestrater", ".agents"].includes(pattern)) {
      throw policyError("E_POLICY_FORBIDDEN_PATH", `write scope includes protected path: ${pattern}`, "remove protected paths from writeScope");
    }
    return pattern;
  });
  if (!scope.verification || typeof scope.verification !== "object") {
    throw inputError("E_INPUT_VERIFICATION", "writeScope.verification is required", "provide command and args");
  }
  assertKnownKeys(scope.verification, VERIFICATION_FIELDS, "writeScope.verification");
  const command = requireString(scope.verification.command, "writeScope.verification.command");
  const args = scope.verification.args;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw inputError("E_INPUT_VERIFICATION_ARGS", "writeScope.verification.args must be an array of strings", "provide command arguments as JSON strings");
  }
  if (args.some((arg) => /(?:^--?(?:token|secret|password|api[-_]?key)(?:=|$)|\b(?:token|secret|password|api[-_]?key)\s*=)/i.test(arg))) {
    throw inputError("E_INPUT_VERIFICATION_SECRET", "verification arguments must not contain credentials", "inject credentials through the runtime environment instead");
  }
  return { allowedPaths, verification: { command, args } };
}

export function isTrustedCommand(command) {
  return TRUSTED_COMMANDS.has(command);
}

export function globMatches(path, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

export function pathAllowed(path, allowedPaths) {
  return allowedPaths.some((pattern) => globMatches(path, pattern));
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

export function configBackupPath(path) {
  return join(dirname(path), "config.v1.bak");
}

export async function writeConfig(path, config, { createOnly = false, backup = false } = {}) {
  await mkdir(dirname(path), { recursive: true });
  if (createOnly && await exists(path)) {
    throw policyError("E_POLICY_CONFIG_EXISTS", `Config already exists: ${path}`, "validate or migrate the existing config instead of overwriting it");
  }
  if (backup && await exists(path)) await copyFile(path, configBackupPath(path));
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
