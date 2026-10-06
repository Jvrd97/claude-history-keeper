/** A transcript as Claude Code writes it: every row kind the vault meets, in the order a session writes them. */

export const SESSION_ID = '61f2df73-9117-4789-880b-0cd74a665b25'
export const CWD = '/work/app'
export const STARTED = '2026-10-06T12:30:05.000Z'

const rows: unknown[] = [
  { type: 'queue-operation', operation: 'enqueue', timestamp: STARTED, sessionId: SESSION_ID, content: 'fix the login test' },
  { type: 'attachment', timestamp: '2026-10-06T12:30:05.100Z', attachment: { type: 'hook_success' }, cwd: CWD },
  {
    type: 'user',
    uuid: 'u1',
    timestamp: '2026-10-06T12:30:06.000Z',
    cwd: CWD,
    message: { role: 'user', content: 'fix the login test\nit fails on CI' },
  },
  {
    type: 'user',
    uuid: 'meta1',
    isMeta: true,
    timestamp: '2026-10-06T12:30:06.100Z',
    message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: hidden' }] },
  },
  {
    type: 'assistant',
    uuid: 'a0',
    timestamp: '2026-10-06T12:30:08.000Z',
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret plan', signature: 'x' }] },
  },
  {
    type: 'assistant',
    uuid: 'a1',
    timestamp: '2026-10-06T12:30:09.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Let me look at the test first.' }] },
  },
  {
    type: 'assistant',
    uuid: 'a2',
    timestamp: '2026-10-06T12:30:10.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'login.test.ts' } }] },
  },
  {
    type: 'user',
    uuid: 'r1',
    timestamp: '2026-10-06T12:30:11.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'TOOL OUTPUT NOT IN MARKDOWN' }] },
  },
  {
    type: 'assistant',
    uuid: 'a3',
    timestamp: '2026-10-06T12:31:00.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] },
  },
  {
    type: 'user',
    uuid: 'side1',
    isSidechain: true,
    timestamp: '2026-10-06T12:31:01.000Z',
    message: { role: 'user', content: 'SUBAGENT PROMPT' },
  },
  {
    type: 'assistant',
    uuid: 'a4',
    timestamp: '2026-10-06T12:32:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'The timeout was too short; raised it to 10 s.' }] },
  },
  { type: 'custom-title', customTitle: 'Flaky login test', sessionId: SESSION_ID },
  {
    type: 'user',
    uuid: 'c1',
    timestamp: '2026-10-06T12:40:00.000Z',
    message: { role: 'user', content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep the CI notes</command-args>' },
  },
  {
    type: 'user',
    uuid: 'c2',
    timestamp: '2026-10-06T12:40:01.000Z',
    message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' },
  },
  {
    type: 'user',
    uuid: 'sum1',
    isCompactSummary: true,
    timestamp: '2026-10-06T12:40:02.000Z',
    message: { role: 'user', content: 'SUMMARY OF EARLIER' },
  },
  {
    type: 'user',
    uuid: 'u2',
    timestamp: '2026-10-06T12:45:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'thanks, now commit it <system-reminder>REMINDER</system-reminder>' }] },
  },
]

/** One line per row, with a torn last line as a transcript has while the engine is still writing. */
export const TRANSCRIPT = `${rows.map(row => JSON.stringify(row)).join('\n')}\n{"type":"assistant","uuid":"a5","mess`

export const ONLY_COMMANDS = `${JSON.stringify({
  type: 'user',
  uuid: 'h1',
  timestamp: STARTED,
  message: { role: 'user', content: '<command-name>/history</command-name>\n<command-args>ok</command-args>' },
})}\n`
