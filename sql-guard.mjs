let raw = ''
for await (const chunk of process.stdin) raw += chunk
let input
try { input = JSON.parse(raw) } catch { process.exit(0) }
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
const q = String(input?.tool_input?.query ?? '')
const writes = /\b(insert|update|merge|upsert|delete|drop|truncate|alter|grant|revoke|create|do|execute|call|copy)\b/i
const risky = [false, true].some(bs => writes.test(sqlCode(q, bs)))
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: risky ? 'ask' : 'allow', permissionDecisionReason: risky ? 'sql-guard: statement writes data or changes schema, needs approval' : 'sql-guard: read-only' } }))
process.exit(0)
