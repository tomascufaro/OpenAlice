import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Decimal from 'decimal.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Contract, Order, coerceSecType } from '@traderalice/ibkr'
import { SimBroker } from './SimBroker.js'
import { SimLedger } from './SimLedger.js'
import type { QuoteFetcher } from './sim-types.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'openalice-sim-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function makeContract(symbol = 'AAPL'): Contract {
  const c = new Contract()
  c.symbol = symbol
  c.secType = coerceSecType('STK')
  c.exchange = 'SMART'
  c.currency = 'USD'
  c.aliceId = `sim|${symbol}`
  return c
}

function makeOrder(action: 'BUY' | 'SELL', orderType: string, qty: number, price?: number): Order {
  const o = new Order()
  o.action = action
  o.orderType = orderType
  o.totalQuantity = new Decimal(qty)
  if (orderType === 'LMT' && price != null) o.lmtPrice = new Decimal(price)
  if (orderType === 'STP' && price != null) o.auxPrice = new Decimal(price)
  return o
}

function makeBroker(opts: {
  id?: string
  initialCash?: number
  slippageBps?: number
  commissionPerTrade?: number
  quoteFetcher?: QuoteFetcher
  ledgerPath?: string
} = {}): SimBroker {
  return SimBroker.fromConfig(
    {
      id: opts.id ?? 'test-sim',
      label: 'Test Sim',
      brokerConfig: {
        initialCash: opts.initialCash ?? 100_000,
        currency: 'USD',
        slippageBps: opts.slippageBps ?? 0,
        commissionPerTrade: opts.commissionPerTrade ?? 0,
      },
    },
    {
      quoteFetcher: opts.quoteFetcher ?? (async () => 100),
      ledger: new SimLedger(opts.id ?? 'test-sim', opts.ledgerPath ?? join(tempDir, 'sim-ledger.json')),
    },
  )
}

describe('SimBroker persistent paper account', () => {
  it('fills market orders immediately and returns filled quantity and price', async () => {
    const broker = makeBroker({ quoteFetcher: async () => 150 })
    await broker.init()

    const result = await broker.placeOrder(makeContract(), makeOrder('BUY', 'MKT', 10))

    expect(result).toMatchObject({
      success: true,
      orderId: 'sim-ord-1',
      filledQty: '10',
      filledPrice: '150',
    })
    expect(result.orderState?.status).toBe('Filled')

    const account = await broker.getAccount()
    expect(account.totalCashValue).toBe('98500.00')
    const order = await broker.getOrder('sim-ord-1')
    expect(order?.orderId).toBe('sim-ord-1')
    expect(order?.order.filledQuantity?.toString()).toBe('10')
    expect(order?.avgFillPrice).toBe('150')
  })

  it('persists cash, positions, filled orders, and the next order id', async () => {
    const ledgerPath = join(tempDir, 'persistent-ledger.json')
    const first = makeBroker({ ledgerPath, quoteFetcher: async () => 100 })
    await first.init()
    await first.placeOrder(makeContract(), makeOrder('BUY', 'MKT', 2))
    await first.close()

    const second = makeBroker({ ledgerPath, quoteFetcher: async () => 110 })
    await second.init()

    const positions = await second.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toString()).toBe('2')
    expect(positions[0].avgCost).toBe('100.000000')
    expect((await second.getAccount()).totalCashValue).toBe('99800.00')

    const result = await second.placeOrder(makeContract('MSFT'), makeOrder('BUY', 'MKT', 1))
    expect(result.orderId).toBe('sim-ord-2')
  })

  it('rejects buys that would overdraw cash', async () => {
    const broker = makeBroker({ initialCash: 1500, commissionPerTrade: 1, quoteFetcher: async () => 200 })
    await broker.init()

    const result = await broker.placeOrder(makeContract(), makeOrder('BUY', 'MKT', 8))

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Insufficient cash/)
    expect((await broker.getPositions())).toHaveLength(0)
    expect((await broker.getAccount()).totalCashValue).toBe('1500.00')
  })

  it('rejects sells that would open a short position', async () => {
    const broker = makeBroker({ quoteFetcher: async () => 100 })
    await broker.init()

    const result = await broker.placeOrder(makeContract(), makeOrder('SELL', 'MKT', 1))

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/does not open short positions/)
  })

  it('fills limit orders lazily when quotes cross and exposes them through getOrders', async () => {
    const quote = vi.fn<QuoteFetcher>().mockResolvedValue(105)
    const broker = makeBroker({ quoteFetcher: quote })
    await broker.init()

    const placed = await broker.placeOrder(makeContract(), makeOrder('BUY', 'LMT', 3, 100))
    expect(placed.orderState?.status).toBe('Submitted')
    expect(await broker.getOpenOrders()).toHaveLength(1)

    quote.mockResolvedValue(99)
    const synced = await broker.getOrders(['sim-ord-1'])

    expect(synced).toHaveLength(1)
    expect(synced[0].orderState.status).toBe('Filled')
    expect(synced[0].order.filledQuantity?.toString()).toBe('3')
    expect(synced[0].avgFillPrice).toBe('100')
    expect(await broker.getOpenOrders()).toHaveLength(0)
  })

  it('applies market slippage and commission to account math', async () => {
    const broker = makeBroker({
      slippageBps: 100,
      commissionPerTrade: 5,
      quoteFetcher: async () => 100,
    })
    await broker.init()

    const result = await broker.placeOrder(makeContract(), makeOrder('BUY', 'MKT', 1))

    expect(result.filledPrice).toBe('101')
    expect((await broker.getAccount()).totalCashValue).toBe('99894.00')
  })
})
