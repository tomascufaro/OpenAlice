import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SessionRegistry, type SessionRecord } from './session-registry.js'
import type { Logger } from './logger.js'

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  event() {},
  child() {
    return noopLogger
  },
} as unknown as Logger

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sr-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// Hex/UUID wsId so the on-disk `<wsId>.json` matches SESSION_FILE_RE and
// bootFixup actually scans it on reload.
const WS = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789'

function rec(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'sess-1',
    wsId: WS,
    agent: 'claude',
    name: 'c1',
    createdAt: '2026-06-16T00:00:00.000Z',
    lastActiveAt: '2026-06-16T00:00:00.000Z',
    state: 'running',
    ...over,
  }
}

describe('SessionRegistry persistence', () => {
  // Regression: parseRecords rebuilt each record field-by-field and dropped
  // `title`, so the chat-sidebar title reverted to the `c1` name on every
  // server restart / registry reload even though flush had written it to disk.
  it('round-trips the session title across a reload', async () => {
    const reg = await SessionRegistry.load(root, noopLogger)
    await reg.create(rec({ id: 'sess-1', title: "What's moving in semiconductors today?" }))
    await reg.create(rec({ id: 'sess-2', name: 'c2', title: '解释一下美债收益率曲线倒挂' }))
    await reg.create(rec({ id: 'sess-3', name: 'c3' })) // unseeded — no title

    // A fresh instance over the same dir = a server restart.
    const reloaded = await SessionRegistry.load(root, noopLogger)
    await reloaded.ensureLoaded(WS)
    const byId = new Map(reloaded.listFor(WS).map((r) => [r.id, r]))

    expect(byId.get('sess-1')?.title).toBe("What's moving in semiconductors today?")
    expect(byId.get('sess-2')?.title).toBe('解释一下美债收益率曲线倒挂') // CJK survives
    expect(byId.get('sess-3')?.title).toBeUndefined() // unseeded stays nameless
  })

  // The exact path the user hit: a reload both flips orphaned running→paused
  // (bootFixup) AND must keep the title — they share the load codepath.
  it('keeps the title when bootFixup flips an orphaned running session to paused', async () => {
    const reg = await SessionRegistry.load(root, noopLogger)
    await reg.create(rec({ id: 'sess-1', state: 'running', title: 'Build a thesis on NVDA' }))

    const reloaded = await SessionRegistry.load(root, noopLogger)
    await reloaded.ensureLoaded(WS)
    const r = reloaded.listFor(WS)[0]

    expect(r?.state).toBe('paused') // orphaned running flipped on reload
    expect(r?.title).toBe('Build a thesis on NVDA') // …and the title is intact
  })
})
