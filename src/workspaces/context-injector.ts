/**
 * Launcher-owned context injection, run after a template's bootstrap.sh and
 * before the initial commit. Replaces what the per-template bootstrap scripts
 * used to do via `_common.sh` helpers (`write_mcp_config`,
 * `compose_persona_claude_md`) plus the chat skill-copy stopgap — so the
 * launcher, not each script, owns *what* gets injected. Gated per template by
 * the manifest flags (`injectTools` / `injectPersona` / `bundledSkills`).
 *
 * Reproduces the old bash output byte-for-byte (the workspace-creation golden
 * spec asserts this) — the only behavioral change is that the launcher now
 * owns the files, not bash.
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { dataPath, defaultPath } from '@/core/paths.js';

import { writeWorkspaceFile } from './file-service.js';
import type { TemplateMeta } from './template-registry.js';

/**
 * Skills teaching the `alice*` + `traderhub` CLIs — injected into every
 * tool-bearing template (`injectTools` truthy). The launcher injects NO MCP into
 * workspaces at all (no `.mcp.json`, no Pi bridge); these skills are how the
 * agent learns the CLI surface that is now its ONLY path to OpenAlice's tools.
 */
const CLI_TOOLS_SKILLS = ['alice', 'alice-analysis', 'alice-uta', 'alice-workspace', 'traderhub'];

export async function injectWorkspaceContext(opts: {
  readonly template: TemplateMeta;
  readonly wsId: string;
  readonly dir: string;
}): Promise<void> {
  const { template, dir } = opts;

  if (template.injectPersona) {
    // One neutral instruction source (`<template>/instruction.md`), composed
    // with the persona, then written byte-identically to BOTH CLAUDE.md (Claude
    // Code's filename) and AGENTS.md (Codex's). The CLIs disagree on the
    // filename; we don't pick a side — we copy to each at injection. A template
    // that asks for persona injection but ships no instruction.md is a
    // misconfiguration — let the readFile throw so the create fails loudly
    // (matches the old `compose_persona_claude_md` exit 4).
    const persona = await resolvePersona();
    const instruction = await readFile(join(template.filesDir, 'instruction.md'), 'utf8');
    const composed = persona !== null ? `${persona}\n\n---\n\n${instruction}` : instruction;
    await writeWorkspaceFile(dir, 'CLAUDE.md', composed);
    await writeWorkspaceFile(dir, 'AGENTS.md', composed);
  }

  // Tool-bearing templates also get the per-CLI playbooks (alice / alice-uta /
  // alice-workspace / traderhub) so the agent knows the CLI surface — its ONLY
  // path to OpenAlice tools, since the launcher injects no MCP. De-duped
  // against anything the template already bundles.
  const skills = template.injectTools
    ? [...template.bundledSkills, ...CLI_TOOLS_SKILLS.filter((s) => !template.bundledSkills.includes(s))]
    : [...template.bundledSkills];
  if (skills.length > 0) {
    // Each agent CLI discovers skills from its own dir: Claude Code reads
    // `.claude/skills`, Codex reads `.agents/skills`, Pi reads `.pi/skills`.
    // (opencode reads `.claude/skills` + `.agents/skills` by default via its
    // Claude-Code compat, so the two below already cover it — no `.opencode`
    // copy needed unless OPENCODE_DISABLE_CLAUDE_CODE is ever set.)
    await mkdir(join(dir, '.claude/skills'), { recursive: true });
    await mkdir(join(dir, '.agents/skills'), { recursive: true });
    await mkdir(join(dir, '.pi/skills'), { recursive: true });
    for (const name of skills) {
      const src = defaultPath('skills', name);
      await cp(src, join(dir, '.claude/skills', name), { recursive: true });
      await cp(src, join(dir, '.agents/skills', name), { recursive: true });
      await cp(src, join(dir, '.pi/skills', name), { recursive: true });
    }
  }
}

/**
 * Live persona override (`data/brain/persona.md`) wins; else the shipped
 * default (`default/persona.default.md`); else none. Same precedence the
 * persona route and `main.ts` use.
 */
async function resolvePersona(): Promise<string | null> {
  const live = dataPath('brain', 'persona.md');
  if (existsSync(live)) return readFile(live, 'utf8');
  const fallback = defaultPath('persona.default.md');
  if (existsSync(fallback)) return readFile(fallback, 'utf8');
  return null;
}
