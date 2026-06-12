# Persistent SIM Portfolio Port Plan

## Goal

Port the useful persistent SIM portfolio behavior from `personal/openalice` onto current `master`, without porting the old sim journal.

The desired outcome is:

- A configurable `sim` broker account exists separately from the in-memory `mock-simulator`.
- The `sim` broker persists cash, positions, realized PnL, and pending orders across restarts.
- Market orders fill using current market data.
- Limit/stop orders can remain pending and fill when price conditions are observed.
- SIM account activity uses the current Trading-as-Git commit log, order history, and trade history.

Non-goals:

- Do not port `sim-journal`.
- Do not port the old debate tool as part of this project.
- Do not replace `mock-simulator`; it remains the dev/test god-view simulator.

## Source Material

Useful commits from `personal/openalice`:

- `58e94f0c` - SimBroker + DecisionJournal + multi-agent debate
- `74d05e64` - Sim current-price fix

Primary old files to inspect:

- `services/uta/src/domain/trading/brokers/sim/SimBroker.ts`
- `services/uta/src/domain/trading/brokers/sim/SimLedger.ts`
- `services/uta/src/domain/trading/brokers/sim/sim-types.ts`
- old edits to `brokers/factory.ts`
- old edits to preset catalog / preset tests
- old quote-fetcher wiring in `src/main.ts` or UTA bootstrap

Do not port:

- `services/uta/src/domain/trading/sim-journal.ts`
- `services/uta/src/http/routes-sim-journal.ts`
- `src/tool/debate.ts`
- `src/domain/analysis/debate/*`
- `ui/src/api/sim-journal.ts`

## Current Architecture Touch Points

Broker registration:

- `services/uta/src/domain/trading/brokers/registry.ts`
- `services/uta/src/domain/trading/brokers/factory.ts`
- `packages/uta-protocol/src/brokers/preset-catalog.ts`
- `packages/uta-protocol/src/brokers/presets.ts`

Persistence:

- current data root helpers in `src/core/paths.ts`
- UTA service runtime paths
- credential/data relocation changes in current `master`

Market data / quotes:

- `src/services/uta-client/*`
- `src/domain/market-data/hub-data.ts`
- current UTA/Alice boundary
- current tool/market data APIs

Trading history:

- `services/uta/src/domain/trading/git/TradingGit.ts`
- `services/uta/src/domain/trading/order-history.ts`
- `services/uta/src/domain/trading/cost-basis.ts`
- `services/uta/src/domain/trading/snapshot/*`

## Design Notes

### SIM vs Mock Simulator

Keep both concepts:

- `mock-simulator`: in-memory, manually driven, Dev -> Simulator control panel, wiped on restart.
- `sim`: persistent paper broker, normal UTA account, intended for ongoing paper trading.

The UI should not present them as the same thing.

Suggested preset labels:

- `Sim Broker (Paper)` for persistent SIM.
- `Simulator (testing only)` for mock simulator.

### Persistence

The old ledger path was:

```text
data/trading/<accountId>/sim-ledger.json
```

Current `master` moved toward `OPENALICE_HOME` / `~/.openalice`. The port must use the current data-path helper instead of hard-coded repo-relative `data/...`.

Suggested logical path:

```text
<OPENALICE_HOME>/trading/<accountId>/sim-ledger.json
```

Use the central path helper, not `resolve("data/...")`.

### Quote Fetching

Old `SimBroker` depended on an injected `QuoteFetcher`.

Preserve this idea if possible: broker construction receives a quote fetcher from UTA bootstrap or a broker service dependency.

The quote fetcher should:

- resolve the broker contract into a market-data query
- return a Decimal-safe price string or number
- fail clearly when no quote is available

For market orders:

- if no quote is available, reject the order
- do not silently fill at `100`

For account valuation:

- if quote is temporarily unavailable, either use avg cost with a warning or expose stale valuation clearly

### Order Behavior

Expected behavior:

- MKT fills immediately at quote plus configurable slippage.
- LMT/STP/STP LMT orders are stored as pending.
- Pending fills are checked lazily during account/positions/order reads, or by an explicit sync path.
- Order results must populate current fields used by order history:
  - `orderId`
  - `status`
  - `filledQty`
  - `filledPrice`
  - `error`

Use current `OrderHistoryEntry` and `TradeHistoryEntry` projections. Do not write a separate fill journal.

### Commit Messages Are the Decision Journal

Current `master` already treats TradingGit commit messages as the decision record.

That means a paper trade should be entered with a useful message:

```text
Entry: long AAPL on momentum; invalidation below 190
```

This is enough for general decision history. A future richer journal should be broker-agnostic and linked to `commitHash`, not SIM-only.

## Implementation Milestones

## ASDD / TDD Strategy

Build this port from the outside in:

1. Define acceptance scenarios at the UTA boundary.
2. Encode each scenario as a failing spec before implementation.
3. Implement only enough broker behavior to satisfy the next failing spec.
4. Keep unit tests below the acceptance layer focused on edge cases and accounting math.

The goal is to avoid re-porting the old `SimBroker` wholesale and accidentally bringing back stale architecture. Tests should describe the behavior current `master` needs from a persistent paper broker.

## Acceptance Scenarios

These are the scenarios that define "persistent SIM is done."

### AS-1 - Fresh Account Starts With Configured Cash

Given a `sim` UTA config with `initialCash: 1500` and no ledger file,
when the UTA starts and `getAccount` is called,
then account cash and net liquidation are `1500.00`,
positions are empty,
orders are empty,
and no broker journal file is created.

Primary spec:

- `services/uta/src/domain/trading/brokers/sim/SimBroker.spec.ts`

Secondary specs:

- preset/factory config spec proving a `sim` UTA can instantiate from config

### AS-2 - Market Buy Persists Across Restart

Given a fresh `sim` account with `1500` cash and quote `AAPL = 100`,
when a BUY MKT order for 2 AAPL is placed through UTA stage -> commit -> push,
then the order fills at the quote-adjusted price,
cash decreases,
the position appears,
order history contains the committed decision message,
trade history contains one fill,
and after broker restart the account reloads the same cash/position state from the ledger.

Primary spec:

- `services/uta/src/domain/trading/UnifiedTradingAccount.spec.ts` or a new focused SIM UTA integration spec

Supporting specs:

- `SimLedger.spec.ts` for round-trip persistence
- `SimBroker.spec.ts` for direct broker behavior

### AS-3 - Pending Limit Order Survives Restart And Fills Later

Given quote `AAPL = 100`,
when a BUY LMT order at `95` is pushed,
then it remains submitted and appears in open orders.

When the broker restarts,
then the pending order still appears.

When the quote later becomes `94` and order sync/read is triggered,
then the order fills,
cash and position update,
order history resolves to `filled`,
and trade history records the fill.

Primary spec:

- SIM UTA integration spec, because this must validate TradingGit/order-history projection behavior.

### AS-4 - Missing Quote Rejects Market Order

Given a `sim` account and no quote for the target contract,
when a BUY MKT order is pushed,
then the order is rejected with a clear error,
cash and positions are unchanged,
and order history shows the rejection.

Primary spec:

- `SimBroker.spec.ts`
- UTA integration spec for history projection

### AS-5 - Oversell And Cash Constraints Are Explicit

Given no AAPL position,
when a SELL order is attempted,
then the order fails clearly unless shorting is explicitly supported.

Given insufficient cash,
when a BUY would exceed cash,
then the order fails clearly.

Acceptance decision:

- For the first port, do not support short selling.
- Enforce cash constraints unless a future margin mode is explicitly added.

Primary spec:

- `SimBroker.spec.ts`

### AS-6 - Normal UI/API Surfaces Work Without Custom SIM UI

Given a configured `sim` UTA,
when the existing Trading page and UTA detail page query account, positions, orders, order history, and trade history,
then responses conform to the same API contracts as other brokers.

Primary specs:

- existing route specs if sufficient
- add one route-level test only if current coverage misses `sim`

Non-goal:

- Do not add `sim` to Dev -> Simulator controls.

## Test Plan

### Unit Specs

`services/uta/src/domain/trading/brokers/sim/SimLedger.spec.ts`

- loads `null` when no ledger exists
- saves and loads cash, realized PnL, positions, pending orders, and next order ID
- uses the current data-root helper, not repo-relative `data/...`
- tolerates missing optional fields only if backward compatibility is intentionally supported

`services/uta/src/domain/trading/brokers/sim/SimBroker.spec.ts`

- fresh account uses configured initial cash
- MKT BUY fills from injected quote fetcher
- MKT SELL closes an existing long and records realized PnL
- missing quote rejects MKT order
- insufficient cash rejects BUY
- oversell rejects SELL
- LMT BUY remains submitted above limit and fills when quote crosses
- LMT SELL remains submitted below limit and fills when quote crosses
- STP / STP LMT behavior is either implemented with tests or explicitly not supported in `getCapabilities`
- pending orders survive broker restart
- all numeric fields are Decimal-safe strings where exposed

`services/uta/src/domain/trading/brokers/presets.spec.ts`

- `sim` preset exists
- config validates `initialCash`, `currency`, `slippageBps`, and `commissionPerTrade`
- `sim` is paper/testing and not confused with `mock-simulator`

### Integration Specs

Add a focused SIM integration spec near current UTA tests, for example:

```text
services/uta/src/domain/trading/__test__/e2e/uta-sim.e2e.spec.ts
```

or a non-e2e domain spec if the suite convention prefers no network/real IO.

Scenarios:

- create UTA with `SimBroker`, stage -> commit -> push a MKT order, assert account/positions/history/trades
- restart broker against same temp data root, assert state reloads
- push pending LMT, restart, cross quote, assert filled history/trade projection
- failed order appears as rejected history without mutating account

Use a deterministic fake quote fetcher. Do not call live market data in tests.

### Route / API Specs

Only add route-level tests if current route coverage does not already exercise generic broker behavior.

Possible checks:

- `/api/trading/uta/:id/account`
- `/api/trading/uta/:id/positions`
- `/api/trading/uta/:id/orders`
- `/api/trading/uta/:id/order-history`
- `/api/trading/uta/:id/trade-history`

These should prove SIM works through existing generic routes, not add SIM-specific routes.

### UI Validation

Use manual/browser smoke after backend tests pass:

- `sim` preset appears in config UI
- account detail page renders account cash/positions/orders/history
- normal order entry can stage a SIM order
- Dev -> Simulator still only lists `mock-simulator` accounts

Automated UI tests are optional for the first port unless a UI regression is likely.

## Implementation Milestones

### Phase 0 - Spec Harness

- Create temp-data-root helpers for SIM tests.
- Create a deterministic fake quote fetcher.
- Add failing AS-1 and AS-2 specs before copying old implementation.

Acceptance:

- Specs fail for missing `sim` support, not because the test harness is broken.

### Phase 1 - Broker Skeleton

- Copy old `SimBroker`, `SimLedger`, and types into the current `services/uta` broker directory.
- Update imports to current paths.
- Replace hard-coded ledger paths with current data-root helper.
- Register `sim` in the broker engine registry and protocol preset catalog.
- Remove all sim-journal and debate references.

Acceptance:

- Typecheck passes.
- A `sim` UTA config instantiates.
- `getAccount` returns configured initial cash with no ledger.
- AS-1 passes.

### Phase 2 - Ledger Persistence

- Save ledger on fills, order changes, and close.
- Load cash, positions, realized PnL, pending orders, and next order ID on init.
- Add focused tests around restart persistence.

Acceptance:

- Buy in SIM, restart UTA, position remains.
- Pending order survives restart.
- Initial cash only applies when no ledger exists.
- AS-2 restart checks pass.

### Phase 3 - Trading Behavior

- Implement MKT/LMT/STP/STP LMT behavior against current order result conventions.
- Ensure oversell/insufficient cash behavior is explicit.
- Ensure filled results project into trade history.

Acceptance:

- Stage -> commit -> push on SIM creates history rows.
- Open orders and trade history show expected data.
- Failed fills return readable errors.
- AS-3, AS-4, and AS-5 pass.

### Phase 4 - Valuation and Quotes

- Wire quote fetcher to current market-data path.
- Decide fallback policy for missing prices.
- Add tests with a fake quote fetcher.

Acceptance:

- Account equity changes with quote changes.
- Position market price comes from the quote fetcher.
- Missing quote does not produce fake fills.
- No test uses live network data.

### Phase 5 - UI and Config

- Ensure `sim` preset appears in the appropriate testing/paper category.
- Ensure the normal Trading and UTA pages work for SIM.
- Do not add SIM to Dev -> Simulator unless there is a clear read-only reason.

Acceptance:

- User can create a persistent SIM account from the config UI.
- User can place paper orders through the normal order-entry flow.
- User can view persistent history through existing order/trade tabs.
- AS-6 passes by API spec or manual smoke.

## Definition of Done

- All acceptance scenarios pass.
- No `sim-journal` files, routes, tools, or UI APIs are ported.
- `sim` and `mock-simulator` remain separate presets with separate purposes.
- The ledger uses current data-root helpers.
- TradingGit commit messages remain the decision record.
- Order history and trade history work for SIM without SIM-specific projections.
- Missing quote, insufficient cash, and oversell errors are explicit and tested.
- Existing mock simulator tests still pass.

## Risks

- Quote fetching now crosses process boundaries differently than the old implementation.
- Current `master` may expect more precise order-sync behavior than old SIM exposed.
- The data-root move means old local ledgers may need a one-time migration or clear manual instructions.
- Reintroducing old journal/debate code would fight current architecture; keep this port small.

## Recommended First PR

Keep the first PR narrow:

- Persistent `sim` broker
- preset and registry wiring
- AS-1 / AS-2 failing specs first, then implementation
- ledger persistence tests
- simple MKT order test
- no journal
- no debate
- no custom UI beyond existing preset/config flow

After that lands, add pending-order behavior and quote integration in follow-up commits.
