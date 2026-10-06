/** The last copy made for one session: throttles the per-turn vault. */
export type HistoryKeeperVaulted = { sessionId: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'history-keeper': {
      /** The folder the engine writes this project's transcripts to, from the classic events' `transcript_path`. */
      transcriptDir: string | null
      lastVault: HistoryKeeperVaulted | null
      /** When a transcript row was written, ms since the epoch, keyed by the row's uuid (the render site's requestId). */
      stamp: StateFamily<number | null>
    }
  }
}
