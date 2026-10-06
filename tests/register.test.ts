import type { Args, RenderElement, RenderInput, SessionStartInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { clockLabel, offsetAt } from '../hooks/logic'
import { CWD, ONLY_COMMANDS, SESSION_ID, TRANSCRIPT } from './fixtures/transcript'
import { TRANSCRIPTS, VAULT, worldOf } from './fixtures/world'

const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: CWD }
const NOW = Date.parse('2026-10-06T12:50:00Z')
const MIN = 60_000
const SOURCE = `${TRANSCRIPTS}/${SESSION_ID}.jsonl`
const BASE = `${VAULT}/2026-10-06_${SESSION_ID}`
const PRESENTATION = { isFullscreen: true, columns: 140 }

const TURN = { answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const
const END = { reason: 'prompt_input_exit', sessionId: SESSION_ID, resume: { id: SESSION_ID } } as const

const prompt = (uuid: string): Args<'session.append'> => ({
  message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'fix it' }] },
  door: 'prompt',
  origin: { kind: 'composer' },
  uuid,
})

const answer = (uuid: string): Args<'session.append'> => ({
  message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'done' }] },
  door: 'response',
  origin: { kind: 'model', model: 'claude' },
  uuid,
})

const row = (requestId: string, isExpanded = false): RenderInput<'UserMessage', 'terminal'> => ({
  component: 'UserMessage',
  surface: 'terminal',
  requestId,
  viewport: { columns: 120, rows: 40 },
  props: { text: 'fix it', origin: { kind: 'composer' }, isExpanded },
})

const reply = (requestId: string, isFirstOfReply = true): RenderInput<'AssistantMessage', 'terminal'> => ({
  component: 'AssistantMessage',
  surface: 'terminal',
  requestId,
  viewport: { columns: 120, rows: 40 },
  props: { text: 'done', isFirstOfReply },
})

/**
 * Appends a row as the engine does. The kit has no store beneath `session.append`: a test's own answer without `next`
 * is refused by the event's rule and `next` finds nothing, so the call rejects once the plugin's hook has run. The
 * plugin records the time before it calls `next`, which is what these tests read back through the drawing.
 */
const appended = async ($: { session: { append: (e: Args<'session.append'>) => Promise<unknown> } }, row: Args<'session.append'>): Promise<void> => {
  await $.session.append(row).catch(() => undefined)
}

const ENGINE: RenderElement = { type: 'engine', ref: 0 }

const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(textOf).join('')
  }

  if (node !== null && typeof node === 'object') {
    return textOf((node as { children?: unknown }).children ?? [])
  }

  return ''
}

const history = (args: string) => ({ command: 'history', args, origin: { kind: 'composer' as const }, presentation: PRESENTATION })

describe('the vault', () => {
  test('after the first turn the transcript is copied with a readable markdown beside it', async ($, on) => {
    const world = worldOf(on, { [SOURCE]: TRANSCRIPT })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.turn.complete(TURN)

    expect(world.files.get(`${BASE}.jsonl`)).toBe(TRANSCRIPT)
    expect(world.files.get(`${BASE}.md`)).toContain('# Flaky login test')
    expect(world.files.get(`${BASE}.md`)).toContain('tools: Read, Bash')
    expect(world.files.get(SOURCE)).toBe(TRANSCRIPT)
  })

  test('later turns wait for the interval, then copy again', async ($, on) => {
    const world = worldOf(on, { [SOURCE]: TRANSCRIPT })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.turn.complete(TURN)
    const first = world.writes.length

    await clock.advance(4 * MIN)
    await $.turn.complete(TURN)

    expect(world.writes.length).toBe(first)

    await clock.advance(MIN)
    await $.turn.complete(TURN)

    expect(world.writes.length).toBe(first * 2)
  })

  test('with vaultEveryMinutes 0 every turn copies', { options: { vaultEveryMinutes: 0 } }, async ($, on) => {
    const world = worldOf(on, { [SOURCE]: TRANSCRIPT })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.turn.complete(TURN)
    await $.turn.complete(TURN)

    expect(world.writes.filter(path => path.endsWith('.jsonl')).length).toBe(2)
  })

  test('the session end copies even inside the interval, so the last turns are kept', async ($, on) => {
    const world = worldOf(on, { [SOURCE]: TRANSCRIPT })
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.turn.complete(TURN)

    const longer = `${TRANSCRIPT}"}\n`
    world.files.set(SOURCE, longer)
    await clock.advance(MIN)
    await $.session.end(END)

    expect(world.files.get(`${BASE}.jsonl`)).toBe(longer)
  })

  test('with markdown off only the JSONL is written', { options: { markdown: false } }, async ($, on) => {
    const world = worldOf(on, { [SOURCE]: TRANSCRIPT })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.session.end(END)

    expect(world.files.has(`${BASE}.jsonl`)).toBe(true)
    expect(world.files.has(`${BASE}.md`)).toBe(false)
  })

  test('a vaulted copy larger than the transcript is never overwritten', async ($, on) => {
    const kept = `${TRANSCRIPT}\n${'{"type":"user"}\n'.repeat(50)}`
    const world = worldOf(on, { [SOURCE]: TRANSCRIPT, [`${BASE}.jsonl`]: kept })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.session.end(END)

    expect(world.files.get(`${BASE}.jsonl`)).toBe(kept)
    expect(world.writes).toEqual([])
    expect(world.logs.join('\n')).toContain('left as it is')
  })

  test('nothing is written before any event named the transcript, or for a subagent turn', async ($, on) => {
    const world = worldOf(on, { [SOURCE]: TRANSCRIPT })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.turn.complete(TURN)

    expect(world.writes).toEqual([])

    await $.classic.UserPromptSubmit({ prompt: 'x', transcript_path: SOURCE })
    await $.turn.complete({ ...TURN, agentId: 'agent-1' })

    expect(world.writes).toEqual([])
  })

  test('a session of slash commands alone is not vaulted', async ($, on) => {
    const world = worldOf(on, { [SOURCE]: ONLY_COMMANDS })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.session.end(END)

    expect(world.writes).toEqual([])
  })

  test('a transcript over 4 MiB is read in pieces and copied with cp', async ($, on) => {
    const world = worldOf(on, { [SOURCE]: TRANSCRIPT })
    world.sizes.set(SOURCE, 5 * 1024 * 1024)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.session.end(END)

    expect(world.commands.map(argv => argv[0])).toEqual(['tail', 'mkdir', 'cp'])
    expect(world.files.get(`${BASE}.jsonl`)).toBe(TRANSCRIPT)
    expect(world.files.get(`${BASE}.md`)).toContain('# Flaky login test')
  })
})

describe('/history', () => {
  const OLDER = `${VAULT}/2026-09-01_older-session`
  const older = (body: string) => `# Old work\n\n- Session: \`older-session\`\n- First prompt: ${body}\n\n---\n\n**10:00 · You**\n\n${body}\n`

  test('lists vaulted sessions newest first with their title or first prompt', async ($, on) => {
    const world = worldOf(on, { [SOURCE]: TRANSCRIPT, [`${OLDER}.jsonl`]: '{}\n', [`${OLDER}.md`]: older('set up kafka') })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.turn.complete(TURN)

    const answer = await $.command.run(history(''))
    const lines = (answer.text ?? '').split('\n')

    expect(lines[0]).toContain('2 vaulted sessions, newest first (~/.claude/history-keeper/-work-app)')
    expect(lines[1]).toContain(SESSION_ID)
    expect(lines[1]).toContain('Flaky login test')
    expect(lines[2]).toContain('2026-09-01')
    expect(lines[2]).toContain('set up kafka')
    expect(world.writes.every(path => path.startsWith(VAULT))).toBe(true)
  })

  test('searches the markdown, most matches first, with a snippet', async ($, on) => {
    worldOf(on, { [SOURCE]: TRANSCRIPT, [`${OLDER}.jsonl`]: '{}\n', [`${OLDER}.md`]: older('the login page and the LOGIN form') })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'startup', transcript_path: SOURCE })
    await $.turn.complete(TURN)

    const text = (await $.command.run(history('login'))).text ?? ''
    const lines = text.split('\n')

    expect(lines[0]).toContain('Sessions mentioning "login"')
    expect(lines[1]).toContain('older-session  2×  the login page and the LOGIN form')
    expect(lines[2]).toContain(`${SESSION_ID}  1×  fix the login test`)
  })

  test('says so when nothing is vaulted or nothing matches', async ($, on) => {
    worldOf(on)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)

    expect((await $.command.run(history(''))).text).toContain('No vaulted sessions for this project yet')
    expect((await $.command.run(history('redis'))).text).toContain('No vaulted session mentions "redis"')
  })
})

describe('times beside messages', () => {
  test('a prompt row shows the time it was written, beside the engine drawing', async ($, on) => {
    worldOf(on)
    const clock = mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    const at = clock.now()
    await appended($, prompt('u-new'))

    const tree = await $.ui.render(row('u-new'))

    expect(textOf(tree)).toContain(clockLabel(at, NOW, offsetAt(at)))
    expect(JSON.stringify(tree)).toContain('"type":"engine"')
  })

  test('the expanded view (ctrl+o) gets the engine row untouched', async ($, on) => {
    worldOf(on)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await appended($, prompt('u-new'))

    expect(await $.ui.render(row('u-new', true))).toEqual(ENGINE)
  })

  test('a row with no recorded time, or a reply in "prompts" mode, is left alone', async ($, on) => {
    worldOf(on)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await appended($, answer('a-new'))

    expect(await $.ui.render(row('never-appended'))).toEqual(ENGINE)
    expect(await $.ui.render(reply('a-new'))).toEqual(ENGINE)
  })

  test('"all" stamps the first block of a reply too', { options: { timestamps: 'all' } }, async ($, on) => {
    worldOf(on)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await appended($, answer('a-new'))

    expect(textOf(await $.ui.render(reply('a-new')))).toContain(clockLabel(NOW, NOW, offsetAt(NOW)))
    expect(await $.ui.render(reply('a-new', false))).toEqual(ENGINE)
  })

  test('"off" draws nothing of its own', { options: { timestamps: 'off' } }, async ($, on) => {
    worldOf(on)
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await appended($, prompt('u-new'))

    expect(await $.ui.render(row('u-new'))).toEqual(ENGINE)
  })

  test('a resumed session gets its times from the transcript', async ($, on) => {
    worldOf(on, { [SOURCE]: TRANSCRIPT })
    mock.clock(on, { now: NOW })
    await $.session.start(SESSION)
    await $.classic.SessionStart({ source: 'resume', transcript_path: SOURCE })

    const at = Date.parse('2026-10-06T12:30:06.000Z')

    expect(textOf(await $.ui.render(row('u1')))).toContain(clockLabel(at, NOW, offsetAt(at)))
    expect(await $.ui.render(row('a1'))).toEqual(ENGINE)
  })
})

describe('what the time row draws is accepted by each surface', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a stamped prompt and reply validate on ${surface}`, { options: { timestamps: 'all' } }, async ($, on) => {
      worldOf(on)
      mock.clock(on, { now: NOW })
      await $.session.start(SESSION)
      await appended($, prompt('u-new'))
      await appended($, answer('a-new'))

      for (const columns of [50, 120]) {
        const user = await $.ui.mount({ plugin: 'history-keeper', surface, component: 'UserMessage', requestId: 'u-new', viewport: { columns, rows: 40 }, props: row('u-new').props })

        expect(user.surface).toBe(surface)
        expect(await user.find({ type: 'Text', text: /\d\d:\d\d/ })).toBeDefined()
        await user.unmount()

        const assistant = await $.ui.mount({ plugin: 'history-keeper', surface, component: 'AssistantMessage', requestId: 'a-new', viewport: { columns, rows: 40 }, props: reply('a-new').props })

        expect(assistant.surface).toBe(surface)
        await assistant.unmount()
      }
    })
  }
})
