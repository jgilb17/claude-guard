import { spawnSync } from 'node:child_process'
const H = process.env.HOME
const G = H + '/projects/claude-guard/guard.mjs', S = H + '/projects/claude-guard/sql-guard.mjs'
const cases = [
  ['select 1', 0, 'allow'],
  ["select 'drop' as word", 0, 'allow'],
  ['select 1 -- drop table x', 0, 'allow'],
  ["select * from t where note = 'please delete this'", 0, 'allow'],
  ['select dropdown, owner, comment from t', 0, 'allow'],
  ['select $tag$ drop table x $tag$ as w', 0, 'allow'],
  ['update t set a = 1 where id = 2', 0, 'ask'],
  ['insert into t values (1)', 0, 'ask'],
  ['drop table x', 2, 'ask'],
  ['DELETE FROM t', 2, 'ask'],
  ['create table t (a int)', 2, 'ask'],
  ["DO $$ BEGIN EXECUTE 'dr' || 'op table x'; END $$", 2, 'ask'],
  ["select 'a\\' ; drop table x; select '", 2, 'ask'],
  ["select E'\\'' ; drop table x; select '", 2, 'ask'],
  ["select 'x' /* note */ ; truncate t", 2, 'ask']
]
let fails = 0
for (const tool of ['mcp__Supabase__execute_sql', 'mcp__claude_ai_Supabase__execute_sql']) {
  for (const [query, gExp, sExp] of cases) {
    const inp = JSON.stringify({ hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: tool, tool_input: { query } })
    const g = spawnSync('node', [G], { input: inp }).status
    let s = 'error'
    try { s = JSON.parse(spawnSync('node', [S], { input: inp }).stdout.toString()).hookSpecificOutput.permissionDecision } catch {}
    const ok = g === gExp && s === sExp
    if (!ok) fails++
    console.log((ok ? 'PASS ' : 'FAIL ') + 'guard=' + g + ' sql=' + s + '  ' + query)
  }
}
const ls = spawnSync('node', [G], { input: JSON.stringify({ hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'ls' } }) }).status
if (ls !== 0) { fails++; console.log('FAIL bash ls sanity, guard=' + ls) } else console.log('PASS bash ls sanity')
console.log(fails ? '\n' + fails + ' FAILED. Roll back with: cp ~/guard-backups/guard.mjs.pre-sqlfix ~/projects/claude-guard/guard.mjs && cp ~/guard-backups/sql-guard.mjs.pre-sqlfix ~/projects/claude-guard/sql-guard.mjs' : '\nALL PASS')
