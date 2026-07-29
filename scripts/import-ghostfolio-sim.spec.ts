import { describe, expect, it } from 'vitest'

import { buildSimLedger } from './import-ghostfolio-sim.js'

describe('buildSimLedger', () => {
  it('aggregates open Ghostfolio buy/sell activities into a sim ledger', () => {
    const ledger = buildSimLedger({
      accounts: [{ balance: 369.52, currency: 'USD' }],
      activities: [
        { type: 'BUY', symbol: 'NVDA', currency: 'USD', quantity: 3, unitPrice: 175.05 },
        { type: 'SELL', symbol: 'NVDA', currency: 'USD', quantity: 3, unitPrice: 205 },
        { type: 'BUY', symbol: 'NVDA', currency: 'USD', quantity: 3, unitPrice: 219.2 },
        { type: 'BUY', symbol: 'CARL-B.CO', currency: 'DKK', quantity: 3, unitPrice: 887 },
        { type: 'DIVIDEND', symbol: 'NVDA', currency: 'USD', quantity: 1, unitPrice: 1 }
      ]
    })

    expect(ledger.cash).toBe('369.52')
    expect(ledger.positions).toEqual([
      {
        aliceId: 'sim|CARL-B.CO',
        symbol: 'CARL-B.CO',
        secType: 'STK',
        exchange: 'SMART',
        currency: 'DKK',
        side: 'long',
        quantity: '3',
        avgCost: '887'
      },
      {
        aliceId: 'sim|NVDA',
        symbol: 'NVDA',
        secType: 'STK',
        exchange: 'SMART',
        currency: 'USD',
        side: 'long',
        quantity: '3',
        avgCost: '219.2'
      }
    ])
  })
})
