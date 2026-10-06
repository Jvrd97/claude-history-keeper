import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import {
  byteLength,
  clockLabel,
  dirOf,
  expandHome,
  FS_READ_LIMIT,
  hasConversation,
  headerOf,
  isStamped,
  isVaultDue,
  listText,
  localDate,
  offsetAt,
  parseMode,
  parseTranscript,
  parseVaultName,
  renderMarkdown,
  search,
  searchText,
  slugOf,
  stampsOf,
  tildeOf,
  vaultBase,
  wholeLines,
} from './logic'
import type { ListedSession, SearchDoc, TimestampMode } from './logic'

const COMMAND = 'history'
const LIST_LIMIT = 20
const SEARCH_LIMIT = 10
/** Sessions read per search, newest first; bounds the time one /history takes. */
const SEARCH_SESSIONS = 500
/** Stamps loaded from a resumed transcript: the newest rows, the ones a person scrolls back to. */
const RESUMED_STAMPS = 300
/** Pieces of a transcript over 4 MiB read through `tail`: 64 pieces is 256 MiB. */
const MAX_PIECES = 64
const PIECE_TIMEOUT_MS = 30_000

const transcriptDir = atom({ plugin: 'history-keeper', key: 'transcriptDir' } as const, null)
const lastVault = atom({ plugin: 'history-keeper', key: 'lastVault' } as const, null)
const stamp = atom({ plugin: 'history-keeper', key: 'stamp' } as const, null)

type Settings = { vaultDir: string; everyMinutes: number; markdown: boolean; timestamps: TimestampMode }

async function homeOf($: EngineInterface): Promise<string | undefined> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
}

async function vaultRootOf($: EngineInterface, settings: Settings): Promise<string> {
  return expandHome(settings.vaultDir, await homeOf($)).replace(/\/$/, '')
}

async function projectFolderOf($: EngineInterface, settings: Settings): Promise<string> {
  return `${await vaultRootOf($, settings)}/${slugOf(await $.session.root())}`
}

/** A transcript's text: whole through `$.fs.read` up to its 4 MiB, beyond that in whole-line pieces through `tail`. */
async function readText($: EngineInterface, path: string, size: number): Promise<string | null> {
  if (size <= FS_READ_LIMIT) {
    return $.fs.read(path)
  }

  const pieces: string[] = []
  let offset = 0

  for (let i = 0; i < MAX_PIECES && offset < size; i += 1) {
    const run = await $.process.run(['tail', '-c', `+${offset + 1}`, path], { timeoutMs: PIECE_TIMEOUT_MS })

    if (run.exitCode !== 0) {
      return null
    }

    const piece = run.isStdoutTruncated ? wholeLines(run.stdout) : run.stdout

    if (piece === '') {
      break
    }

    pieces.push(piece)
    offset += byteLength(piece)

    if (!run.isStdoutTruncated) {
      break
    }
  }

  return pieces.join('')
}

async function sizeOf($: EngineInterface, path: string): Promise<number | null> {
  if (!(await $.fs.exists(path))) {
    return null
  }

  const stat = await $.fs.stat(path).catch(() => null)

  return stat === null || stat.kind !== 'file' ? null : stat.size
}

/** Copies the JSONL: back through `$.fs.write` when it was read whole, with `cp` when it is over 4 MiB. */
async function copyJsonl($: EngineInterface, source: string, target: string, text: string, size: number): Promise<void> {
  if (size <= FS_READ_LIMIT) {
    await $.fs.write(target, text)

    return
  }

  await $.process.run(['mkdir', '-p', dirOf(target)])
  const run = await $.process.run(['cp', source, target], { timeoutMs: PIECE_TIMEOUT_MS })

  if (run.exitCode !== 0) {
    throw new Error(`cp exited ${run.exitCode}: ${run.stderr.trim()}`)
  }
}

type VaultOutcome = { isCopied: true; target: string } | { isCopied: false; reason: string }

async function vault($: EngineInterface, sessionId: string, settings: Settings): Promise<VaultOutcome> {
  const dir = await read($, transcriptDir)

  if (dir === null) {
    return { isCopied: false, reason: 'no transcript path seen yet' }
  }

  const source = `${dir}/${sessionId}.jsonl`
  const size = await sizeOf($, source)

  if (size === null) {
    return { isCopied: false, reason: `no transcript at ${source}` }
  }

  const text = await readText($, source, size)

  if (text === null) {
    return { isCopied: false, reason: `could not read ${source}` }
  }

  const now = await $.clock.now()
  const transcript = parseTranscript(text)

  if (!hasConversation(transcript)) {
    return { isCopied: false, reason: 'nothing but slash commands yet' }
  }

  const startedAt = transcript.startedAt ?? now
  const base = `${await projectFolderOf($, settings)}/${vaultBase(localDate(startedAt, offsetAt(startedAt)), sessionId)}`
  const kept = await sizeOf($, `${base}.jsonl`)

  if (kept !== null && kept > size) {
    return { isCopied: false, reason: `the vaulted copy (${kept} bytes) is larger than the transcript (${size}); left as it is` }
  }

  await copyJsonl($, source, `${base}.jsonl`, text, size)

  if (settings.markdown) {
    await $.fs.write(`${base}.md`, renderMarkdown(transcript, sessionId, offsetAt(startedAt)))
  }

  await update($, lastVault, () => ({ sessionId, at: now }))

  return { isCopied: true, target: `${base}.jsonl` }
}

async function vaultLogged($: EngineInterface, sessionId: string, settings: Settings, why: string): Promise<void> {
  try {
    const outcome = await vault($, sessionId, settings)
    $.ui.log(outcome.isCopied ? `${why}: vaulted ${outcome.target}` : `${why}: not vaulted, ${outcome.reason}`, { to: 'debug' })
  } catch (error) {
    $.ui.log(`${why}: vault failed: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  }
}

/** Remembers where the engine keeps this project's transcripts; every classic event names the file. */
async function noteTranscript($: EngineInterface, transcriptPath: string): Promise<void> {
  if (transcriptPath === '') {
    return
  }

  const dir = dirOf(transcriptPath)

  if ((await read($, transcriptDir)) !== dir) {
    await update($, transcriptDir, () => dir)
  }
}

/** A resumed session's rows were loaded, not appended: their times come from the transcript itself. */
async function loadStamps($: EngineInterface, transcriptPath: string, mode: TimestampMode): Promise<void> {
  const size = await sizeOf($, transcriptPath)
  const text = size === null ? null : await readText($, transcriptPath, size)

  if (text === null) {
    return
  }

  for (const [uuid, at] of stampsOf(parseTranscript(text), mode).slice(-RESUMED_STAMPS)) {
    await $.state.set({ plugin: 'history-keeper', key: 'stamp', id: uuid }, at)
  }
}

type Session = { base: string; date: string; sessionId: string; mtimeMs: number; size: number; hasMarkdown: boolean }

async function sessionsOf($: EngineInterface, folder: string): Promise<Session[]> {
  const entries = await $.fs.list(folder).catch(() => [])
  const markdown = new Set(entries.filter(entry => entry.name.endsWith('.md')).map(entry => entry.name.slice(0, -'.md'.length)))

  return entries
    .flatMap(entry => {
      const name = parseVaultName(entry.name)

      if (name === null || name.ext !== 'jsonl' || entry.kind !== 'file') {
        return []
      }

      const base = entry.name.slice(0, -'.jsonl'.length)

      return [{ base, date: name.date, sessionId: name.sessionId, mtimeMs: entry.mtimeMs, size: entry.size, hasMarkdown: markdown.has(base) }]
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** The readable copy of one session: the .md beside it, or rendered from the JSONL when there is none. */
async function markdownOf($: EngineInterface, folder: string, session: Session): Promise<string | null> {
  if (session.hasMarkdown) {
    return $.fs.read(`${folder}/${session.base}.md`).catch(() => null)
  }

  const text = await readText($, `${folder}/${session.base}.jsonl`, session.size).catch(() => null)

  return text === null ? null : renderMarkdown(parseTranscript(text), session.sessionId, offsetAt(session.mtimeMs))
}

async function history($: EngineInterface, query: string, settings: Settings): Promise<string> {
  const folder = await projectFolderOf($, settings)
  const sessions = await sessionsOf($, folder)

  if (query === '') {
    const listed: ListedSession[] = []

    for (const session of sessions.slice(0, LIST_LIMIT)) {
      const markdown = await markdownOf($, folder, session)
      const header = markdown === null ? null : headerOf(markdown)
      const label = header === null ? null : header.title ?? header.firstPrompt

      listed.push({ date: session.date, sessionId: session.sessionId, size: session.size, mtimeMs: session.mtimeMs, label })
    }

    return listText(listed, sessions.length, tildeOf(folder, await homeOf($)))
  }

  const docs: SearchDoc[] = []

  for (const session of sessions.slice(0, SEARCH_SESSIONS)) {
    const markdown = await markdownOf($, folder, session)

    if (markdown !== null) {
      docs.push({ date: session.date, sessionId: session.sessionId, mtimeMs: session.mtimeMs, markdown })
    }
  }

  return searchText(search(docs, query, SEARCH_LIMIT), query, docs.length)
}

/**
 * The engine's own drawing of the row, untouched, with the time dim at its right. The row keeps its look and its
 * text; a surface that refuses the tree draws the engine's row alone, so the worst case is a row without a time.
 */
async function besideTime($: EngineInterface, e: RenderInput<'UserMessage' | 'AssistantMessage'>, drawn: RenderElement, at: number): Promise<RenderElement> {
  const { Box, Text } = $.ui.resolve(e)
  const now = await $.clock.now()

  return (
    <Box flexDirection="row" alignItems="flex-end">
      <Box flexGrow={1} flexShrink={1}>
        {drawn}
      </Box>
      <Text dimColor> {clockLabel(at, now, offsetAt(at))}</Text>
    </Box>
  )
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    vaultDir: String(options.vaultDir ?? '~/.claude/history-keeper'),
    everyMinutes: Number(options.vaultEveryMinutes ?? 5),
    markdown: options.markdown !== false,
    timestamps: parseMode(options.timestamps),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'List vaulted sessions of this project, or search them: /history <text>',
      argumentHint: '[text]',
    })

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    await noteTranscript($, e.transcript_path)

    if (settings.timestamps !== 'off' && (e.source === 'resume' || e.source === 'fork')) {
      await loadStamps($, e.transcript_path, settings.timestamps).catch((error: unknown) => {
        $.ui.log(`timestamps not loaded: ${String(error)}`, { to: 'debug' })
      })
    }

    return next(e)
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteTranscript($, e.transcript_path)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const answered = await next(e)

    if (e.agentId !== undefined) {
      return answered
    }

    const sessionId = await $.session.id()

    if (isVaultDue(await read($, lastVault), sessionId, await $.clock.now(), settings.everyMinutes)) {
      await vaultLogged($, sessionId, settings, 'turn')
    }

    return answered
  })

  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    await vaultLogged($, e.sessionId, settings, `session end (${e.reason})`)

    return ended
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await history($, e.args.trim(), settings) }))

  if (settings.timestamps === 'off') {
    return
  }

  on('session.append', async ($, e, next) => {
    const facts = { door: e.door, type: e.message.type, isMeta: e.message.isMeta === true, isSubagent: e.agentId !== undefined }

    if (isStamped(settings.timestamps, facts)) {
      await $.state.set({ plugin: 'history-keeper', key: 'stamp', id: e.uuid }, await $.clock.now())
    }

    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.origin.kind === 'task-notification') {
      return next(e)
    }

    const at = await read($, memberOf(stamp, e))

    return at === null ? next(e) : besideTime($, e, await next(e), at)
  })

  if (settings.timestamps !== 'all') {
    return
  }

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const at = e.props.isFirstOfReply ? await read($, memberOf(stamp, e)) : null

    return at === null ? next(e) : besideTime($, e, await next(e), at)
  })
}
