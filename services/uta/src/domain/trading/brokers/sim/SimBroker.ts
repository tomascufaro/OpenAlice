import { z } from 'zod'
import Decimal from 'decimal.js'
import {
  Contract,
  ContractDescription,
  ContractDetails,
  Order,
  OrderState,
  UNSET_DECIMAL,
  coerceSecType,
} from '@traderalice/ibkr'
import type {
  IBroker,
  AccountCapabilities,
  AccountInfo,
  Position,
  PlaceOrderResult,
  OpenOrder,
  Quote,
  MarketClock,
  TpSlParams,
} from '../types.js'
import type {
  QuoteFetcher,
  SimBrokerConfig,
  SimPosition,
  SimOrder,
} from './sim-types.js'
import { SimLedger } from './SimLedger.js'
import '../../contract-ext.js'

interface InternalPosition {
  contract: Contract
  side: 'long'
  quantity: Decimal
  avgCost: Decimal
}

interface InternalOrder {
  id: string
  contract: Contract
  order: Order
  status: 'Submitted' | 'Filled' | 'Cancelled'
  fillPrice?: Decimal
  filledQuantity?: Decimal
}

export interface SimDeps {
  quoteFetcher?: QuoteFetcher
  ledger?: SimLedger
}

const DEFAULT_QUOTE_FETCHER: QuoteFetcher = async () => {
  throw new Error('No quoteFetcher configured for SimBroker')
}

const CAPABILITIES: AccountCapabilities = {
  supportedSecTypes: ['STK', 'ETF'],
  supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT'],
}

export class SimBroker implements IBroker {
  static configSchema = z.object({
    initialCash: z.coerce.number().positive().default(100_000),
    currency: z.string().default('USD'),
    slippageBps: z.coerce.number().min(0).default(5),
    commissionPerTrade: z.coerce.number().min(0).default(1),
  })

  static fromConfig(
    config: { id: string; label?: string; brokerConfig: Record<string, unknown> },
    simDeps?: SimDeps,
  ): SimBroker {
    const parsed = SimBroker.configSchema.parse(config.brokerConfig) as SimBrokerConfig
    return new SimBroker(
      config.id,
      config.label ?? config.id,
      parsed,
      simDeps?.quoteFetcher ?? DEFAULT_QUOTE_FETCHER,
      simDeps?.ledger,
    )
  }

  readonly id: string
  readonly label: string

  private _cash: Decimal
  private _realizedPnL = new Decimal(0)
  private _positions = new Map<string, InternalPosition>()
  private _orders = new Map<string, InternalOrder>()
  private _nextOrderId = 1
  private readonly _ledger: SimLedger

  constructor(
    id: string,
    label: string,
    private readonly _config: SimBrokerConfig,
    private readonly _quoteFetcher: QuoteFetcher = DEFAULT_QUOTE_FETCHER,
    ledger?: SimLedger,
  ) {
    this.id = id
    this.label = label
    this._cash = new Decimal(_config.initialCash)
    this._ledger = ledger ?? new SimLedger(id)
  }

  async init(): Promise<void> {
    const saved = await this._ledger.load()
    if (!saved) {
      await this._saveLedger()
      return
    }

    this._cash = new Decimal(saved.cash)
    this._realizedPnL = new Decimal(saved.realizedPnL)
    this._nextOrderId = saved.nextOrderId ?? this._nextOrderId

    for (const p of saved.positions) {
      this._positions.set(p.aliceId, {
        contract: this._contractFromSim(p),
        side: 'long',
        quantity: new Decimal(p.quantity),
        avgCost: new Decimal(p.avgCost),
      })
    }

    for (const o of saved.orders) {
      const contract = this._contractFromOrder(o)
      const order = this._orderFromSim(o)
      this._orders.set(o.id, {
        id: o.id,
        contract,
        order,
        status: o.status,
        fillPrice: o.fillPrice ? new Decimal(o.fillPrice) : undefined,
        filledQuantity: o.filledQuantity ? new Decimal(o.filledQuantity) : undefined,
      })
      const num = parseInt(o.id.replace('sim-ord-', ''), 10)
      if (!isNaN(num) && num >= this._nextOrderId) this._nextOrderId = num + 1
    }
  }

  async close(): Promise<void> {
    await this._saveLedger()
  }

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    const desc = new ContractDescription()
    const c = new Contract()
    c.symbol = pattern.toUpperCase()
    c.secType = 'STK'
    c.currency = this._config.currency
    desc.contract = c
    return [desc]
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const details = new ContractDetails()
    details.contract = query
    details.longName = query.symbol ?? 'Simulated Contract'
    return details
  }

  async placeOrder(contract: Contract, order: Order, _tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    const orderId = `sim-ord-${this._nextOrderId++}`
    const type = order.orderType ?? 'MKT'
    const action = order.action.toUpperCase() as 'BUY' | 'SELL'
    const qty = !order.totalQuantity.equals(UNSET_DECIMAL)
      ? order.totalQuantity
      : new Decimal(0)

    if (!qty.gt(0)) return { success: false, error: 'Order quantity must be greater than zero' }

    if (type === 'MKT') {
      let fillPrice: Decimal
      try {
        const rawPrice = await this._fetchPrice(contract)
        fillPrice = this._withSlippage(rawPrice, action)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }

      const cloned = this._cloneOrder(order, orderId)
      this._orders.set(orderId, { id: orderId, contract, order: cloned, status: 'Submitted' })
      const error = this._applyFill(contract, action, qty, fillPrice, orderId)
      if (error) {
        this._orders.delete(orderId)
        return { success: false, error }
      }
      await this._saveLedger()

      const orderState = new OrderState()
      orderState.status = 'Filled'
      return {
        success: true,
        orderId,
        orderState,
        filledQty: qty.toString(),
        filledPrice: fillPrice.toString(),
      }
    }

    const cloned = this._cloneOrder(order, orderId)
    this._orders.set(orderId, { id: orderId, contract, order: cloned, status: 'Submitted' })
    await this._saveLedger()

    const orderState = new OrderState()
    orderState.status = 'Submitted'
    return { success: true, orderId, orderState }
  }

  async modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult> {
    const internal = this._orders.get(orderId)
    if (!internal || internal.status !== 'Submitted') {
      return { success: false, error: `Order ${orderId} not found or not pending` }
    }

    if (changes.lmtPrice != null && !changes.lmtPrice.equals(UNSET_DECIMAL)) internal.order.lmtPrice = changes.lmtPrice
    if (changes.auxPrice != null && !changes.auxPrice.equals(UNSET_DECIMAL)) internal.order.auxPrice = changes.auxPrice
    if (changes.totalQuantity != null && !changes.totalQuantity.equals(UNSET_DECIMAL)) internal.order.totalQuantity = changes.totalQuantity
    if (changes.orderType) internal.order.orderType = changes.orderType
    if (changes.tif) internal.order.tif = changes.tif
    await this._saveLedger()

    const orderState = new OrderState()
    orderState.status = 'Submitted'
    return { success: true, orderId, orderState }
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    const internal = this._orders.get(orderId)
    if (!internal || internal.status !== 'Submitted') {
      return { success: false, error: `Order ${orderId} not found or not pending` }
    }
    internal.status = 'Cancelled'
    await this._saveLedger()

    const orderState = new OrderState()
    orderState.status = 'Cancelled'
    return { success: true, orderId, orderState }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const key = this.getNativeKey(contract)
    const pos = this._positions.get(key)
    if (!pos) return { success: false, error: `No open position for ${key}` }

    const order = new Order()
    order.action = 'SELL'
    order.orderType = 'MKT'
    order.totalQuantity = quantity ?? pos.quantity
    return this.placeOrder(pos.contract, order)
  }

  async getAccount(): Promise<AccountInfo> {
    await this._checkPendingFills()
    let marketValue = new Decimal(0)
    let unrealizedPnL = new Decimal(0)

    for (const pos of this._positions.values()) {
      const price = await this._safePrice(pos.contract, pos.avgCost)
      const multiplier = this._multiplier(pos.contract)
      const posValue = pos.quantity.mul(price).mul(multiplier)
      marketValue = marketValue.plus(posValue)
      unrealizedPnL = unrealizedPnL.plus(pos.quantity.mul(price.minus(pos.avgCost)).mul(multiplier))
    }

    return {
      baseCurrency: this._config.currency,
      netLiquidation: this._cash.plus(marketValue).toFixed(2),
      totalCashValue: this._cash.toFixed(2),
      unrealizedPnL: unrealizedPnL.toFixed(2),
      realizedPnL: this._realizedPnL.toFixed(2),
    }
  }

  async getPositions(): Promise<Position[]> {
    await this._checkPendingFills()
    const result: Position[] = []

    for (const pos of this._positions.values()) {
      const price = await this._safePrice(pos.contract, pos.avgCost)
      const multiplier = this._multiplier(pos.contract)
      result.push({
        contract: pos.contract,
        currency: pos.contract.currency || this._config.currency,
        side: pos.side,
        quantity: pos.quantity,
        avgCost: pos.avgCost.toFixed(6),
        marketPrice: price.toFixed(6),
        marketValue: pos.quantity.mul(price).mul(multiplier).toFixed(2),
        unrealizedPnL: pos.quantity.mul(price.minus(pos.avgCost)).mul(multiplier).toFixed(2),
        realizedPnL: '0',
        multiplier: multiplier.toString(),
      })
    }
    return result
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    await this._checkPendingFills()
    const results: OpenOrder[] = []
    for (const id of orderIds) {
      const order = await this.getOrder(id)
      if (order) results.push(order)
    }
    return results
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    const internal = this._orders.get(orderId)
    return internal ? this._toOpenOrder(internal) : null
  }

  async getOpenOrders(): Promise<OpenOrder[]> {
    await this._checkPendingFills()
    return [...this._orders.values()]
      .filter(o => o.status === 'Submitted')
      .map(o => this._toOpenOrder(o))
  }

  async getQuote(contract: Contract): Promise<Quote> {
    const price = await this._fetchPrice(contract)
    return {
      contract,
      last: price.toString(),
      bid: price.mul(0.9999).toString(),
      ask: price.mul(1.0001).toString(),
      volume: '0',
      timestamp: new Date(),
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    return { isOpen: true }
  }

  getCapabilities(): AccountCapabilities {
    return CAPABILITIES
  }

  getNativeKey(contract: Contract): string {
    return contract.aliceId?.split('|').at(-1) ?? contract.symbol ?? ''
  }

  resolveNativeKey(nativeKey: string): Contract {
    const c = new Contract()
    c.symbol = nativeKey
    c.secType = 'STK'
    c.currency = this._config.currency
    return c
  }

  private async _checkPendingFills(): Promise<void> {
    const pending = [...this._orders.values()].filter(o => o.status === 'Submitted')
    if (pending.length === 0) return

    let changed = false
    for (const internal of pending) {
      const type = internal.order.orderType
      if (type !== 'LMT' && type !== 'STP' && type !== 'STP LMT') continue

      let price: Decimal
      try {
        price = await this._fetchPrice(internal.contract)
      } catch {
        continue
      }

      const action = internal.order.action.toUpperCase() as 'BUY' | 'SELL'
      const qty = internal.order.totalQuantity
      const fillAt = this._crossedPrice(type, action, price, internal.order)
      if (!fillAt) continue

      const error = this._applyFill(internal.contract, action, qty, fillAt, internal.id)
      if (!error) changed = true
    }

    if (changed) await this._saveLedger()
  }

  private _crossedPrice(
    orderType: string | undefined,
    action: 'BUY' | 'SELL',
    price: Decimal,
    order: Order,
  ): Decimal | null {
    if (orderType === 'LMT' && !order.lmtPrice.equals(UNSET_DECIMAL)) {
      if (action === 'BUY' && price.lte(order.lmtPrice)) return order.lmtPrice
      if (action === 'SELL' && price.gte(order.lmtPrice)) return order.lmtPrice
    }
    if (orderType === 'STP' && !order.auxPrice.equals(UNSET_DECIMAL)) {
      if (action === 'BUY' && price.gte(order.auxPrice)) return order.auxPrice
      if (action === 'SELL' && price.lte(order.auxPrice)) return order.auxPrice
    }
    if (orderType === 'STP LMT' && !order.auxPrice.equals(UNSET_DECIMAL) && !order.lmtPrice.equals(UNSET_DECIMAL)) {
      const crossed = (action === 'BUY' && price.gte(order.auxPrice)) || (action === 'SELL' && price.lte(order.auxPrice))
      if (crossed) return order.lmtPrice
    }
    return null
  }

  private _applyFill(
    contract: Contract,
    action: 'BUY' | 'SELL',
    qty: Decimal,
    fillPrice: Decimal,
    orderId: string,
  ): string | null {
    const key = this.getNativeKey(contract)
    const multiplier = this._multiplier(contract)
    const commission = new Decimal(this._config.commissionPerTrade)
    const tradeValue = qty.mul(fillPrice).mul(multiplier)
    const existing = this._positions.get(key)

    if (action === 'BUY') {
      const totalCost = tradeValue.plus(commission)
      if (this._cash.lt(totalCost)) {
        return `Insufficient cash: need ${totalCost.toFixed(2)} ${this._config.currency}, available ${this._cash.toFixed(2)}`
      }
    } else {
      if (!existing || existing.quantity.lt(qty)) {
        return `Cannot sell ${qty.toString()} ${key}: simulated broker does not open short positions`
      }
    }

    this._cash = action === 'BUY'
      ? this._cash.minus(tradeValue).minus(commission)
      : this._cash.plus(tradeValue).minus(commission)

    if (action === 'BUY') {
      if (!existing) {
        this._positions.set(key, { contract, side: 'long', quantity: qty, avgCost: fillPrice })
      } else {
        const totalCost = existing.avgCost.mul(existing.quantity).plus(fillPrice.mul(qty))
        existing.quantity = existing.quantity.plus(qty)
        existing.avgCost = totalCost.div(existing.quantity)
      }
    } else if (existing) {
      const pnl = fillPrice.minus(existing.avgCost).mul(qty).mul(multiplier)
      this._realizedPnL = this._realizedPnL.plus(pnl)
      const remaining = existing.quantity.minus(qty)
      if (remaining.lte(0)) this._positions.delete(key)
      else existing.quantity = remaining
    }

    const internal = this._orders.get(orderId)
    if (internal) {
      internal.status = 'Filled'
      internal.fillPrice = fillPrice
      internal.filledQuantity = qty
      internal.order.filledQuantity = qty
    }

    return null
  }

  private async _saveLedger(): Promise<void> {
    const positions: SimPosition[] = []
    for (const [aliceId, pos] of this._positions) {
      positions.push({
        aliceId,
        symbol: pos.contract.symbol ?? '',
        secType: pos.contract.secType ?? 'STK',
        exchange: pos.contract.exchange ?? '',
        currency: pos.contract.currency ?? this._config.currency,
        side: pos.side,
        quantity: pos.quantity.toString(),
        avgCost: pos.avgCost.toString(),
      })
    }

    const orders: SimOrder[] = []
    for (const o of this._orders.values()) {
      const aliceId = this.getNativeKey(o.contract)
      orders.push({
        id: o.id,
        aliceId,
        symbol: o.contract.symbol ?? aliceId,
        secType: o.contract.secType ?? 'STK',
        exchange: o.contract.exchange ?? '',
        currency: o.contract.currency ?? this._config.currency,
        action: o.order.action.toUpperCase() as 'BUY' | 'SELL',
        orderType: o.order.orderType ?? 'MKT',
        quantity: o.order.totalQuantity.toString(),
        limitPrice: !o.order.lmtPrice.equals(UNSET_DECIMAL) ? o.order.lmtPrice.toString() : undefined,
        stopPrice: !o.order.auxPrice.equals(UNSET_DECIMAL) ? o.order.auxPrice.toString() : undefined,
        status: o.status,
        fillPrice: o.fillPrice?.toString(),
        filledQuantity: o.filledQuantity?.toString(),
        ts: Date.now(),
      })
    }

    await this._ledger.save({
      accountId: this.id,
      cash: this._cash.toString(),
      currency: this._config.currency,
      positions,
      orders,
      realizedPnL: this._realizedPnL.toString(),
      nextOrderId: this._nextOrderId,
    })
  }

  private _toOpenOrder(internal: InternalOrder): OpenOrder {
    const orderState = new OrderState()
    orderState.status = internal.status
    if (internal.filledQuantity) internal.order.filledQuantity = internal.filledQuantity

    return {
      contract: internal.contract,
      order: internal.order,
      orderState,
      orderId: internal.id,
      avgFillPrice: internal.fillPrice?.toString(),
    }
  }

  private async _fetchPrice(contract: Contract): Promise<Decimal> {
    const price = new Decimal(await this._quoteFetcher(contract))
    if (!price.isFinite() || price.lte(0)) {
      throw new Error(`No positive quote available for ${contract.symbol ?? this.getNativeKey(contract)}`)
    }
    return price
  }

  private async _safePrice(contract: Contract, fallback: Decimal): Promise<Decimal> {
    try {
      return await this._fetchPrice(contract)
    } catch {
      return fallback
    }
  }

  private _withSlippage(price: Decimal, action: 'BUY' | 'SELL'): Decimal {
    const slip = new Decimal(this._config.slippageBps).div(10_000)
    return action === 'BUY' ? price.mul(new Decimal(1).plus(slip)) : price.mul(new Decimal(1).minus(slip))
  }

  private _multiplier(contract: Contract): Decimal {
    return new Decimal(contract.multiplier || '1')
  }

  private _contractFromSim(p: { aliceId: string; symbol: string; secType: string; exchange: string; currency: string }): Contract {
    const c = new Contract()
    c.aliceId = p.aliceId
    c.symbol = p.symbol
    c.secType = coerceSecType(p.secType)
    c.exchange = p.exchange
    c.currency = p.currency
    return c
  }

  private _contractFromOrder(o: SimOrder): Contract {
    return this._contractFromSim({
      aliceId: o.aliceId,
      symbol: o.symbol,
      secType: o.secType,
      exchange: o.exchange,
      currency: o.currency,
    })
  }

  private _orderFromSim(o: SimOrder): Order {
    const order = new Order()
    order.action = o.action
    order.orderType = o.orderType
    order.totalQuantity = new Decimal(o.quantity)
    if (o.limitPrice) order.lmtPrice = new Decimal(o.limitPrice)
    if (o.stopPrice) order.auxPrice = new Decimal(o.stopPrice)
    if (o.filledQuantity) order.filledQuantity = new Decimal(o.filledQuantity)
    order.orderId = parseInt(o.id.replace('sim-ord-', ''), 10) || 0
    return order
  }

  private _cloneOrder(order: Order, orderId: string): Order {
    const o = new Order()
    o.action = order.action
    o.orderType = order.orderType
    o.totalQuantity = order.totalQuantity
    o.tif = order.tif
    if (!order.lmtPrice.equals(UNSET_DECIMAL)) o.lmtPrice = order.lmtPrice
    if (!order.auxPrice.equals(UNSET_DECIMAL)) o.auxPrice = order.auxPrice
    o.orderId = parseInt(orderId.replace('sim-ord-', ''), 10) || 0
    return o
  }
}
