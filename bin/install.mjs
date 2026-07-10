#!/usr/bin/env node
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_NAME = "orchestrater";
const HOSTS = new Set(["claude", "codex"]);
const args = process.argv.slice(2);
const hostIndex = args.indexOf("--host");
const host = hostIndex >= 0 ? args[hostIndex + 1] : undefined;
const force = args.includes("--force");

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: npx orchestrater-skill --host claude|codex [--force]");
  process.exit(2);
}

if (!HOSTS.has(host)) usage("--host is required and must be claude or codex");
if (hostIndex >= 0 && args[hostIndex + 1]?.startsWith("--")) usage("--host needs a value");

const destination = process.env.ORCHESTRATER_INSTALL_DIR ?? join(
  homedir(),
  host === "claude" ? ".claude" : ".codex",
  "skills",
  SKILL_NAME,
);
const files = ["SKILL.md", "README.md", "LICENSE", "src", "agents"];

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function main() {
  if (await exists(destination)) {
    if (!force) usage(`Destination exists: ${destination}. Re-run with --force to replace it.`);
    await rm(destination, { recursive: true, force: true });
  }
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    const source = join(PKG_ROOT, file);
    if (!(await exists(source))) throw new Error(`missing packaged file: ${file}`);
    await cp(source, join(destination, file), { recursive: true, errorOnExist: true });
  }
  console.log(`orchestrater ${host} skill installed → ${destination}`);
  console.log("Invoke it with: /orchestrater <goal>");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
