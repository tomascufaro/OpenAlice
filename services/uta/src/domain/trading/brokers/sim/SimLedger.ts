import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '@/core/paths.js'
import type { SimLedgerState } from './sim-types.js'

export class SimLedger {
  private readonly path: string

  constructor(accountId: string, path = dataPath('trading', accountId, 'sim-ledger.json')) {
    this.path = path
  }

  async load(): Promise<SimLedgerState | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf-8')) as SimLedgerState
    } catch {
      return null
    }
  }

  async save(state: SimLedgerState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(state, null, 2))
  }
}
