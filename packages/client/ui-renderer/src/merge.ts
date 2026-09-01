import type { SessionEvent, StreamDelta } from '@abyss-harness/client-connection'

/** Concatenate a delta onto an accumulator, resetting when the turn changes. */
export function mergeDelta(a: StreamDelta | null, b: StreamDelta): StreamDelta {
  if (a === null || a.turnSeq !== b.turnSeq) return b
  return { sessionId: b.sessionId, turnSeq: b.turnSeq, text: a.text + b.text, reasoning: (a.reasoning ?? '') + (b.reasoning ?? '') }
}

/** Union of two event lists by seq (dedupe + sort). A session's seqs are contiguous. */
export function mergeBySeq(a: readonly SessionEvent[], b: readonly SessionEvent[]): SessionEvent[] {
  const bySeq = new Map<number, SessionEvent>()
  for (const event of a) bySeq.set(event.seq, event)
  for (const event of b) bySeq.set(event.seq, event)
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq)
}
