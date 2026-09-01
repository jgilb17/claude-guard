#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

/* PreToolUse guard, two-tier DENY design (14 August 2026).

   WHY DENY AND NOT ASK. The earlier version returned permissionDecision "ask".
   That is not a supported blocking decision: only "deny" stops a tool call, and
   in an autonomous cloud or scheduled session there is no human to answer an
   "ask", so the harness proceeded. The guard was decorative exactly where it
   mattered most. "deny" is the only thing that blocks in every mode.

   TIER ONE, denied in EVERY mode: reading a .env, touching the guardrail files,
   the GitHub write tools, and DDL inside execute_sql. These must never happen
   unattended; on the Mac you run them yourself, which the guard never touches.

   TIER TWO, denied only in AUTONOMOUS modes: git push, rm, sudo, and bash-level
   drop/truncate/delete. In an attended "default"-mode session these keep
   prompting through the settings ask rules so you approve them yourself; in
   cloud and scheduled runs they are denied outright, which is fail-closed.

   permission_mode tells attended from autonomous. Anything that is not
   "default" (and not "plan") is treated as autonomous. A degraded session (the
   canonical failed to load and the seed is running) is treated as autonomous
   too, so it is stricter, not weaker, when we are least sure of it. */

let raw = ''
for await (const chunk of process.stdin) raw += chunk
let input
try { input = JSON.parse(raw) } catch { process.exit(0) }

const deny = reason => {
  /* Exit code 2 is the documented UNCONDITIONAL PreToolUse block: it stops the
     tool call whether or not JSON is printed, and even a permissionDecision of
     "allow" cannot override it. permissionDecision:"deny" was not trusted here
     precisely because "ask" taught us an autonomous mode can ignore a soft
     decision. The reason goes to stderr, which the model reads. */
  process.stderr.write('BLOCKED by guard: ' + reason + '\n')
  process.exit(2)
}

const tool = String(input.tool_name || '')
const mode = String(input.permission_mode || 'default')
const degraded = existsSync(homedir() + '/.claude/.guard-degraded')
const AUTONOMOUS = (mode !== 'default' && mode !== 'plan') || degraded

/* TIER ONE — every mode. */
const GH_WRITE = new Set([
  'mcp__github__push_files',
  'mcp__github__create_or_update_file',
  'mcp__github__delete_file',
  'mcp__github__merge_pull_request'
])
if (GH_WRITE.has(tool)) deny('a GitHub write tool commits over the API with no git command in sight; blocked in all modes, run it yourself if you mean it')

if (tool === 'Bash') {
  const cmd = String(input.tool_input?.command ?? '')

  /* A heredoc that feeds a FILE WRITE is content, not commands. Only cat and
     tee with a redirect qualify, so psql <<'SQL' ... SQL is still inspected.
     Without this, writing a check suite whose assertions mention drop or
     delete is denied, which blocks the honest path and nothing else. */
  const scan = cmd.replace(
    /(^|\n)\s*(?:cat|tee)[^\n<]*>[^\n<]*<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?[\s\S]*?\n\2\b/g,
    '$1<file body removed>'
  )

  /* process.env is JavaScript, not a credentials file. Everything else that
     says .env is still denied, on the raw command. */
  const envText = cmd.replace(/process\.env\b/g, 'process_env')
  if (/\.env\b/i.test(envText)) deny('command touches a .env file; credentials never enter the transcript')

  if (/\.claude\/settings|guard\.mjs|obsidian-recall-safe\.sh|obsidian-session-end\.sh/i.test(cmd)) deny('command touches guardrail or authority-bearing hook files')

  /* TIER TWO — autonomous (or degraded) only; attended sessions prompt via settings rules. */
  if (AUTONOMOUS) {
    if (/\bgit\s+push\b/i.test(scan)) {
      const forced = /\s(--force\b|-f\b|--force-with-lease\b|--all\b|--mirror\b|--delete\b)/i.test(scan)
      const named = /\bgit\s+push\s+(?:-u\s+|--set-upstream\s+)?[A-Za-z0-9._-]+\s+claude\/[A-Za-z0-9._\/-]+(?::claude\/[A-Za-z0-9._\/-]+)?\s*$/i.test(scan)
      if (forced || !named) deny('a push in an autonomous session is limited to an explicit claude/* feature branch; a deploy-branch or force push must be attended')
    }
    if (/\brm\b/i.test(scan)) deny('rm in an autonomous session is blocked')
    if (/\bsudo\b/i.test(scan)) deny('sudo in an autonomous session is blocked')
    if (/\b(drop|truncate|delete)\b/i.test(scan)) deny('drop, truncate or delete in an autonomous session is blocked')
  }
}

if (tool === 'mcp__Supabase__execute_sql') {
  const q = String(input.tool_input?.query ?? '')
  if (/\b(drop|truncate|delete|alter|grant)\b/i.test(q)) deny('SQL contains drop, truncate, delete, alter or grant')
}

process.exit(0)
