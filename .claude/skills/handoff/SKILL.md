---
name: handoff
description: Update SESSION-HANDOFF.md so the next agent can pick the work up cold. Use at the end of a working session, when the user says "hand off", "wrap up", "update the handoff", or invokes /handoff.
allowed-tools: Bash(git:*), Read, Edit, Write
---

# Handoff

Rewrite `SESSION-HANDOFF.md` to reflect the session that just happened. The next agent starts with no memory of it — the file is the whole inheritance.

## What to gather first

1. `git status --short` and `git branch --show-current` — what is uncommitted, and where.
2. `git log --oneline -10` — what landed.
3. `feature_list.json` — which features changed status this session.
4. Anything discovered that is not written down anywhere else: a protocol quirk, a build flag, a wrong assumption that cost time.

## What the file must contain

Keep the existing section order. Replace content, do not append — a handoff that grows every session stops being read.

- **Now** — one paragraph: the single next thing to do, and the branch to do it on.
- **State** — what works, what is half-built, what is untouched. Half-built is the important one: name the file and what is missing.
- **Uncommitted work** — every dirty path with one line on what it is, or "clean".
- **Learned this session** — only non-obvious things: something the code does not say and the plan did not predict. Wrong turns belong here, so the next agent does not repeat them.
- **Blocked / needs a human** — hardware that must be plugged in, a decision only the user can make, a credential.

## Rules

- Facts only. If a change was not verified, say it was not verified.
- Absolute dates, never "yesterday" or "last session".
- Reference files as `path:line`.
- Do not restate `PLAN.md` or `feature_list.json` — link to them. The handoff says what *happened*, they say what is *planned*.
- If a feature finished, set its `status` to `done` in `feature_list.json` in the same pass.
- Under 120 lines. If it will not fit, the surplus belongs in `PLAN.md` or an issue.

## Steps

1. Gather the four inputs above.
2. Rewrite `SESSION-HANDOFF.md` in place.
3. Update any changed `status` / `branch` fields in `feature_list.json`.
4. Report what you changed. Do not commit unless asked.
