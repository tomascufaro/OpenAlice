import type { Contract } from '@traderalice/ibkr'
import type Decimal from 'decimal.js'

export type QuoteFetcher = (contract: Contract) => Promise<number | string | Decimal>

export interface SimBrokerConfig {
  initialCash: number
  currency: string
  slippageBps: number
  commissionPerTrade: number
}

export interface SimPosition {
  aliceId: string
  symbol: string
  secType: string
  exchange: string
  currency: string
  side: 'long' | 'short'
  quantity: string
  avgCost: string
}

export interface SimOrder {
  id: string
  aliceId: string
  symbol: string
  secType: string
  exchange: string
  currency: string
  action: 'BUY' | 'SELL'
  orderType: string
  quantity: string
  limitPrice?: string
  stopPrice?: string
  status: 'Submitted' | 'Filled' | 'Cancelled'
  fillPrice?: string
  filledQuantity?: string
  ts: number
}

export interface SimLedgerState {
  accountId: string
  cash: string
  currency: string
  positions: SimPosition[]
  orders: SimOrder[]
  realizedPnL: string
  nextOrderId?: number
}
