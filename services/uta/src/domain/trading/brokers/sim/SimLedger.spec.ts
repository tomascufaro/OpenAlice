import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SimLedger } from './SimLedger.js'
import type { SimLedgerState } from './sim-types.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'openalice-ledger-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('SimLedger', () => {
  it('returns null when no ledger exists', async () => {
    const ledger = new SimLedger('sim', join(tempDir, 'missing', 'ledger.json'))

    await expect(ledger.load()).resolves.toBeNull()
  })

  it('round-trips ledger state and creates parent directories', async () => {
    const ledger = new SimLedger('sim', join(tempDir, 'nested', 'ledger.json'))
    const state: SimLedgerState = {
      accountId: 'sim',
      cash: '1500',
      currency: 'USD',
      positions: [],
      orders: [],
      realizedPnL: '0',
      nextOrderId: 7,
    }

    await ledger.save(state)

    await expect(ledger.load()).resolves.toEqual(state)
  })
})
