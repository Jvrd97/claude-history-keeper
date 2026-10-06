const MINUTE_MS = 60_000
const KIB = 1024
const MIB = KIB * KIB

/** `$.fs.read` rejects a file over 4 MiB; bigger transcripts are read in pieces through `tail`. */
export const FS_READ_LIMIT = 4 * MIB
/** Long project paths are cut and given a hash, so the folder name stays under the file system's 255. */
const MAX_SLUG = 200
const LABEL_WIDTH = 80
const PROMPT_WIDTH = 200
const SNIPPET_WIDTH = 100
const PAD = 2

export type TimestampMode = 'off' | 'prompts' | 'all'

export type Entry =
  | { kind: 'user'; at: number | null; uuid: string | null; text: string }
  | { kind: 'assistant'; at: number | null; uuid: string | null; text: string; tools: string[] }

export type Transcript = {
  /** The first timestamp any row carries: when the session started. */
  startedAt: number | null
  cwd: string | null
  /** The last name `/rename` (or the engine) gave the session. */
  title: string | null
  entries: Entry[]
}

const pad = (n: number): string => String(n).padStart(PAD, '0')

/** Minutes east of UTC at that moment on this machine; pure callers take it as an argument. */
export const offsetAt = (ms: number): number => -new Date(ms).getTimezoneOffset()

const shifted = (ms: number, offsetMinutes: number): Date => new Date(ms + offsetMinutes * MINUTE_MS)

export const localDate = (ms: number, offsetMinutes: number): string => {
  const d = shifted(ms, offsetMinutes)

  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export const localTime = (ms: number, offsetMinutes: number): string => {
  const d = shifted(ms, offsetMinutes)

  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** "14:32" for today, "10-05 14:32" for an older row. */
export const clockLabel = (at: number, now: number, offsetMinutes: number): string => {
  const time = localTime(at, offsetMinutes)
  const date = localDate(at, offsetMinutes)

  return date === localDate(now, offsetMinutes) ? time : `${date.slice(5)} ${time}`
}

const hashOf = (text: string): string => {
  let hash = 5381

  for (const char of text) {
    hash = (hash * 33 + (char.codePointAt(0) ?? 0)) >>> 0
  }

  return hash.toString(36)
}

/** A project's folder name: every character but a letter or a digit becomes "-", as Claude Code names its own. */
export const slugOf = (path: string): string => {
  const slug = path.replace(/[^A-Za-z0-9]/g, '-')

  return slug.length <= MAX_SLUG ? slug : `${slug.slice(0, MAX_SLUG)}-${hashOf(path)}`
}

/** Keeps a session id safe to put in a file name. */
export const safeId = (sessionId: string): string => sessionId.replace(/[^A-Za-z0-9._-]/g, '_')

export const vaultBase = (date: string, sessionId: string): string => `${date}_${safeId(sessionId)}`

export type VaultName = { date: string; sessionId: string; ext: 'jsonl' | 'md' }

export const parseVaultName = (name: string): VaultName | null => {
  const match = /^(\d{4}-\d{2}-\d{2})_(.+)\.(jsonl|md)$/.exec(name)

  if (match === null) {
    return null
  }

  const [, date = '', sessionId = '', ext] = match

  return { date, sessionId, ext: ext === 'md' ? 'md' : 'jsonl' }
}

export const expandHome = (path: string, home: string | undefined): string => {
  if (home === undefined || !(path === '~' || path.startsWith('~/'))) {
    return path
  }

  return `${home.replace(/\/$/, '')}${path.slice(1)}`
}

/** A path as a person writes it: the home folder as "~". */
export const tildeOf = (path: string, home: string | undefined): string =>
  home !== undefined && home !== '' && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path

export const dirOf = (path: string): string => {
  const cut = path.lastIndexOf('/')

  return cut <= 0 ? '/' : path.slice(0, cut)
}

export type Vaulted = { sessionId: string; at: number }

/** A new session always vaults; the same one waits `everyMinutes` between copies (0: every turn). */
export const isVaultDue = (last: Vaulted | null, sessionId: string, now: number, everyMinutes: number): boolean =>
  last === null || last.sessionId !== sessionId || now - last.at >= Math.max(0, everyMinutes) * MINUTE_MS

export const byteLength = (text: string): number => new TextEncoder().encode(text).length

/** The whole lines of a piece cut at an arbitrary byte: everything up to and with the last newline. */
export const wholeLines = (piece: string): string => piece.slice(0, piece.lastIndexOf('\n') + 1)

export const oneLine = (text: string, width: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`
}

type Block = { type?: unknown; text?: unknown; name?: unknown }
type Row = {
  type?: unknown
  timestamp?: unknown
  uuid?: unknown
  cwd?: unknown
  customTitle?: unknown
  isMeta?: unknown
  isSidechain?: unknown
  isCompactSummary?: unknown
  message?: { content?: unknown }
}

const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
const ENGINE_ONLY = /^<(local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr)>/
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

const blocksOf = (content: unknown): Block[] => {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }

  return Array.isArray(content) ? content.filter((block): block is Block => block !== null && typeof block === 'object') : []
}

/** What a person typed, as the row shows it: a slash command as "/name args", the engine's own echoes dropped. */
const userText = (raw: string): string => {
  const name = COMMAND_NAME.exec(raw)

  if (name !== null) {
    const args = COMMAND_ARGS.exec(raw)?.[1]?.trim() ?? ''
    const command = (name[1] ?? '').trim()

    return args === '' ? command : `${command} ${args}`
  }

  return ENGINE_ONLY.test(raw.trim()) ? '' : raw.replace(REMINDER, '').trim()
}

const timeOf = (value: unknown): number | null => {
  if (typeof value !== 'string') {
    return null
  }

  const at = Date.parse(value)

  return Number.isNaN(at) ? null : at
}

const entryOf = (row: Row): Entry | null => {
  if (row.isMeta === true || row.isSidechain === true || row.isCompactSummary === true) {
    return null
  }

  const at = timeOf(row.timestamp)
  const uuid = typeof row.uuid === 'string' ? row.uuid : null
  const blocks = blocksOf(row.message?.content)

  if (row.type === 'user') {
    const parts = blocks.flatMap(block => {
      if (block.type === 'text' && typeof block.text === 'string') {
        return [userText(block.text)]
      }

      return block.type === 'image' ? ['[image]'] : []
    })
    const text = parts.filter(part => part !== '').join('\n\n')

    return text === '' ? null : { kind: 'user', at, uuid, text }
  }

  if (row.type === 'assistant') {
    const text = blocks
      .flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text.trim()] : []))
      .filter(part => part !== '')
      .join('\n\n')
    const tools = blocks.flatMap(block => (block.type === 'tool_use' && typeof block.name === 'string' ? [block.name] : []))

    return text === '' && tools.length === 0 ? null : { kind: 'assistant', at, uuid, text, tools }
  }

  return null
}

/** Reads a transcript JSONL: user and assistant rows in order; meta, sidechain and bookkeeping rows skipped. */
export const parseTranscript = (text: string): Transcript => {
  const transcript: Transcript = { startedAt: null, cwd: null, title: null, entries: [] }

  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue
    }

    let row: Row

    try {
      row = JSON.parse(line) as Row
    } catch {
      // A torn last line while the engine is still writing; the next copy has it whole.
      continue
    }

    if (row === null || typeof row !== 'object') {
      continue
    }

    transcript.startedAt ??= timeOf(row.timestamp)

    if (transcript.cwd === null && typeof row.cwd === 'string') {
      transcript.cwd = row.cwd
    }

    if (row.type === 'custom-title' && typeof row.customTitle === 'string' && row.customTitle.trim() !== '') {
      transcript.title = row.customTitle.trim()
    }

    const entry = entryOf(row)

    if (entry !== null) {
      transcript.entries.push(entry)
    }
  }

  return transcript
}

/** A session worth a copy has a reply or a prompt that is not a slash command (a lone `/history` run is not). */
export const hasConversation = (transcript: Transcript): boolean =>
  transcript.entries.some(entry => entry.kind === 'assistant' || !entry.text.startsWith('/'))

export const firstPromptOf = (transcript: Transcript): string | null => {
  const first = transcript.entries.find(entry => entry.kind === 'user')

  return first === undefined ? null : oneLine(first.text, PROMPT_WIDTH)
}

/** The rows a mode stamps: prompts alone, or every user and assistant row. */
export const stampsOf = (transcript: Transcript, mode: TimestampMode): [string, number][] =>
  mode === 'off'
    ? []
    : transcript.entries.flatMap(entry =>
        entry.uuid !== null && entry.at !== null && (mode === 'all' || entry.kind === 'user') ? [[entry.uuid, entry.at] as [string, number]] : [],
      )

/** What `session.append` says about a row, as far as stamping goes. */
export type AppendFacts = { door: string; type: string; isMeta: boolean; isSubagent: boolean }

export const isStamped = (mode: TimestampMode, row: AppendFacts): boolean => {
  if (mode === 'off' || row.isSubagent || row.isMeta) {
    return false
  }

  return (row.door === 'prompt' && row.type === 'user') || (mode === 'all' && row.door === 'response' && row.type === 'assistant')
}

export const parseMode = (value: unknown): TimestampMode => (value === 'off' || value === 'all' ? value : 'prompts')

/** The line under which the conversation starts; header lines above it are not searched. */
export const BODY_MARK = '\n---\n'

/** The readable copy: a header to find it by, then each prompt, reply and tool call with its local time. */
export const renderMarkdown = (transcript: Transcript, sessionId: string, offsetMinutes: number): string => {
  const first = firstPromptOf(transcript)
  const heading = transcript.title ?? (first === null ? `Session ${sessionId}` : oneLine(first, LABEL_WIDTH))
  const lines = [`# ${heading}`, '', `- Session: \`${sessionId}\` (resume with \`claude --resume ${sessionId}\`)`]

  if (transcript.title !== null) {
    lines.push(`- Title: ${transcript.title}`)
  }

  if (transcript.cwd !== null) {
    lines.push(`- Project: \`${transcript.cwd}\``)
  }

  if (transcript.startedAt !== null) {
    lines.push(`- Started: ${localDate(transcript.startedAt, offsetMinutes)} ${localTime(transcript.startedAt, offsetMinutes)}`)
  }

  if (first !== null) {
    lines.push(`- First prompt: ${first}`)
  }

  lines.push('', BODY_MARK.trim(), '')

  const stampOf = (at: number | null): string => (at === null ? '' : `${localTime(at, offsetMinutes)} · `)
  let tools: string[] = []
  let toolsAt: number | null = null

  const flushTools = (): void => {
    if (tools.length > 0) {
      lines.push(`_${stampOf(toolsAt)}tools: ${tools.join(', ')}_`, '')
    }

    tools = []
    toolsAt = null
  }

  for (const entry of transcript.entries) {
    if (entry.kind === 'assistant' && entry.text === '') {
      toolsAt ??= entry.at
      tools.push(...entry.tools)
      continue
    }

    flushTools()
    lines.push(`**${stampOf(entry.at)}${entry.kind === 'user' ? 'You' : 'Claude'}**`, '', entry.text, '')

    if (entry.kind === 'assistant' && entry.tools.length > 0) {
      toolsAt = entry.at
      tools.push(...entry.tools)
    }
  }

  flushTools()

  return `${lines.join('\n').trimEnd()}\n`
}

export type MarkdownHeader = { title: string | null; firstPrompt: string | null }

export const headerOf = (markdown: string): MarkdownHeader => {
  const head = markdown.split(BODY_MARK)[0] ?? ''

  return {
    title: /^- Title: (.*)$/m.exec(head)?.[1] ?? null,
    firstPrompt: /^- First prompt: (.*)$/m.exec(head)?.[1] ?? null,
  }
}

export const formatSize = (bytes: number): string => {
  if (bytes < KIB) {
    return `${bytes} B`
  }

  return bytes < MIB ? `${Math.round(bytes / KIB)} KB` : `${(bytes / MIB).toFixed(1)} MB`
}

export type ListedSession = { date: string; sessionId: string; size: number; mtimeMs: number; label: string | null }

export const listText = (sessions: readonly ListedSession[], total: number, folder: string): string => {
  if (sessions.length === 0) {
    return `No vaulted sessions for this project yet (${folder}). A session is copied after its first turn.`
  }

  const sizes = sessions.map(session => formatSize(session.size))
  const width = Math.max(...sizes.map(size => size.length))
  const rows = sessions.map(
    (session, i) => `${session.date}  ${(sizes[i] ?? '').padStart(width)}  ${session.sessionId}  ${oneLine(session.label ?? '(no prompt)', LABEL_WIDTH)}`,
  )
  const shown = sessions.length < total ? `${sessions.length} of ${total} vaulted sessions` : total === 1 ? '1 vaulted session' : `${total} vaulted sessions`

  return [`${shown}, newest first (${folder}):`, ...rows, 'Resume one with claude --resume <id>; search with /history <text>.'].join('\n')
}

export type SearchDoc = { date: string; sessionId: string; mtimeMs: number; markdown: string }
export type SearchHit = { date: string; sessionId: string; count: number; snippet: string }

const countOf = (haystack: string, needle: string): number => {
  let count = 0
  let from = haystack.indexOf(needle)

  while (from !== -1) {
    count += 1
    from = haystack.indexOf(needle, from + needle.length)
  }

  return count
}

/** The match with some text either side, on one line. */
export const snippetOf = (line: string, query: string, width = SNIPPET_WIDTH): string => {
  const flat = line.replace(/\s+/g, ' ').trim()
  const at = flat.toLowerCase().indexOf(query.toLowerCase())

  if (flat.length <= width || at === -1) {
    return oneLine(flat, width)
  }

  const start = Math.max(0, Math.min(at - Math.floor((width - query.length) / 2), flat.length - width))
  const end = Math.min(flat.length, start + width)

  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

/** Case-insensitive substring search over the conversation part of each copy: most matches first, then newest. */
export const search = (docs: readonly SearchDoc[], query: string, limit: number): SearchHit[] => {
  const needle = query.toLowerCase()

  if (needle.trim() === '') {
    return []
  }

  return docs
    .flatMap(doc => {
      const cut = doc.markdown.indexOf(BODY_MARK)
      const body = cut === -1 ? doc.markdown : doc.markdown.slice(cut + BODY_MARK.length)
      const count = countOf(body.toLowerCase(), needle)

      if (count === 0) {
        return []
      }

      const line = body.split('\n').find(one => one.toLowerCase().includes(needle)) ?? ''

      return [{ hit: { date: doc.date, sessionId: doc.sessionId, count, snippet: snippetOf(line, query) }, mtimeMs: doc.mtimeMs }]
    })
    .sort((a, b) => b.hit.count - a.hit.count || b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map(found => found.hit)
}

export const searchText = (hits: readonly SearchHit[], query: string, searched: number): string => {
  if (hits.length === 0) {
    return `No vaulted session mentions "${query}" (searched ${searched}).`
  }

  const rows = hits.map(hit => `${hit.date}  ${hit.sessionId}  ${hit.count}×  ${hit.snippet}`)

  return [`Sessions mentioning "${query}", most matches first (searched ${searched}):`, ...rows].join('\n')
}
