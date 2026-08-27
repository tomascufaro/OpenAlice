import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewsCollector } from './rss.js'
import type { NewsCollectorStore } from '../store.js'

const rss = '<rss><channel><item><title>Test</title><description>Test</description></item></channel></rss>'

afterEach(() => vi.unstubAllGlobals())

describe('NewsCollector', () => {
  it('keeps Reddit feeds out of periodic collection but fetches them on demand', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(rss))
    vi.stubGlobal('fetch', fetch)
    const store = { ingest: vi.fn().mockResolvedValue(true) } as unknown as NewsCollectorStore
    const collector = new NewsCollector({
      store,
      intervalMs: 60_000,
      feeds: [
        { name: 'Market', url: 'https://example.com/market', source: 'market', enabled: true },
        { name: 'Reddit', url: 'https://example.com/reddit', source: 'reddit-signals', enabled: true },
      ],
    })

    await collector.fetchAll()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://example.com/market', expect.anything())

    await collector.fetchSources(['reddit-signals'])
    expect(fetch).toHaveBeenCalledWith('https://example.com/reddit', expect.anything())
  })
})
