import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { useWorkspace } from '../tabs/store'
import { getFocusedTab, type ViewSpec } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

type AutomationSection = Extract<ViewSpec, { kind: 'automation' }>['params']['section']

const PRIMARY = [
  { labelKey: 'automation.schedules', section: 'schedules' },
  { labelKey: 'automation.runs', section: 'runs' },
  { labelKey: 'automation.api', section: 'api' },
] as const

// The old event-bus surfaces — demoted under a collapsed "Legacy" group so they
// stay reachable without crowding the primary automation rows.
const LEGACY = [
  { labelKey: 'automation.flow', section: 'flow' },
  { labelKey: 'automation.webhook', section: 'webhook' },
] as const

type AutomationItem = (typeof PRIMARY)[number] | (typeof LEGACY)[number]

/**
 * Automation sidebar — one row per sub-section. Primary rows (schedules / runs
 * / api) up top; the legacy event-bus rows (flow / webhook) live in a group
 * that is collapsed by default and only auto-expands when a legacy section is
 * the active tab. Clicking a row opens that section as its own tab.
 */
export function AutomationSidebar() {
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const { t } = useTranslation()

  const activeSection: AutomationSection | null =
    focused?.kind === 'automation' ? focused.params.section : null
  const [legacyOpen, setLegacyOpen] = useState(
    () => activeSection === 'flow' || activeSection === 'webhook',
  )

  const row = (item: AutomationItem) => (
    <SidebarRow
      key={item.section}
      label={t(item.labelKey)}
      active={activeSection === item.section}
      onClick={() => openOrFocus({ kind: 'automation', params: { section: item.section } })}
    />
  )

  return (
    <div className="py-0.5">
      {PRIMARY.map(row)}
      <SidebarRow
        label={t('automation.legacy')}
        dim
        icon={
          legacyOpen ? (
            <ChevronDown size={13} className="text-text-muted/70" />
          ) : (
            <ChevronRight size={13} className="text-text-muted/70" />
          )
        }
        onClick={() => setLegacyOpen((v) => !v)}
      />
      {legacyOpen && LEGACY.map(row)}
    </div>
  )
}
