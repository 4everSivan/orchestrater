#!/usr/bin/env node
import { access, cp, lstat, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_NAME = "orchestrater";
const HOSTS = new Set(["claude", "codex"]);
const args = process.argv.slice(2);
const hostIndex = args.indexOf("--host");
const host = hostIndex >= 0 ? args[hostIndex + 1] : undefined;
const force = args.includes("--force");
const allowCustomDestination = args.includes("--allow-custom-destination");

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: npx orchestrater-skill --host claude|codex [--force] [--allow-custom-destination]");
  process.exit(2);
}

if (!HOSTS.has(host)) usage("--host is required and must be claude or codex");
if (hostIndex >= 0 && args[hostIndex + 1]?.startsWith("--")) usage("--host needs a value");

const standardDestination = join(
  homedir(),
  host === "claude" ? ".claude" : ".codex",
  "skills",
  SKILL_NAME,
);
const customDestination = process.env.ORCHESTRATER_SKILL_DIR;
if (customDestination && !allowCustomDestination) usage("ORCHESTRATER_SKILL_DIR requires --allow-custom-destination");
if (allowCustomDestination && !customDestination) usage("--allow-custom-destination requires ORCHESTRATER_SKILL_DIR");
const destination = resolve(customDestination ?? standardDestination);
const files = ["SKILL.md", "README.md", "LICENSE", "src", "agents"];

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function assertNotSymlink(path) {
  try {
    if ((await lstat(path)).isSymbolicLink()) usage(`Refusing symlink destination: ${path}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function main() {
  await assertNotSymlink(destination);
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
