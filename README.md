# history-keeper

A Claude Code mod that keeps a copy of every session the 30-day cleanup cannot delete, puts the time beside each of your prompts, and lets you list and search old sessions with `/history`.

```
❯ fix the login test, it fails on CI                                                     14:32

> /history
3 vaulted sessions, newest first (~/.claude/history-keeper/-Users-me-app):
2026-10-06   48 KB  61f2df73-9117-4789-880b-0cd74a665b25  Flaky login test
2026-10-02  1.2 MB  9c1d33aa-0b6e-4c1f-a0de-2b51f1f0c7aa  move the billing cron to the worker
2026-09-14    7 KB  3e0b7d2c-5a61-4c3e-9f0e-6d2f8a9b1c44  set up kafka locally
Resume one with claude --resume <id>; search with /history <text>.

> /history kafka
Sessions mentioning "kafka", most matches first (searched 3):
2026-09-14  3e0b7d2c-5a61-4c3e-9f0e-6d2f8a9b1c44  6×  set up kafka locally with docker compose
```

## Why

Claude Code deletes session transcripts older than 30 days, and nothing tells you it did:

- [#59248](https://github.com/anthropics/claude-code/issues/59248): transcripts silently deleted, people lost work history (175 👍, 220 comments, open).
- [#44763](https://github.com/anthropics/claude-code/issues/44763): messages have no timestamps (280 👍, 151 comments, open).
- [#2112](https://github.com/anthropics/claude-code/issues/2112): old sessions are hard to name and find.

The official knob is `cleanupPeriodDays` in `settings.json`: raise it and Claude Code keeps transcripts longer. A copy of your own still helps:

- **It survives what the setting does not.** A reinstall, a wiped `~/.claude/projects`, a new machine set up from settings, or a cleanup that ran before you raised the number.
- **It is readable.** Next to each JSONL copy the mod writes a markdown file with every prompt, reply and tool name under its local time. `grep -ri kafka ~/.claude/history-keeper` works without Claude Code.
- **It is findable from the session.** `/history` lists this project's sessions by date and first prompt, and searches their text.

## What it does

| Where | What |
|---|---|
| Vault | After a turn (at most every 5 minutes) and when the session ends, copies the transcript to `~/.claude/history-keeper/<project>/<date>_<session-id>.jsonl`, with a readable `.md` beside it. Never deletes anything |
| Transcript | A dim local time beside each of your prompts, `14:32` today and `10-05 14:32` before; with `timestamps: all` also beside each reply |
| `/history` | This project's vaulted sessions, newest first, top 20: date, size, session id, title or first prompt |
| `/history <text>` | Case-insensitive search of the vaulted markdown, top 10 sessions: date, session id, number of matches and a one-line snippet |

## Install

You need Claude Code with mods (function hooks). It was tested on 2.1.285.

From the marketplace in this repo:

```
/plugin marketplace add Jvrd97/claude-history-keeper
/plugin install history-keeper@history-keeper
```

Or straight from disk, for one session:

```bash
git clone https://github.com/Jvrd97/claude-history-keeper.git
claude --plugin-dir ./claude-history-keeper
```

## Settings

Change them in `/config` under the plugin, or in `settings.json` under `pluginConfigs`:

| Field | Default | Meaning |
|---|---|---|
| `vaultDir` | `~/.claude/history-keeper` | Where copies go, one folder per project |
| `vaultEveryMinutes` | `5` | After a turn, copy again only if this many minutes passed since the last copy; `0` copies after every turn. The session's end always copies |
| `markdown` | `true` | Write the readable `.md` beside each `.jsonl` |
| `timestamps` | `prompts` | `off`, `prompts`, or `all` (prompts and replies) |

## How it works

- **Where the transcript is.** Every classic hook event carries `transcript_path`. The mod reads it from `classic.SessionStart` and `classic.UserPromptSubmit` and remembers the folder; the file is `<folder>/<session id>.jsonl`.
- **When it copies.** `turn.complete` on the main loop (subagent turns are skipped), throttled by `vaultEveryMinutes`, and `session.end`, which covers `/exit`, `/clear`, a finished `claude -p` and a closed terminal.
- **How it copies.** A transcript up to 4 MiB is read and written through the plugin file API. A bigger one is copied with `cp` and read for the markdown in pieces with `tail -c`, so that part needs a POSIX shell (macOS, Linux, WSL).
- **What it writes.** Only inside `vaultDir`: `<project-slug>/<YYYY-MM-DD>_<session-id>.jsonl` and `.md`. The project slug is the project path with every character but a letter or a digit turned into `-`, as Claude Code names its own folders. The date is the local date of the session's first row, so a session that runs past midnight or is resumed next week keeps one file. Each copy replaces the previous copy of the same session, unless the vaulted file is larger than the transcript: then it is left as it is. Nothing is ever deleted.
- **What the markdown holds.** A header (title, session id, project, start, first prompt), then each prompt and reply with its local time and the names of the tools called between them. Tool inputs and outputs, thinking, meta rows, subagent rows and compaction summaries stay out; they are in the JSONL.
- **Where the times come from.** A message row's render `requestId` is its uuid in the transcript. The mod notes the time each prompt (and, with `all`, each reply) is appended through `session.append`, keyed by that uuid; on `--resume` it reads the times back from the transcript itself, the newest 300 rows.
- **How a time is drawn.** The `ui.render` hook on `UserMessage` (and `AssistantMessage` with `all`) wraps the engine's own drawing, untouched, in a row with the time dim at its right, bottom-aligned. The row's text and the stored message never change. A surface that refuses the tree draws the engine's row alone. The expanded view (ctrl+o) gets the engine's row as it is.
- **What `/history` reads.** The vault folder of the current project root, newest first by the copy's modification time. Search reads the markdown of the newest 500 sessions and counts matches in the conversation part only, so a first prompt is not counted twice.

What it can't do:

- Bring back a session deleted before the mod was installed, or copy a session that ran without it.
- Copy the very last turn if Claude Code is killed hard (`kill -9`, a crash): the end flush runs inside the engine's 1.5 s exit window, and a huge transcript may not finish in it. The copy from the turn before is still there.
- Show times for rows it has no record of: prompts of a resumed session older than its newest 300 rows, and rows from before the mod was loaded in a running session.
- Find a session by meaning: search is a plain substring match.

The mod makes no network calls and sends nothing anywhere.

## Develop

Inside Claude Code run `/plugin-types .claude/types` once: it writes the API types `tsc` reads. Then:

```bash
tsc -p .
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
```

## По-русски

Claude Code молча удаляет сессии старше 30 дней. Мод держит свою копию каждой сессии в `~/.claude/history-keeper`, её не трогает ни очистка, ни переустановка:

- **Копия.** После хода (не чаще раза в 5 минут) и при выходе мод копирует JSONL сессии и пишет рядом читаемый markdown с временем каждого сообщения. Мод ничего не удаляет.
- **Время в переписке.** Рядом с каждым вашим промптом стоит тусклое «14:32».
- **Поиск.** `/history` показывает сессии проекта, `/history <текст>` ищет по ним.

## License

MIT
