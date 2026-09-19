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

  /* TIER TWO — autonomous (or degraded) only; attended sessions prompt via settings rules.
     Checked per shell segment. Quoted prose in git commit/tag, gh pr/issue/release and grep/rg
     is ignored, except double-quoted text containing $( or a backtick, which the shell runs. */
  if (AUTONOMOUS) {
    const segs = shellSegments(scan.replace(/\d*>&\d+/g, ' '))
    const QUIET = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:git\s+(?:commit|tag)|gh\s+(?:pr|issue|release)|grep|rg)\b/
    const clean = segs.map(s => QUIET.test(s) ? s.replace(/'[^']*'|"(?:[^"\\$`]|\\.|\$(?!\())*"/g, ' ') : s)
    for (const seg of clean) {
      if (!/\bgit\s+push\b/i.test(seg)) continue
      const p = seg.replace(/\s+\d*>>?\s*\S+/g, '').trim()
      const forced = /\s(--force\b|-f\b|--force-with-lease\b|--all\b|--mirror\b|--delete\b)/i.test(p)
      const named = /^git\s+push\s+(?:-u\s+|--set-upstream\s+)?[A-Za-z0-9._-]+\s+claude\/[A-Za-z0-9._\/-]+(?::claude\/[A-Za-z0-9._\/-]+)?$/i.test(p)
      if (forced || !named) deny('a push in an autonomous session is limited to an explicit claude/* feature branch; a deploy-branch or force push must be attended')
    }
    const body = clean.join('\n')
    if (/\brm\b/i.test(body)) deny('rm in an autonomous session is blocked')
    if (/\bsudo\b/i.test(body)) deny('sudo in an autonomous session is blocked')
    if (/\b(drop|truncate|delete)\b/i.test(body)) deny('drop, truncate or delete in an autonomous session is blocked')
  }
}

function shellSegments (s) {
  const out = []
  let cur = '', q = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      cur += c
      if (c === '\\' && q === '"') { cur += s[++i] || ''; continue }
      if (c === q) q = null
      continue
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue }
    if (c === ';' || c === '\n' || c === '|' || c === '&') { if (cur.trim()) out.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
}

function sqlCode (q, bs) {
  let out = '', i = 0
  const n = q.length
  while (i < n) {
    const c = q[i], d = q[i + 1]
    if (c === '-' && d === '-') { const j = q.indexOf('\n', i); i = j < 0 ? n : j; out += ' '; continue }
    if (c === '/' && d === '*') { const j = q.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; out += ' '; continue }
    if (c === "'" || c === '"') {
      i++
      while (i < n) {
        if (bs && c === "'" && q[i] === '\\') { i += 2; continue }
        if (q[i] === c) { if (q[i + 1] === c) { i += 2; continue } i++; break }
        i++
      }
      out += ' '
      continue
    }
    if (c === '$' && !/[A-Za-z0-9_$]/.test(q[i - 1] || '')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(q.slice(i))
      if (m) { const j = q.indexOf(m[0], i + m[0].length); i = j < 0 ? n : j + m[0].length; out += ' '; continue }
    }
    out += c
    i++
  }
  return out
}

if (/^mcp__(claude_ai_)?Supabase__execute_sql$/.test(tool)) {
  const q = String(input.tool_input?.query ?? '')
  const blocked = /\b(drop|truncate|delete|alter|grant|revoke|create|do|execute|call|copy)\b/i
  for (const bs of [false, true]) {
    const m = sqlCode(q, bs).match(blocked)
    if (m) deny('SQL contains ' + m[0].toLowerCase() + '; DDL, deletes and dynamic SQL are blocked in execute_sql, use apply_migration or run it yourself')
  }
}

process.exit(0)
