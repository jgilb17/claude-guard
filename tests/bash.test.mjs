import { spawnSync } from 'node:child_process'
const G = process.env.HOME + '/projects/claude-guard/guard.mjs'
const cases = [
  ['git push -u origin claude/x', 'auto', 0],
  ['git push -u origin claude/x 2>&1', 'auto', 0],
  ['cd ~/projects/apek-hub && git push -u origin claude/x', 'auto', 0],
  ['git push origin main', 'auto', 2],
  ['git push --force origin claude/x', 'auto', 2],
  ['git push -u origin claude/x && git push origin main', 'auto', 2],
  ["gh pr create --title 'Guard notes' --body 'blocks drop, truncate and delete'", 'auto', 0],
  ['gh pr create --body "blocks drop and delete"', 'auto', 0],
  ['gh pr create --body "$(rm -rf ~/x)"', 'auto', 2],
  ['git commit -m "delete stale rows from docs"', 'auto', 0],
  ['grep -rn "delete" src', 'auto', 0],
  ['rm -rf build', 'auto', 2],
  ['psql -c "drop table x"', 'auto', 2],
  ['echo "rm -rf /"', 'auto', 2],
  ['sudo ls', 'auto', 2],
  ['ls', 'auto', 0],
  ['cat .env', 'auto', 2],
  ['cat .env', 'default', 2],
  ['cat ./web/.env.local', 'default', 2],
  ['cat "$HOME/.env"', 'default', 2],
  ['source .env && npm start', 'default', 2],
  ['grep KEY .env.production', 'default', 2],
  ['cat prod.env', 'default', 2],
  ['cp config/staging.env.bak /tmp/x', 'default', 2],
  ['echo $(cat secrets.env)', 'default', 2],
  ['node app.js <.env', 'default', 2],
  ['ls -la .env*', 'default', 2],
  ['DOTENV=.env node x.js', 'default', 2],
  ["node -e 'console.log(process.env.HOME)'", 'default', 0],
  ["node -e 'const s={};s.env={...(s.env||{}),A:1}'", 'default', 0],
  ["node -e 'cfg.env.FOO'", 'default', 0],
  ["node -e 'run(opts.env)'", 'default', 0],
  ['grep -rn "import.meta.env" src', 'default', 0],
  ['ls .envrc', 'default', 0],
  ['cat .ENV', 'default', 2],
  ['cat app/.env', 'auto', 2],
  ['cat .env', 'bypassPermissions', 2],
  ['git push origin main', 'default', 0],
  ['rm -rf build', 'default', 0]
]
let fails = 0
for (const [command, mode, exp] of cases) {
  const r = spawnSync('node', [G], { input: JSON.stringify({ hook_event_name: 'PreToolUse', permission_mode: mode, tool_name: 'Bash', tool_input: { command } }) }).status
  const ok = r === exp
  if (!ok) fails++
  console.log((ok ? 'PASS ' : 'FAIL ') + 'exit=' + r + ' want=' + exp + ' [' + mode + ']  ' + command)
}
console.log(fails ? '\n' + fails + ' FAILED. Roll back with: cp ~/guard-backups/guard.mjs.pre-bashfix ~/projects/claude-guard/guard.mjs' : '\nBASH ALL PASS')
