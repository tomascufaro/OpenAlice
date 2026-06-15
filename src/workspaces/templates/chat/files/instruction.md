# Chat workspace

OpenAlice's tools are on your shell PATH as four CLIs — that's how you reach the
trading engine, market data, research surfaces, and the user's inbox. They're
already there, no setup. Each has a skill with the full manual; this is the map.
Discover any command live with `<cli> --help` and `<cli> <group> <verb> --help`
— do NOT guess flags.

| CLI | For | Skill |
|---|---|---|
| `alice` | **Research & data** — collected-RSS archive, symbol search (barIds), quant analysis | `alice` |
| `alice-uta` | **Trading** — accounts, portfolio, orders, positions, trading-as-git approval (MUTATES real broker state) | `alice-uta` |
| `alice-workspace` | **Collaboration** — push finished work to the user's Inbox, track entities | `alice-workspace` |
| `traderhub` | **Low-frequency market data** — fundamentals, macro series, calendars, ETF, boards, shipping, Fed | `traderhub` |

```bash
alice market search --query AAPL    # find a symbol → barId
alice rss grep --pattern BTC        # collected-RSS archive — subscribed feeds only; wider news → the opencli-reader skill
alice-uta account portfolio --help  # check positions (then `order place --help` to trade)
alice-workspace inbox push --doc report.md --comments "…"   # surface work to the user
traderhub board get --board macro   # a finished macro board in one call
```

Output is JSON on stdout; a non-zero exit means it failed (reason on stderr).
**To place a trade, that's `alice-uta`** — resolve the contract first and report
every result. Scheduling (cron) is not on any CLI and is unavailable
in-workspace — if the user wants a recurring run, say so rather than improvising.

## Beyond Alice's data — `opencli` (optional, read-only)

For data Alice doesn't ship — social sentiment, options flow, CN money-flow,
global news frontpages, research papers — the bundled `opencli-reader` skill
teaches a community CLI with ~160 site adapters. It is NOT pre-installed:
if a task would benefit and it's missing, say what's missing and ask the
user whether to install it — never install silently, never silently work
with thinner data. Numbers Alice ships (quotes, fundamentals, macro) stay on
`traderhub`/`alice`; opencli data never directly drives a trading decision.

## Handing work back to the user

This workspace has an outbound channel to the user's Inbox. When you finish
something the user should see — a shortlist, a thesis, a rotation snapshot, a
decision you reached — push it to their inbox: the file(s) you produced plus a
short note on what it is and why it matters. Don't make them come looking in the
workspace; surface the result. (One-way for now — they read the inbox; they
don't reply through it.)

```bash
alice-workspace inbox push --doc research/tsla.md --comments "Done — details in the doc."
```

(Repeatable `--doc <path>` attaches workspace files, rendered live in the inbox;
`--comments` is your markdown note. See the `alice-workspace` skill.)

## Tracking assets & topics worth following

When you surface something the user will want to keep an eye on over time — a
ticker you're watching, a theme that ties several together — register it with
`alice-workspace track add`. Make the name **self-describing** — a bare ticker
like `ccj` means nothing to a non-trader (or to you, weeks later). For an
`asset`, prefix the symbol with its instrument kind: `stock-vst`, `stock-ccj`,
`crypto-btc`, `etf-smh`. For a `topic`, a short phrase: `ai-data-center-power`.
Then link to it in your notes with `[[name]]` — e.g. `[[stock-vst]]`,
`[[ai-data-center-power]]`.

Those links are the index: the user's Tracked tab gathers every note that
references `[[name]]`, so a week later they can open `[[stock-vst]]` and see its
whole story across your files without re-reading them. Before creating one, call
`alice-workspace track search` to reuse an existing name instead of fragmenting it.

Otherwise, use this workspace however you like. The CWD is its own git
repo (commits stay local), and any files you create or edit are scoped
to this workspace.
