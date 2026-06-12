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

### Phase 2 - Ledger Persistence

- Save ledger on fills, order changes, and close.
- Load cash, positions, realized PnL, pending orders, and next order ID on init.
- Add focused tests around restart persistence.

Acceptance:

- Buy in SIM, restart UTA, position remains.
- Pending order survives restart.
- Initial cash only applies when no ledger exists.

### Phase 3 - Trading Behavior

- Implement MKT/LMT/STP/STP LMT behavior against current order result conventions.
- Ensure oversell/insufficient cash behavior is explicit.
- Ensure filled results project into trade history.

Acceptance:

- Stage -> commit -> push on SIM creates history rows.
- Open orders and trade history show expected data.
- Failed fills return readable errors.

### Phase 4 - Valuation and Quotes

- Wire quote fetcher to current market-data path.
- Decide fallback policy for missing prices.
- Add tests with a fake quote fetcher.

Acceptance:

- Account equity changes with quote changes.
- Position market price comes from the quote fetcher.
- Missing quote does not produce fake fills.

### Phase 5 - UI and Config

- Ensure `sim` preset appears in the appropriate testing/paper category.
- Ensure the normal Trading and UTA pages work for SIM.
- Do not add SIM to Dev -> Simulator unless there is a clear read-only reason.

Acceptance:

- User can create a persistent SIM account from the config UI.
- User can place paper orders through the normal order-entry flow.
- User can view persistent history through existing order/trade tabs.

## Risks

- Quote fetching now crosses process boundaries differently than the old implementation.
- Current `master` may expect more precise order-sync behavior than old SIM exposed.
- The data-root move means old local ledgers may need a one-time migration or clear manual instructions.
- Reintroducing old journal/debate code would fight current architecture; keep this port small.

## Recommended First PR

Keep the first PR narrow:

- Persistent `sim` broker
- preset and registry wiring
- ledger persistence tests
- simple MKT order test
- no journal
- no debate
- no custom UI beyond existing preset/config flow

After that lands, add pending-order behavior and quote integration in follow-up commits.
