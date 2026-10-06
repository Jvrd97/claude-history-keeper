import type { On } from 'claude-code'

import { CWD, SESSION_ID } from './transcript'

export const HOME = '/home/me'
export const TRANSCRIPTS = `${HOME}/.claude/projects/-work-app`
export const VAULT = `${HOME}/.claude/history-keeper/-work-app`

/** The world beneath the plugin, in memory: absolute paths to text, and a record of what the plugin asked for. */
export type World = {
  files: Map<string, string>
  /** A size the stat answers instead of the text's own, to stand for a transcript over 4 MiB. */
  sizes: Map<string, number>
  mtimes: Map<string, number>
  writes: string[]
  commands: string[][]
  logs: string[]
  sessionId: string
}

const childrenOf = (files: Map<string, string>, dir: string): string[] =>
  [...files.keys()].filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))

export function worldOf(on: On, files: Readonly<Record<string, string>> = {}): World {
  let tick = 1_000
  const world: World = {
    files: new Map(Object.entries(files)),
    sizes: new Map(),
    mtimes: new Map(Object.keys(files).map(path => [path, tick])),
    writes: [],
    commands: [],
    logs: [],
    sessionId: SESSION_ID,
  }

  const put = (path: string, text: string): void => {
    tick += 1_000
    world.files.set(path, text)
    world.mtimes.set(path, tick)
  }

  const sizeOf = (path: string): number => world.sizes.get(path) ?? new TextEncoder().encode(world.files.get(path) ?? '').length

  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('session.id', () => ({ value: world.sessionId }))
  on('session.root', () => ({ value: CWD }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', ($, e) => {
    world.logs.push(e.text)

    return { value: undefined }
  })

  on('fs.exists', ($, e) => ({ value: world.files.has(e.path) }))
  on('fs.stat', ($, e) =>
    world.files.has(e.path)
      ? { value: { kind: 'file' as const, size: sizeOf(e.path), mtimeMs: world.mtimes.get(e.path) ?? 0, isLink: false } }
      : { deny: `ENOENT: ${e.path}` },
  )
  on('fs.read', ($, e) => {
    const text = world.files.get(e.path)

    if (text === undefined) {
      return { deny: `ENOENT: ${e.path}` }
    }

    return sizeOf(e.path) > 4 * 1024 * 1024 ? { deny: `over 4 MiB: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    world.writes.push(e.path)
    put(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', ($, e) => {
    const names = childrenOf(world.files, e.path)

    if (names.length === 0) {
      return { deny: `ENOENT: ${e.path}` }
    }

    return {
      value: names.map(path => ({
        name: path.slice(e.path.length + 1),
        kind: 'file' as const,
        size: sizeOf(path),
        mtimeMs: world.mtimes.get(path) ?? 0,
        isLink: false,
      })),
    }
  })

  on('process.run', ($, e) => {
    const argv = [...e.argv]
    world.commands.push(argv)
    const done = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

    if (argv[0] === 'tail') {
      const offset = Number((argv[2] ?? '+1').slice(1)) - 1
      const bytes = new TextEncoder().encode(world.files.get(argv[3] ?? '') ?? '')

      return done(new TextDecoder().decode(bytes.slice(offset)))
    }

    if (argv[0] === 'cp') {
      world.writes.push(argv[2] ?? '')
      put(argv[2] ?? '', world.files.get(argv[1] ?? '') ?? '')
    }

    return done()
  })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.append', ($, e, next) => next(e))
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  return world
}
