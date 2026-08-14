#!/usr/bin/env node
/* PreToolUse guard. Settings rules match prefixes; these rules match anywhere
   in the string, which is the half settings cannot do. Every hit becomes an
   ask, never a silent deny, so the person decides and the work continues.

   Two copies exist on purpose: ~/.claude/hooks/guard.mjs guards every project
   on the machine, and each repo carries its own so a fresh clone on a machine
   without the global file is still guarded. Keep them identical.

   The guardrail protects the three files that ARE the guardrail, settings.json,
   settings.local.json and this file, plus, at Joshua's instruction on 14
   August 2026, the two Obsidian hooks that run with his authority on every
   prompt and every session end, obsidian-recall-safe.sh and
   obsidian-session-end.sh. Deliberately NOT the whole .claude directory: the
   second brain lives in .claude/skills and sessions are meant to edit it
   freely. Matching basenames anywhere in the command catches rewrites,
   renames and the cd-then-redirect trick.

   The GitHub write tools are guarded too, added 14 August 2026: push_files,
   create_or_update_file, delete_file and merge_pull_request commit over the
   API with no git command in sight, so a commit to a deploy branch would
   reach production without ever tripping the git push rule. They ask the same
   way a push does.

   Word boundaries are deliberate: "containing rm" is read as the word rm, or
   confirm, format and perform would trip it in every session; same for the
   SQL words, so deleted_at in a select stays silent. */
let raw = ''
for await (const chunk of process.stdin) raw += chunk
let input
try { input = JSON.parse(raw) } catch { process.exit(0) }

const ask = reason => {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason
    }
  }))
  process.exit(0)
}

const tool = String(input.tool_name || '')

const GH_WRITE = new Set([
  'mcp__github__push_files',
  'mcp__github__create_or_update_file',
  'mcp__github__delete_file',
  'mcp__github__merge_pull_request'
])
if (GH_WRITE.has(tool)) ask('a GitHub write tool commits over the API with no git command in sight; a commit to a deploy branch is production')

if (tool === 'Bash') {
  const cmd = String(input.tool_input?.command ?? '')
  if (/\bgit\s+push\b/i.test(cmd)) ask('git push anywhere in a command asks first; a push to a deploy branch is production')
  if (/\brm\b/i.test(cmd)) ask('command contains rm')
  if (/\b(drop|truncate|delete)\b/i.test(cmd)) ask('command contains drop, truncate or delete')
  if (/\.env\b/i.test(cmd)) ask('command touches a .env file; credentials never enter the transcript')
  if (/\.claude\/settings|guard\.mjs|obsidian-recall-safe\.sh|obsidian-session-end\.sh/i.test(cmd)) ask('command touches guardrail or authority-bearing hook files, which ask first')
}

if (tool === 'mcp__Supabase__execute_sql') {
  const q = String(input.tool_input?.query ?? '')
  if (/\b(drop|truncate|delete|alter|grant)\b/i.test(q)) ask('SQL contains drop, truncate, delete, alter or grant')
}

process.exit(0)
