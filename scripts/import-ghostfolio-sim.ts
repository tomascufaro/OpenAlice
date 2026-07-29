import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface GhostfolioActivity {
  currency: string
  quantity: number | string
  symbol: string
  type: string
  unitPrice: number | string
}

interface GhostfolioAccount {
  balance: number | string
  currency: string
}

interface GhostfolioExport {
  accounts?: GhostfolioAccount[]
  activities?: GhostfolioActivity[]
}

interface PositionAccumulator {
  avgCost: number
  currency: string
  quantity: number
  symbol: string
}

export interface ImportOptions {
  accountId?: string
  cash?: string
  currency?: string
}

export function buildSimLedger(
  ghostfolio: GhostfolioExport,
  { accountId = 'sim', cash, currency = 'USD' }: ImportOptions = {}
) {
  const positions = new Map<string, PositionAccumulator>()

  for (const activity of ghostfolio.activities ?? []) {
    if (activity.type !== 'BUY' && activity.type !== 'SELL') continue

    const key = `${activity.symbol}|${activity.currency}`
    const position = positions.get(key) ?? {
      avgCost: 0,
      currency: activity.currency,
      quantity: 0,
      symbol: activity.symbol
    }
    const quantity = Number(activity.quantity)
    const price = Number(activity.unitPrice)

    if (!Number.isFinite(quantity) || !Number.isFinite(price)) continue

    if (activity.type === 'BUY') {
      const cost = position.avgCost * position.quantity + price * quantity
      position.quantity += quantity
      position.avgCost = cost / position.quantity
    } else {
      position.quantity -= quantity
    }

    if (position.quantity > 0) positions.set(key, position)
    else positions.delete(key)
  }

  return {
    accountId,
    cash: cash ?? sumCash(ghostfolio.accounts ?? [], currency),
    currency,
    positions: [...positions.values()]
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((position) => ({
        aliceId: `${accountId}|${position.symbol}`,
        symbol: position.symbol,
        secType: 'STK',
        exchange: 'SMART',
        currency: position.currency,
        side: 'long',
        quantity: cleanNumber(position.quantity),
        avgCost: cleanNumber(position.avgCost)
      })),
    orders: [],
    realizedPnL: '0',
    nextOrderId: 1
  }
}

function sumCash(accounts: GhostfolioAccount[], currency: string): string {
  const total = accounts
    .filter((account) => account.currency === currency)
    .reduce((sum, account) => sum + Number(account.balance), 0)
  return cleanNumber(total)
}

function cleanNumber(value: number): string {
  return Number(value.toPrecision(12)).toString()
}

function parseArgs(argv: string[]) {
  const options: {
    accountId?: string
    cash?: string
    currency?: string
    ghostfolioFile?: string
    openAliceHome?: string
  } = {}

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--account-id') {
      options.accountId = next
      i += 1
    } else if (arg === '--cash') {
      options.cash = next
      i += 1
    } else if (arg === '--currency') {
      options.currency = next
      i += 1
    } else if (arg === '--home') {
      options.openAliceHome = next
      i += 1
    } else if (arg === '--') {
      continue
    } else if (!arg.startsWith('--')) {
      options.ghostfolioFile = arg
    }
  }

  return options
}

export async function importGhostfolioSim(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const ghostfolioFile = resolve(options.ghostfolioFile ?? 'portfolio-import.json')
  const openAliceHome = resolve(
    options.openAliceHome ?? process.env.OPENALICE_HOME ?? `${homedir()}/.openalice`
  )
  const accountId = options.accountId ?? process.env.OPENALICE_SIM_ACCOUNT_ID ?? 'sim'
  const ledgerFile = resolve(
    openAliceHome,
    'data',
    'trading',
    accountId,
    'sim-ledger.json'
  )
  const ghostfolio = JSON.parse(await readFile(ghostfolioFile, 'utf8')) as GhostfolioExport
  const ledger = buildSimLedger(ghostfolio, {
    accountId,
    cash: options.cash,
    currency: options.currency
  })

  await mkdir(dirname(ledgerFile), { recursive: true })
  await writeFile(ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`)

  console.log(`Wrote ${ledger.positions.length} positions to ${ledgerFile}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  importGhostfolioSim().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
