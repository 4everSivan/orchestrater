#!/usr/bin/env node
// One-shot installer for the orchestrater skill. Run via `npx orchestrater-skill`.
// Copies the skill files into a compatible skill directory; override the
// destination with ORCHESTRATER_SKILL_DIR (defaults to ~/.claude/skills/orchestrater).
//
// This is a package-distribution tool, NOT a script the skill runs at runtime.
// The skill itself stays script-free; orchestration is native Orca + the agent.

import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_NAME = "orchestrater";
const DEST =
  process.env.ORCHESTRATER_SKILL_DIR ??
  join(homedir(), ".claude", "skills", SKILL_NAME);

// Files that make the skill functional. .orchestrater/config.json is NOT shipped:
// it is created per project on first /orchestrater invocation (6-question onboarding).
const FILES = ["SKILL.md", "README.md", "LICENSE", "agents/openai.yaml"];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(join(DEST, "agents"), { recursive: true });
  for (const file of FILES) {
    const src = join(PKG_ROOT, file);
    if (!(await exists(src))) {
      console.error(`missing packaged file: ${file}`);
      process.exit(1);
    }
    await copyFile(src, join(DEST, file));
  }
  console.log(`orchestrater skill installed → ${DEST}`);
  console.log("Invoke it with: /orchestrater <goal>");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
