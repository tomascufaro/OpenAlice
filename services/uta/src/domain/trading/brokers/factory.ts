/**
 * Broker Factory — preset → engine resolver.
 *
 * Looks up the UTAConfig's preset, validates the user-facing form
 * data against the preset's own Zod schema, calls preset.toEngineConfig
 * to translate it into the engine-shaped dict, then delegates to the
 * target engine's fromConfig.
 *
 * UTAConfig.presetId is the only thing tying account records to
 * engine implementations — the engine identity is never serialized
 * directly. Swapping CCXT for a native client later means changing the
 * preset's `engine` field; on-disk account records stay valid.
 */

import type { IBroker } from './types.js'
import { loadBrokerEngine } from './registry.js'
import { getBrokerPreset } from '@traderalice/uta-protocol'
import type { UTAConfig } from '@/core/config.js'
import type { FxService } from '../fx-service.js'
import { SimBroker } from './sim/index.js'
import type { QuoteFetcher } from './sim/index.js'

/** Optional services brokers can opt into via duck-typed setters. */
export interface BrokerServices {
  fxService?: FxService
  simQuoteFetcher?: QuoteFetcher
}

/** Create an IBroker from account config via preset resolution. */
export async function createBroker(config: UTAConfig, services?: BrokerServices): Promise<IBroker> {
  const preset = getBrokerPreset(config.presetId)
  const presetData = preset.zodSchema.parse(config.presetConfig) as Record<string, unknown>
  const engineConfig = preset.toEngineConfig(presetData)

  const baseConfig = {
    id: config.id,
    label: config.label,
    // keyless flows through brokerConfig so engines that support public-data-only
    // mode (CCXT) can skip credential validation; others ignore it.
    brokerConfig: { ...engineConfig, keyless: config.keyless ?? false },
  }

  // Sim is a built-in local engine (like mock) rather than an installable broker
  // pack, and needs the extra quoteFetcher option loadBrokerEngine's generic
  // createBroker(config) signature has no room for — construct it directly.
  let broker: IBroker
  if (preset.engine === 'sim') {
    SimBroker.configSchema.parse(engineConfig)
    broker = SimBroker.fromConfig(baseConfig, { quoteFetcher: services?.simQuoteFetcher })
  } else {
    const entry = await loadBrokerEngine(preset.engine)
    entry.configSchema.parse(engineConfig)
    broker = entry.createBroker(baseConfig)
  }

  // Multi-currency-aware brokers (e.g. Longbridge) opt in via setFxService.
  // Single-currency brokers don't expose this method and skip the call.
  if (services?.fxService && typeof (broker as { setFxService?: unknown }).setFxService === 'function') {
    (broker as unknown as { setFxService: (fx: FxService) => void }).setFxService(services.fxService)
  }
  return broker
}
