---
name: alice-workspace
description: >
  Agent collaboration on your shell PATH via the `alice-workspace` CLI: push
  finished work to the user's Inbox (`inbox push`, with repeatable `--doc`
  file attachments) and track entities across workspaces (`track`). Use for:
  "push my findings to the inbox", "surface this report to the user", "track
  this ticker", "register this theme as [[name]]". Discover flags with
  `alice-workspace --help` — do NOT guess.
---

# Collaboration — `alice-workspace`

**Hand finished work back to the user** — this is the outbound channel. It posts
to the user's Inbox tab:

```bash
alice-workspace inbox push --doc research/tsla.md --comments "Done — TSLA looks extended; details in the doc."
```

(Attach files with repeatable `--doc <path>` — workspace-relative; each renders
live in the inbox UI, not snapshotted. `--comments` is your markdown note. At
least one of `--doc` / `--comments` must be present.)

**Track entities** — the durable cross-workspace tracked index (`[[name]]`):

```bash
alice-workspace track search --query "uranium"
alice-workspace track add --name uranium-ccj --description "Cameco — uranium miner"
```
