/**
 * News Collector — collected-RSS archive tools (globRss / grepRss / readRss)
 *
 * Creates AI tools that query the persistent news store.
 * Uses endTime = new Date() (real-time mode, not backtesting).
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { INewsProvider, NewsItem } from '../types.js'

const NEWS_LIMIT = 500
/** Default cap on windowRss OUTPUT — a wide date window can match hundreds; we
 *  bound what's returned and report how many were omitted, rather than wall the
 *  caller's context. */
const WINDOW_DEFAULT_LIMIT = 40
const REDDIT_SIGNAL_LIMIT = 40

const REDDIT_SIGNAL_SOURCES: Record<string, string> = {
  'reddit-tradewithcongress': 'tradewithcongress',
  'reddit-securityanalysis': 'SecurityAnalysis',
  'reddit-valueinvesting': 'ValueInvesting',
}

const TICKER_STOPWORDS = new Set([
  'A', 'AI', 'API', 'ATH', 'CEO', 'CFO', 'CPI', 'DD', 'DIY', 'DTE', 'EPS', 'ETF',
  'FDA', 'FOMC', 'GDP', 'IPO', 'IRA', 'IRS', 'ITM', 'IV', 'MACD', 'NAV', 'OTC',
  'OTM', 'PCE', 'PE', 'SEC', 'SPAC', 'TA', 'THE', 'US', 'USA', 'USD', 'YOLO',
])

// ==================== Pure functions (testable) ====================

/** Context injected into pure functions */
export interface NewsToolContext {
  getNews: () => Promise<NewsItem[]>
}

export interface GlobRssResult {
  id: number
  /** Publish time (ISO) — so matches can be put on a timeline without reading each. */
  time: string
  title: string
  contentLength: number
  metadata: string
}

export interface GrepRssResult {
  id: number
  /** Publish time (ISO) — so matches can be put on a timeline without reading each. */
  time: string
  title: string
  matchedText: string
  contentLength: number
  metadata: string
}

export interface WindowRssResult {
  id: number
  time: string
  title: string
  /** Present only when a pattern was given (the matched snippet). */
  matchedText?: string
  metadata: string
}

export interface RedditSignalResult {
  id: number
  time: string
  subreddit: string
  title: string
  url: string | null
  tickers: string[]
  score: number
  reason: string
  source: 'public_reddit'
  verificationRequired: true
}

const ON_DEMAND_REDDIT_SOURCES = [
  'reddit-tradewithcongress',
  'reddit-securityanalysis',
  'reddit-valueinvesting',
] as const

function truncateMetadata(metadata: Record<string, string | null>, maxLength: number = 40): string {
  const str = JSON.stringify(metadata)
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}

function matchesMetadataFilter(metadata: Record<string, string | null>, filter: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false
  }
  return true
}

/** Match news by title regex (like "ls" / "glob") */
export async function globRss(
  context: NewsToolContext,
  options: {
    pattern: string
    metadataFilter?: Record<string, string>
    limit?: number
  },
): Promise<GlobRssResult[]> {
  const news = await context.getNews()
  const regex = new RegExp(options.pattern, 'i')
  const results: GlobRssResult[] = []

  for (const item of news) {
    if (options.metadataFilter && !matchesMetadataFilter(item.metadata, options.metadataFilter)) continue
    if (!regex.test(item.title)) continue

    results.push({
      id: item.id,
      time: new Date(item.time).toISOString(),
      title: item.title,
      contentLength: item.content.length,
      metadata: truncateMetadata(item.metadata),
    })

    if (options.limit && results.length >= options.limit) break
  }

  return results
}

/** Search news content by pattern (like "grep") */
export async function grepRss(
  context: NewsToolContext,
  options: {
    pattern: string
    contextChars?: number
    metadataFilter?: Record<string, string>
    limit?: number
  },
): Promise<GrepRssResult[]> {
  const news = await context.getNews()
  const regex = new RegExp(options.pattern, 'gi')
  const contextChars = options.contextChars ?? 50
  const results: GrepRssResult[] = []

  for (const item of news) {
    if (options.metadataFilter && !matchesMetadataFilter(item.metadata, options.metadataFilter)) continue

    const searchText = `${item.title}\n${item.content}`
    const match = regex.exec(searchText)
    if (!match) continue

    const matchStart = match.index
    const matchEnd = matchStart + match[0].length
    const contextStart = Math.max(0, matchStart - contextChars)
    const contextEnd = Math.min(searchText.length, matchEnd + contextChars)

    let matchedText = ''
    if (contextStart > 0) matchedText += '...'
    matchedText += searchText.slice(contextStart, contextEnd)
    if (contextEnd < searchText.length) matchedText += '...'

    results.push({
      id: item.id,
      time: new Date(item.time).toISOString(),
      title: item.title,
      matchedText,
      contentLength: item.content.length,
      metadata: truncateMetadata(item.metadata),
    })

    regex.lastIndex = 0

    if (options.limit && results.length >= options.limit) break
  }

  return results
}

/** Articles within a time window (event study) — optionally pattern-filtered,
 *  returned OLDEST-first so they line up against a price path. The window itself
 *  is set by the caller's `getNews` (provider start/endTime). */
export async function windowRss(
  context: NewsToolContext,
  options: { pattern?: string; metadataFilter?: Record<string, string>; contextChars?: number; limit?: number },
): Promise<WindowRssResult[]> {
  const news = await context.getNews()
  const regex = options.pattern ? new RegExp(options.pattern, 'i') : null
  const contextChars = options.contextChars ?? 50
  const out: WindowRssResult[] = []

  for (const item of news) {
    if (options.metadataFilter && !matchesMetadataFilter(item.metadata, options.metadataFilter)) continue
    let matchedText: string | undefined
    if (regex) {
      const searchText = `${item.title}\n${item.content}`
      const m = regex.exec(searchText)
      if (!m) continue
      const s = Math.max(0, m.index - contextChars)
      const e = Math.min(searchText.length, m.index + m[0].length + contextChars)
      matchedText = `${s > 0 ? '...' : ''}${searchText.slice(s, e)}${e < searchText.length ? '...' : ''}`
    }
    out.push({
      id: item.id,
      time: new Date(item.time).toISOString(),
      title: item.title,
      ...(matchedText ? { matchedText } : {}),
      metadata: truncateMetadata(item.metadata),
    })
  }
  out.sort((a, b) => a.time.localeCompare(b.time)) // oldest-first for timeline alignment
  return options.limit ? out.slice(0, options.limit) : out
}

/** Read full news content by stable id (like "cat") */
export async function readRss(
  context: NewsToolContext,
  options: { id: number },
): Promise<NewsItem | null> {
  const news = await context.getNews()
  return news.find((item) => item.id === options.id) ?? null
}

export async function redditSignals(
  context: NewsToolContext,
  options: {
    tickers?: string[]
    subreddits?: string[]
    pattern?: string
    limit?: number
  } = {},
): Promise<RedditSignalResult[]> {
  const news = await context.getNews()
  const tickerFilter = new Set((options.tickers ?? []).map((t) => t.replace(/^\$/, '').toUpperCase()))
  const subredditFilter = new Set((options.subreddits ?? []).map((s) => s.replace(/^r\//i, '').toLowerCase()))
  const pattern = options.pattern ? new RegExp(options.pattern, 'i') : null
  const out: RedditSignalResult[] = []

  for (const item of news) {
    const source = item.metadata.source ?? ''
    const subreddit = REDDIT_SIGNAL_SOURCES[source]
    if (!subreddit) continue
    if (subredditFilter.size > 0 && !subredditFilter.has(subreddit.toLowerCase())) continue

    const text = `${item.title}\n${item.content}`
    if (pattern && !pattern.test(text)) continue

    const tickers = detectTickers(text)
    if (tickerFilter.size > 0 && !tickers.some((t) => tickerFilter.has(t))) continue

    out.push({
      id: item.id,
      time: new Date(item.time).toISOString(),
      subreddit,
      title: item.title,
      url: item.metadata.link ?? null,
      tickers,
      score: scoreRedditSignal({ item, subreddit, tickers, patternMatched: Boolean(pattern) }),
      reason: reasonForRedditSignal(subreddit, tickers),
      source: 'public_reddit',
      verificationRequired: true,
    })
  }

  return out
    .sort((a, b) => b.score - a.score || b.time.localeCompare(a.time))
    .slice(0, options.limit ?? REDDIT_SIGNAL_LIMIT)
}

function detectTickers(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\$([A-Z]{1,5})(?![A-Z])/g)) {
    addTicker(found, match[1])
  }
  for (const match of text.matchAll(/\b[A-Z]{2,5}\b/g)) {
    addTicker(found, match[0])
  }
  return [...found].sort()
}

function addTicker(found: Set<string>, raw: string): void {
  const ticker = raw.toUpperCase()
  if (TICKER_STOPWORDS.has(ticker)) return
  found.add(ticker)
}

function scoreRedditSignal(opts: { item: NewsItem; subreddit: string; tickers: string[]; patternMatched: boolean }): number {
  let score = 1
  if (opts.tickers.length > 0) score += 2
  if (opts.subreddit === 'tradewithcongress' || opts.subreddit === 'CongressStockTrading') score += 2
  if (opts.subreddit === 'SecurityAnalysis' || opts.subreddit === 'ValueInvesting') score += 1
  if (opts.patternMatched) score += 1
  if (/\b(DD|due diligence|filing|disclosure|13F|Form 4|earnings|guidance|contract)\b/i.test(`${opts.item.title}\n${opts.item.content}`)) score += 1
  return score
}

function reasonForRedditSignal(subreddit: string, tickers: string[]): string {
  const tickerText = tickers.length > 0 ? `mentions ${tickers.join(', ')}` : 'no ticker detected'
  return `r/${subreddit}; ${tickerText}; public Reddit post, verify against filings/news before acting`
}

// ==================== AI Tool factory ====================

export function createNewsArchiveTools(
  provider: INewsProvider,
  refreshRedditFeeds?: () => Promise<Array<{ source: string; fetched?: number; ingested?: number; error?: string }>>,
) {
  return {
    refreshRedditSignals: tool({
      description: 'Refresh the selected Reddit RSS feeds only when the current user explicitly asks for Reddit or Reddit sentiment. Never call this as background market research or because Reddit might be useful. Returns a result for each source; an error means that source was unavailable and must not be reported as an empty result.',
      inputSchema: z.object({}),
      execute: async () => refreshRedditFeeds
        ? { sources: await refreshRedditFeeds() }
        : { sources: ON_DEMAND_REDDIT_SOURCES.map((source) => ({ source, error: 'News collector is unavailable.' })) },
    }),
    globRss: tool({
      description: `Search the collected-RSS archive by title pattern (like "ls" / "glob").

The archive holds articles pulled from the user's SUBSCRIBED RSS feeds —
coverage is exactly the feed list, not the news at large. Empty results mean
"not in the subscribed feeds", not "nothing happened".

Returns matching headlines with a stable \`id\`, title, content length, and metadata preview.
Pass an \`id\` to readRss to read the full article — the id is stable across calls,
so you do NOT need to repeat your \`lookback\`.
Use this to quickly scan what the subscribed feeds picked up.

Search pool: the most recent ${NEWS_LIMIT} items within \`lookback\` (or the
most recent ${NEWS_LIMIT} overall when \`lookback\` is omitted). Older items
within the lookback window are NOT searched. Your \`limit\` then bounds the
match count returned from that pool.

Example: globRss({ pattern: "BTC|Bitcoin", lookback: "1d" })`,
      inputSchema: z.object({
        pattern: z.string().describe('Regex to match against article titles'),
        lookback: z.string().optional().describe(`Time range: "1h", "12h", "1d", "7d" (searches up to ${NEWS_LIMIT} most recent items in the window)`),
        metadataFilter: z.record(z.string(), z.string()).optional().describe('Filter by metadata key-value'),
        limit: z.number().int().positive().optional().describe('Max results'),
      }).meta({ examples: [{ pattern: 'BTC|Bitcoin', lookback: '1d' }] }),
      execute: async ({ pattern, lookback, metadataFilter, limit }) => {
        return globRss(
          { getNews: () => provider.getNewsV2({ endTime: new Date(), lookback, limit: NEWS_LIMIT }) },
          { pattern, metadataFilter, limit },
        )
      },
    }),

    grepRss: tool({
      description: `Search collected-RSS article content by pattern (like "grep").

Searches articles pulled from the user's SUBSCRIBED RSS feeds (coverage = the
feed list). Returns matched text with surrounding context.
Use this to find specific mentions in the collected articles.

Search pool: the most recent ${NEWS_LIMIT} items within \`lookback\` (or the
most recent ${NEWS_LIMIT} overall when \`lookback\` is omitted). Older items
within the lookback window are NOT searched.

Example: grepRss({ pattern: "interest rate", lookback: "2d" })`,
      inputSchema: z.object({
        pattern: z.string().describe('Regex to search in title and content'),
        lookback: z.string().optional().describe(`Time range: "1h", "12h", "1d", "7d" (searches up to ${NEWS_LIMIT} most recent items in the window)`),
        contextChars: z.number().int().positive().optional().describe('Context chars around match (default: 50)'),
        metadataFilter: z.record(z.string(), z.string()).optional().describe('Filter by metadata key-value'),
        limit: z.number().int().positive().optional().describe('Max results'),
      }).meta({ examples: [{ pattern: 'interest rate', lookback: '2d' }] }),
      execute: async ({ pattern, lookback, contextChars, metadataFilter, limit }) => {
        return grepRss(
          { getNews: () => provider.getNewsV2({ endTime: new Date(), lookback, limit: NEWS_LIMIT }) },
          { pattern, contextChars, metadataFilter, limit },
        )
      },
    }),

    windowRss: tool({
      description: `Articles within a DATE WINDOW (event study), oldest-first — for aligning news against a price path ("what hit between the gap-up and the fade").

Returns id + ISO time + title (+ matched snippet when a pattern is given), sorted oldest→newest so the timeline lines up with bars. Pair with marketSnapshot/simulate to attribute a move to a catalyst.

Coverage is the user's SUBSCRIBED RSS feeds only (not the news at large) — an empty window means "nothing in the subscribed feeds for that span", not "nothing happened". Pass a \`pattern\` to filter, or omit it to get everything in the window.

Example: windowRss({ from: "2026-06-20", to: "2026-06-26", pattern: "Iran|oil" })`,
      inputSchema: z.object({
        from: z.string().describe('Window start (YYYY-MM-DD or ISO).'),
        to: z.string().optional().describe('Window end (YYYY-MM-DD or ISO). Default: now.'),
        pattern: z.string().optional().describe('Optional regex over title+content. Omit for everything in the window.'),
        contextChars: z.number().int().positive().optional().describe('Context chars around a pattern match (default 50).'),
        metadataFilter: z.record(z.string(), z.string()).optional().describe('Filter by metadata key-value (e.g. source).'),
        limit: z.number().int().positive().optional().describe(`Max results returned (default ${WINDOW_DEFAULT_LIMIT}). A wide window can match hundreds; raise this, or narrow the pattern/window. The result reports total + how many were omitted.`),
      }).meta({ examples: [{ from: '2026-06-20', to: '2026-06-26', pattern: 'Iran|oil' }] }),
      execute: async ({ from, to, pattern, contextChars, metadataFilter, limit }) => {
        const startTime = new Date(from)
        const endTime = to ? new Date(to) : new Date()
        if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
          return { error: 'from/to must be YYYY-MM-DD or ISO dates.' }
        }
        // Fetch ALL matches in the window, then bound the OUTPUT (a wide window can
        // be a wall of hundreds) — and say how many we left out, oldest-first.
        const all = await windowRss(
          { getNews: () => provider.getNewsV2({ startTime, endTime, limit: 5000 }) },
          { pattern, contextChars, metadataFilter },
        )
        const cap = limit ?? WINDOW_DEFAULT_LIMIT
        const results = all.slice(0, cap)
        const omitted = all.length - results.length
        return {
          from: startTime.toISOString(),
          to: endTime.toISOString(),
          total: all.length,
          shown: results.length,
          ...(omitted > 0 ? { omitted, note: `${omitted} more match(es) in this window are not shown (oldest-first; showing the earliest ${results.length}). Narrow the pattern/window, or raise limit.` } : {}),
          results,
        }
      },
    }),

    readRss: tool({
      description: `Read full content of a collected-RSS article by stable id (like "cat").

Use after globRss/grepRss to read a specific article — pass the \`id\` from their
results. The id is stable, so it resolves regardless of what \`lookback\` you used
to find the item (no need to repeat it).`,
      inputSchema: z.object({
        id: z.number().int().nonnegative().describe('Stable article id from globRss/grepRss results'),
      }).meta({ examples: [{ id: 0 }] }),
      execute: async ({ id }) => {
        const result = await readRss(
          { getNews: () => provider.getNewsV2({ endTime: new Date(), limit: NEWS_LIMIT }) },
          { id },
        )
        return result ?? { error: `Article id ${id} not found` }
      },
    }),

    redditSignals: tool({
      description: `Find public Reddit trading-signal posts from collected Reddit RSS feeds. Call only when the current user explicitly asks for Reddit or Reddit sentiment; never infer that request from a general research task.

This reads the selected Reddit discovery feeds: r/tradewithcongress,
r/SecurityAnalysis, and r/ValueInvesting. Each is a lead only and requires verification.

Returns public leads only: every result is marked verificationRequired=true. Use filings,
broker data, and ordinary news tools before treating any post as trade-relevant.`,
      inputSchema: z.object({
        lookback: z.string().optional().describe(`Time range: "1h", "12h", "1d", "7d" (searches up to ${NEWS_LIMIT} most recent Reddit feed items in the window)`),
        tickers: z.array(z.string()).optional().describe('Optional ticker filter, e.g. ["NVDA", "TSLA"]. "$NVDA" is accepted.'),
        subreddits: z.array(z.string()).optional().describe('Optional subreddit names without r/, e.g. ["tradewithcongress", "SecurityAnalysis"].'),
        pattern: z.string().optional().describe('Optional regex over title+content, e.g. "congress|disclosure|pelosi".'),
        limit: z.number().int().positive().max(REDDIT_SIGNAL_LIMIT).optional().describe(`Max results, default ${REDDIT_SIGNAL_LIMIT}.`),
      }).meta({ examples: [{ lookback: '7d', tickers: ['NVDA'], subreddits: ['tradewithcongress'] }] }),
      execute: async ({ lookback, tickers, subreddits, pattern, limit }) => {
        return redditSignals(
          { getNews: () => provider.getNewsV2({ endTime: new Date(), lookback, limit: NEWS_LIMIT }) },
          { tickers, subreddits, pattern, limit },
        )
      },
    }),
  }
}
