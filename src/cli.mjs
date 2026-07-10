#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig, readConfig, validateConfig, validateWriteScope, writeConfig } from "./config.mjs";
import { OrchestraterError, inputError, policyError } from "./errors.mjs";
import { captureEvidence, requireWriteRole, verifyEvidence } from "./evidence.mjs";
import { requireClean } from "./git.mjs";
import { listItems, OrcaClient } from "./orca.mjs";
import { assertCreatable, resolveTerminal } from "./terminal.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) { positionals.push(item); continue; }
    const name = item.slice(2);
    if (name === "confirm-command" || name === "write") { flags[name] = true; continue; }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw inputError("E_INPUT_FLAG", `Missing value for --${name}`, "provide a flag value");
    flags[name] = value;
    index += 1;
  }
  return { positionals, flags };
}

function jsonFlag(value, flag) {
  try { return JSON.parse(value); } catch { throw inputError("E_INPUT_JSON", `Invalid JSON for --${flag}`, `provide valid JSON for --${flag}`); }
}

function configPath(flags) { return resolve(process.cwd(), flags.config ?? ".orchestrater/config.json"); }

async function validConfig(flags) {
  const result = validateConfig(await readConfig(configPath(flags)));
  if (!result.valid) throw policyError("E_POLICY_CONFIG_MIGRATION", "config v1 requires explicit migration", "run config migrate --write after review");
  return result.config;
}

async function preflight(flags) {
  const taskClass = flags["task-class"];
  if (taskClass !== "read" && taskClass !== "write") throw inputError("E_INPUT_TASK_CLASS", "--task-class must be read or write", "choose read or write");
  const config = await validConfig(flags);
  const role = config.roles.find((candidate) => candidate.name === flags.role);
  if (!role) throw inputError("E_INPUT_ROLE", `Unknown role: ${flags.role}`, "select a configured role");
  const client = new OrcaClient();
  await client.status();
  let writeScope;
  if (taskClass === "write") {
    writeScope = validateWriteScope(jsonFlag(flags["write-scope"], "write-scope"));
    requireWriteRole(config, role.name);
    await requireClean(process.cwd());
    const tasks = listItems(await client.taskList());
    const activeWriter = tasks.find((task) => task.status === "dispatched" && task.result?.evidence?.writeScope);
    if (activeWriter) throw policyError("E_POLICY_SINGLE_WRITER", "another write task is already dispatched", "wait for it to complete or resolve its gate");
  }
  return { ok: true, configVersion: 2, taskClass, role: role.name, writeScope };
}

async function terminal(flags, action) {
  const config = await validConfig(flags);
  const role = config.roles.find((candidate) => candidate.name === flags.role);
  if (!role) throw inputError("E_INPUT_ROLE", `Unknown role: ${flags.role}`, "select a configured role");
  const client = new OrcaClient();
  await client.status();
  if (action === "resolve") return { ok: true, terminal: resolveTerminal(role, await client.terminalList()) };
  assertCreatable(role, flags["confirm-command"] === true);
  const created = await client.terminalCreate(role.terminalTitle, role.command);
  return { ok: true, terminal: { handle: created.handle ?? created.id, title: role.terminalTitle, created: true } };
}

async function evidence(flags, action) {
  const client = new OrcaClient();
  await client.status();
  if (!flags.task) throw inputError("E_INPUT_TASK", "--task is required", "provide the Orca task id");
  if (action === "capture") return { ok: true, result: await captureEvidence({ client, taskId: flags.task, scope: jsonFlag(flags["write-scope"], "write-scope"), cwd: process.cwd() }) };
  return { ok: true, result: await verifyEvidence({ client, taskId: flags.task, cwd: process.cwd() }) };
}

async function config(flags, action) {
  if (action === "init") {
    const initial = defaultConfig();
    if (!flags.write) return { ok: true, config: initial, written: false };
    await writeConfig(configPath(flags), initial);
    return { ok: true, config: initial, written: true };
  }
  const original = await readConfig(configPath(flags));
  const result = validateConfig(original);
  if (action === "validate") return { ok: true, ...result };
  if (original.version !== 1) throw inputError("E_INPUT_MIGRATION", "only config v1 can be migrated", "validate the existing v2 config instead");
  if (!flags.write) return { ok: true, migration: result.migration, written: false };
  await writeConfig(configPath(flags), result.migration);
  return { ok: true, migration: result.migration, written: true };
}

export async function execute(argv) {
  const { positionals, flags } = parseArgs(argv);
  const [group, action] = positionals;
  if (group === "config" && ["validate", "migrate", "init"].includes(action)) return config(flags, action);
  if (group === "preflight") return preflight(flags);
  if (group === "terminal" && ["resolve", "create"].includes(action)) return terminal(flags, action);
  if (group === "evidence" && ["capture", "verify"].includes(action)) return evidence(flags, action);
  throw inputError("E_INPUT_COMMAND", "Unknown command", "use config, preflight, terminal, or evidence commands");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  execute(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      if (error instanceof OrchestraterError) {
        process.stdout.write(`${JSON.stringify(error.toJSON())}\n`);
        process.exitCode = error.exitCode;
        return;
      }
      process.stdout.write(`${JSON.stringify({ ok: false, code: "E_RUNTIME_UNEXPECTED", class: "blocker", message: error.message, remediation: "inspect stderr and retry" })}\n`);
      process.exitCode = 5;
    },
  );
}

export const packageRoot = ROOT;
