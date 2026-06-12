# IOL / Argentina Market Port Plan

## Goal

Port the useful IOL work from `personal/openalice` onto current `master` without reintroducing older OpenAlice architecture.

The desired outcome is:

- IOL can be configured as a UTA broker.
- Argentine equities can be discovered and resolved into tradable contracts.
- Argentine fixed-income discovery can be exposed where it fits the current market-data model.
- IOL accounts participate in the current Trading-as-Git, order history, trade history, health, snapshot, and UTA UI flows.

Non-goals:

- Do not restore legacy connector/web route architecture.
- Do not restore old aggregate market-data plumbing if current Data Hub/reference APIs provide a better extension point.
- Do not couple IOL to the SIM portfolio work.

## Source Material

Useful commits from `personal/openalice`:

- `e8c36fed` - Add IOL broker scaffold
- `16bd32b8` - Add IOL broker unit tests
- `0f8c79ac` - Add Yahoo Argentina equity discovery
- `2fa99b55` - Wire fixed-income discovery into market search
- `a0d65d95` - InvertirOnline broker + Argentine market support

Primary old files to inspect:

- `services/uta/src/domain/trading/brokers/iol/*`
- `src/domain/market-data/fixed-income/iol-fixed-income-client.ts`
- `packages/opentypebb/src/providers/yfinance/models/equity-search.ts`
- old edits to broker registry, preset catalog, contract search, and UI order-entry surfaces

## Current Architecture Touch Points

Broker registration:

- `services/uta/src/domain/trading/brokers/registry.ts`
- `services/uta/src/domain/trading/brokers/factory.ts`
- `services/uta/src/domain/trading/brokers/types.ts`
- `packages/uta-protocol/src/brokers/preset-catalog.ts`
- `packages/uta-protocol/src/brokers/presets.ts`

Trading behavior:

- `services/uta/src/domain/trading/UnifiedTradingAccount.ts`
- `services/uta/src/domain/trading/order-history.ts`
- `services/uta/src/domain/trading/order-sync-poller.ts`
- `services/uta/src/domain/trading/cost-basis.ts`
- `services/uta/src/domain/trading/snapshot/*`

Discovery and market data:

- `src/domain/market-data/reference/*`
- `src/domain/market-data/hub-data.ts`
- `src/tool/market.ts`
- `src/tool/trading.ts`
- `ui/src/pages/MarketDataPage.tsx`
- `ui/src/pages/TradingPage.tsx`

## Design Notes

### Broker Shape

IOL should be a normal broker engine under `services/uta`, not a special path.

Expected broker methods:

- `init`
- `close`
- `getAccount`
- `getPositions`
- `getOrders` / `getOrder`
- `placeOrder`
- `modifyOrder` if supported
- `cancelOrder`
- `searchContracts`
- `getContractDetails`
- `getQuote`
- `getMarketClock`
- `getCapabilities`
- `getNativeKey`
- `resolveNativeKey`

If IOL does not support a behavior, fail explicitly with a typed broker error or a clear `PlaceOrderResult` failure rather than silently pretending support.

### Contract Identity

Argentina instruments need stable identity.

For equities, the likely `aliceId` shape should be:

```text
iol-main|<market>:<symbol>
```

or another deterministic form compatible with `getNativeKey` / `resolveNativeKey`.

The implementation must preserve:

- display symbol
- market
- currency
- instrument type
- local/native symbol

Avoid encoding IOL-only details in places the generic UI assumes are IBKR-like fields unless there is already a local convention.

### Preset

Add an IOL preset to `packages/uta-protocol/src/brokers/preset-catalog.ts`.

Suggested config:

- `username`
- `password`
- `market`
- `sandbox` or `dryRun`

The preset should mark credentials as write-only and use fingerprint fields that do not include secrets.

### Fixed Income

Fixed income should not be forced through an equity-shaped API.

First decide whether current `master` has a generic enough market-data/tool path for fixed-income discovery. If not, keep the first port focused on Argentine equities and broker support, then add fixed income as a second phase.

## Implementation Milestones

### Phase 1 - Mechanical Port and Compile

- Copy the old IOL broker files into `services/uta/src/domain/trading/brokers/iol/`.
- Update imports to current paths.
- Register the broker in the current broker registry.
- Add IOL to the protocol broker engine union and preset catalog.
- Run typecheck and fix interface drift.

Acceptance:

- Project compiles.
- IOL unit tests compile.
- Broker factory can instantiate IOL from a UTA config.

### Phase 2 - Contract Search and Account Read

- Port/adapt IOL contract search.
- Verify `searchContracts` returns useful `ContractDescription` rows.
- Verify `getAccount` and `getPositions` work or fail clearly in dry-run mode.
- Add tests around native-key resolution.

Acceptance:

- IOL appears in broker config UI.
- A user can search an Argentine symbol and get a stable contract.
- Read-only account paths do not crash.

### Phase 3 - Order Lifecycle

- Adapt `placeOrder`, `cancelOrder`, and open-order reads to the current order result format.
- Confirm order IDs are preserved exactly.
- Ensure order history and trade history projections work from IOL order results.
- Add focused tests for submitted, filled, cancelled, and rejected paths.

Acceptance:

- IOL orders flow through stage -> commit -> manual approval -> push.
- History tabs show IOL orders.
- Errors are user-readable.

### Phase 4 - Argentina Discovery

- Re-evaluate old Yahoo Argentina equity discovery against the current Data Hub/reference design.
- Add a current-style provider/model or route that exposes Argentine equity discovery.
- Wire to UI/tool search only after the provider surface is stable.

Acceptance:

- Argentine equities are discoverable without manually knowing exact symbols.
- Discovery result can lead to a contract search / tradable IOL contract.

### Phase 5 - Fixed Income

- Port `iol-fixed-income-client` only after equity flow is stable.
- Choose a proper current API surface.
- Add tests and UI/tool affordances only if the contract model supports it cleanly.

## Risks

- Current `master` removed or reshaped old market-data paths; old aggregate-search code should not be restored wholesale.
- IOL order semantics may differ from current UTA assumptions around partial fills, market hours, currency, and settlement.
- Credential sealing in current `master` means old config tests and plaintext behavior must be updated.
- UI order-entry has changed; avoid large UI forks unless the generic broker metadata cannot represent IOL.

## Recommended First PR

Keep the first PR narrow:

- IOL broker files
- registry/factory/preset wiring
- account + contract-search tests
- no fixed-income discovery
- no broad UI redesign

That creates a stable integration point before adding Argentina discovery and order-write support.
