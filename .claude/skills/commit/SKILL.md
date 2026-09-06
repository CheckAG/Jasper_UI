---
name: commit
description: Write and create a git commit using this repository's message convention, [Jasper_ui](Mallik):short description. Use when the user asks to commit, save work, or invokes /commit.
allowed-tools: Bash(git:*)
---

# Commit

Stage what belongs together and commit it with a message in this repository's format.

## Message format

```
[Jasper_ui](Mallik):short description of the change
```

- The prefix `[Jasper_ui](Mallik):` is literal and never varies.
- The description follows immediately: **50 words maximum, and far shorter is better.** One crisp line that says what changed. If the line needs to be scrolled to read, it is too long.
- Imperative mood — "add", "fix", "rename", not "added" or "adds".
- No trailing full stop.
- One commit, one concern. If the description needs an "and", consider two commits.

Good:

```
[Jasper_ui](Mallik):add TCD1304 frame codec with resyncing reader
[Jasper_ui](Mallik):fix acquisition loop interval floor starving driver mutex
[Jasper_ui](Mallik):hide Analyze and Chemometrics behind feature flag
```

Too vague: `update code` · `fixes` · `wip`
Too long: anything that restates the diff line by line.

## Body

Usually omit it. Add a short body only when the *why* is not obvious from the description — a non-obvious trade-off, a deferred follow-up, a reason the simple approach was rejected. Separate it from the subject with a blank line.

When the commit closes a tracked feature, reference its issue in the body: `Closes #42`.

Every commit ends with these trailers, after a blank line:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: <the current session URL>
```

## Steps

1. **Look before staging.** Run `git status --short` and `git diff` (plus `git diff --staged` if anything is already staged). Read the actual change — the message describes what the diff does, not what the user said they were doing.

2. **Check the branch.** If `git branch --show-current` reports `master`, this is the release line, not a working branch. Unless the user has explicitly said to commit here, offer `/new-branch` first.

3. **Stage deliberately.** Add the files that belong to this one concern by name. Do not run `git add -A` or `git add .` without checking what it sweeps in. Note `PLAN.md` is gitignored in this repository; `docs/` and `feature_list.json` are not.

4. **Write the message** to the format above and commit with a heredoc so quoting and newlines survive:

   ```bash
   git commit -F - <<'EOF'
   [Jasper_ui](Mallik):short description
   EOF
   ```

5. **Report** the resulting short hash and subject line. Do not push unless asked.

## Notes

- If the working tree holds unrelated changes, say so and propose a split rather than bundling them into one commit.
- If nothing is staged and nothing is modified, say so instead of creating an empty commit.
- Rust and TypeScript types are mirrored by hand across `src-tauri/src/instrument/driver.rs` and `src/lib/types.ts`. A commit that changes one and not the other is almost always incomplete — check before committing.
