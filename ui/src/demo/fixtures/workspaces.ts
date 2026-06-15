import type { Workspace, TemplateInfo, SessionRecord } from '../../components/workspace/api'

// The flagship demo workspace — the one inbox/transcript fixtures tie to.
// Template is `chat` (the general-purpose workspace): the AAPL Q1 transcript
// is a research session (read SEC filings, compute services-rev YoY, write
// report, inbox_push), which Chat handles fine. A real template name makes
// the Workspaces sidebar group it correctly.
export const DEMO_WORKSPACE_ID = 'demo-ws'
export const DEMO_SESSION_ID = 'demo-session'

const demoSession: SessionRecord = {
  id: DEMO_SESSION_ID,
  wsId: DEMO_WORKSPACE_ID,
  agent: 'claude',
  name: 'c1',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  state: 'running',
  agentSessionId: null,
  pid: 0,
  startedAt: Date.now(),
}

export const demoWorkspace: Workspace = {
  id: DEMO_WORKSPACE_ID,
  tag: 'aapl-q1',
  dir: '/demo/workspaces/aapl-q1',
  createdAt: new Date().toISOString(),
  template: 'chat',
  spawnedFromVersion: '0.1.0',
  currentVersion: '0.1.0',
  upgradeAvailable: null,
  agents: ['claude'],
  sessions: [demoSession],
  agentOverride: { claude: false, codex: false, opencode: false, pi: false },
}

// Chat workspace — populates the Chat activity sidebar (which filters
// `template === 'chat'`). No transcript registered, so its session pane
// falls back to DemoTerminalStub — that's the right "this is a live PTY
// in real OpenAlice" placeholder for demo mode.
export const DEMO_CHAT_WORKSPACE_ID = 'demo-chat-ws'
export const DEMO_CHAT_SESSION_ID = 'demo-chat-session'

const demoChatSession: SessionRecord = {
  id: DEMO_CHAT_SESSION_ID,
  wsId: DEMO_CHAT_WORKSPACE_ID,
  agent: 'claude',
  name: 'c1',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  state: 'running',
  agentSessionId: null,
  pid: 0,
  startedAt: Date.now(),
}

export const demoChatWorkspace: Workspace = {
  id: DEMO_CHAT_WORKSPACE_ID,
  tag: 'chat-may26',
  dir: '/demo/workspaces/chat-may26',
  createdAt: new Date().toISOString(),
  template: 'chat',
  spawnedFromVersion: '0.1.0',
  currentVersion: '0.1.0',
  upgradeAvailable: null,
  agents: ['claude', 'codex'],
  sessions: [demoChatSession],
  agentOverride: { claude: false, codex: false, opencode: false, pi: false },
}

export const demoWorkspaces: Workspace[] = [demoWorkspace, demoChatWorkspace]

// Templates — names + metadata mirror the real template at
// src/workspaces/templates/chat/template.json. The name matters: the Chat /
// Workspaces sidebars filter on the literal 'chat' template name.
export const chatTemplate: TemplateInfo = {
  name: 'chat',
  displayName: 'Chat',
  description:
    "General-purpose Alice workspace — Alice's full tool surface (market/research data + trading) via the alice*/traderhub CLIs on PATH.",
  groupOrder: 10,
  defaultAgents: ['claude', 'codex'],
  version: '0.1.0',
  hasReadme: false,
}

export const demoTemplates: TemplateInfo[] = [chatTemplate]

// Back-compat singleton for older callers (other fixture files reference
// `demoTemplate` and we want a stable name). Points at the flagship.
export const demoTemplate: TemplateInfo = chatTemplate
