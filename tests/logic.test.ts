import { describe, expect, test } from 'claude-code/testing'

import {
  byteLength,
  clockLabel,
  expandHome,
  formatSize,
  hasConversation,
  headerOf,
  isStamped,
  isVaultDue,
  listText,
  localDate,
  localTime,
  parseMode,
  parseTranscript,
  parseVaultName,
  renderMarkdown,
  search,
  slugOf,
  snippetOf,
  stampsOf,
  tildeOf,
  vaultBase,
  wholeLines,
} from '../hooks/logic'
import { ONLY_COMMANDS, SESSION_ID, TRANSCRIPT } from './fixtures/transcript'

const MIN = 60_000
const UTC = 0
const BERLIN = 120
const NOW = Date.parse('2026-10-06T12:00:00Z')

describe('names', () => {
  test('a project path becomes a folder name the way Claude Code spells its own', () => {
    expect(slugOf('/Users/me/my.app')).toBe('-Users-me-my-app')
    expect(slugOf('C:\\work\\app')).toBe('C--work-app')
  })

  test('a very long path is cut and keeps a hash, so two long paths stay apart', () => {
    const a = slugOf(`/${'x'.repeat(300)}/a`)
    const b = slugOf(`/${'x'.repeat(300)}/b`)

    expect(a.length).toBeLessThan(220)
    expect(a).not.toBe(b)
  })

  test('a vaulted file is named by its local start date and session id, and parses back', () => {
    const base = vaultBase('2026-10-06', SESSION_ID)

    expect(base).toBe(`2026-10-06_${SESSION_ID}`)
    expect(parseVaultName(`${base}.jsonl`)).toEqual({ date: '2026-10-06', sessionId: SESSION_ID, ext: 'jsonl' })
    expect(parseVaultName(`${base}.md`)?.ext).toBe('md')
    expect(parseVaultName('notes.txt')).toBeNull()
    expect(parseVaultName('.DS_Store')).toBeNull()
  })

  test('a session id cannot climb out of the folder', () => {
    expect(vaultBase('2026-10-06', '../../etc/passwd')).toBe('2026-10-06_.._.._etc_passwd')
  })

  test('~ expands to the home folder and folds back for display', () => {
    expect(expandHome('~/.claude/history-keeper', '/Users/me')).toBe('/Users/me/.claude/history-keeper')
    expect(expandHome('/srv/vault', '/Users/me')).toBe('/srv/vault')
    expect(expandHome('~other/x', '/Users/me')).toBe('~other/x')
    expect(tildeOf('/Users/me/.claude/history-keeper/x', '/Users/me')).toBe('~/.claude/history-keeper/x')
    expect(tildeOf('/Users/meme/x', '/Users/me')).toBe('/Users/meme/x')
  })
})

describe('local time', () => {
  test('date and time follow the offset, across midnight', () => {
    const late = Date.parse('2026-10-06T23:30:00Z')

    expect(localDate(late, UTC)).toBe('2026-10-06')
    expect(localDate(late, BERLIN)).toBe('2026-10-07')
    expect(localTime(late, BERLIN)).toBe('01:30')
  })

  test('a row from today shows the time alone, an older one its date too', () => {
    expect(clockLabel(NOW - 5 * MIN, NOW, UTC)).toBe('11:55')
    expect(clockLabel(NOW - 24 * 60 * MIN, NOW, UTC)).toBe('10-05 12:00')
  })
})

describe('reading a transcript', () => {
  const transcript = parseTranscript(TRANSCRIPT)

  test('keeps prompts, replies and tool names; skips meta, thinking, tool results, sidechains and summaries', () => {
    expect(transcript.entries.map(entry => entry.uuid)).toEqual(['u1', 'a1', 'a2', 'a3', 'a4', 'c1', 'u2'])
    expect(JSON.stringify(transcript)).not.toContain('TOOL OUTPUT')
    expect(JSON.stringify(transcript)).not.toContain('SUBAGENT')
    expect(JSON.stringify(transcript)).not.toContain('SUMMARY')
    expect(JSON.stringify(transcript)).not.toContain('secret plan')
    expect(JSON.stringify(transcript)).not.toContain('Compacted')
  })

  test('a slash command reads as typed and reminders are dropped from a prompt', () => {
    const texts = transcript.entries.filter(entry => entry.kind === 'user').map(entry => entry.text)

    expect(texts).toEqual(['fix the login test\nit fails on CI', '/compact keep the CI notes', 'thanks, now commit it'])
  })

  test('picks up the start, the project and the last title; a torn last line is ignored', () => {
    expect(transcript.startedAt).toBe(Date.parse('2026-10-06T12:30:05.000Z'))
    expect(transcript.cwd).toBe('/work/app')
    expect(transcript.title).toBe('Flaky login test')
  })

  test('an empty or garbage file is an empty transcript', () => {
    expect(parseTranscript('').entries).toEqual([])
    expect(parseTranscript('not json\n[1,2]\nnull\n').entries).toEqual([])
  })

  test('a run of slash commands alone is not worth a copy', () => {
    expect(hasConversation(parseTranscript(ONLY_COMMANDS))).toBe(false)
    expect(hasConversation(transcript)).toBe(true)
  })

  test('stamps cover prompts, or every row in "all"', () => {
    expect(stampsOf(transcript, 'prompts').map(([uuid]) => uuid)).toEqual(['u1', 'c1', 'u2'])
    expect(stampsOf(transcript, 'all').length).toBe(7)
    expect(stampsOf(transcript, 'off')).toEqual([])
  })
})

describe('markdown', () => {
  const markdown = renderMarkdown(parseTranscript(TRANSCRIPT), SESSION_ID, UTC)

  test('has a header to find the session by', () => {
    expect(markdown.startsWith('# Flaky login test\n')).toBe(true)
    expect(markdown).toContain(`claude --resume ${SESSION_ID}`)
    expect(markdown).toContain('- Project: `/work/app`')
    expect(markdown).toContain('- Started: 2026-10-06 12:30')
    expect(headerOf(markdown)).toEqual({ title: 'Flaky login test', firstPrompt: 'fix the login test it fails on CI' })
  })

  test('each prompt and reply under its time, tool calls folded into one line', () => {
    expect(markdown).toContain('**12:30 · You**\n\nfix the login test\nit fails on CI')
    expect(markdown).toContain('**12:30 · Claude**\n\nLet me look at the test first.')
    expect(markdown).toContain('_12:30 · tools: Read, Bash_')
    expect(markdown).toContain('**12:32 · Claude**\n\nThe timeout was too short')
    expect(markdown).toContain('**12:40 · You**\n\n/compact keep the CI notes')
  })

  test('the header is set off from the conversation by a rule, not glued to the list', () => {
    expect(markdown).toContain('- First prompt: fix the login test it fails on CI\n\n---\n')
  })

  test('a session with no title is headed by its first prompt', () => {
    const untitled = renderMarkdown(parseTranscript(TRANSCRIPT.replace('"custom-title"', '"other"')), SESSION_ID, UTC)

    expect(untitled.split('\n')[0]).toBe('# fix the login test it fails on CI')
    expect(headerOf(untitled).title).toBeNull()
  })
})

describe('throttle', () => {
  test('the first copy of a session is due, the next waits the interval', () => {
    expect(isVaultDue(null, 's1', NOW, 5)).toBe(true)
    expect(isVaultDue({ sessionId: 's1', at: NOW }, 's1', NOW + 4 * MIN, 5)).toBe(false)
    expect(isVaultDue({ sessionId: 's1', at: NOW }, 's1', NOW + 5 * MIN, 5)).toBe(true)
  })

  test('a new session id is due at once, and 0 means every turn', () => {
    expect(isVaultDue({ sessionId: 's1', at: NOW }, 's2', NOW, 5)).toBe(true)
    expect(isVaultDue({ sessionId: 's1', at: NOW }, 's1', NOW, 0)).toBe(true)
  })
})

describe('which appended rows get a time', () => {
  const prompt = { door: 'prompt', type: 'user', isMeta: false, isSubagent: false }
  const reply = { door: 'response', type: 'assistant', isMeta: false, isSubagent: false }

  test('prompts by default, replies in "all", never meta, subagent or tool rows', () => {
    expect(isStamped('prompts', prompt)).toBe(true)
    expect(isStamped('prompts', reply)).toBe(false)
    expect(isStamped('all', reply)).toBe(true)
    expect(isStamped('all', { ...prompt, isMeta: true })).toBe(false)
    expect(isStamped('all', { ...prompt, isSubagent: true })).toBe(false)
    expect(isStamped('all', { door: 'tool-result', type: 'user', isMeta: false, isSubagent: false })).toBe(false)
    expect(isStamped('off', prompt)).toBe(false)
  })

  test('an unknown setting falls back to prompts', () => {
    expect(parseMode('all')).toBe('all')
    expect(parseMode('off')).toBe('off')
    expect(parseMode('sometimes')).toBe('prompts')
    expect(parseMode(undefined)).toBe('prompts')
  })
})

describe('search', () => {
  const doc = (sessionId: string, mtimeMs: number, body: string) => ({
    date: '2026-10-06',
    sessionId,
    mtimeMs,
    markdown: `# ${body}\n\n- First prompt: ${body}\n\n---\n\n${body}\n`,
  })

  test('most matches first, then newest; case-insensitive', () => {
    const hits = search(
      [doc('old', 1, 'Redis cache'), doc('new', 2, 'redis here'), doc('many', 0, 'REDIS and redis and Redis'), doc('none', 3, 'postgres')],
      'redis',
      10,
    )

    expect(hits.map(hit => hit.sessionId)).toEqual(['many', 'new', 'old'])
    expect(hits[0]?.count).toBe(3)
  })

  test('the header does not count, so a first prompt is not matched twice', () => {
    expect(search([doc('a', 0, 'kafka')], 'kafka', 10)[0]?.count).toBe(1)
  })

  test('a blank query finds nothing and the limit holds', () => {
    const docs = Array.from({ length: 15 }, (_, i) => doc(`s${i}`, i, 'same words'))

    expect(search(docs, '   ', 10)).toEqual([])
    expect(search(docs, 'words', 10).length).toBe(10)
  })

  test('a snippet centres the match and marks what it cut', () => {
    const line = `${'a'.repeat(200)} the needle is here ${'b'.repeat(200)}`
    const snippet = snippetOf(line, 'NEEDLE', 40)

    expect(snippet).toContain('needle')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippetOf('short line with needle', 'needle')).toBe('short line with needle')
  })
})

describe('formatting', () => {
  test('sizes read as a person says them', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(48 * 1024)).toBe('48 KB')
    expect(formatSize(5 * 1024 * 1024 + 1)).toBe('5.0 MB')
  })

  test('the list counts right and says how to get further', () => {
    const one = listText([{ date: '2026-10-06', sessionId: 's1', size: 2048, mtimeMs: 0, label: 'say ok' }], 1, '~/v')

    expect(one).toContain('1 vaulted session,')
    expect(one).toContain('2026-10-06  2 KB  s1  say ok')
    expect(listText([], 0, '~/v')).toContain('No vaulted sessions')
    expect(listText([{ date: '2026-10-06', sessionId: 's1', size: 1, mtimeMs: 0, label: null }], 30, '~/v')).toContain('1 of 30')
  })

  test('a piece cut mid-line keeps whole lines only, and bytes count UTF-8', () => {
    expect(wholeLines('{"a":1}\n{"b":2}\n{"c":')).toBe('{"a":1}\n{"b":2}\n')
    expect(wholeLines('no newline')).toBe('')
    expect(byteLength('ok')).toBe(2)
    expect(byteLength('ок')).toBe(4)
  })
})
