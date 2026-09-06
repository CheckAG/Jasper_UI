---
name: new-branch
description: Create a git branch for a new feature or fix using this repository's naming convention (feature/xxx_shortname, fix/xxx_shortname). Use when the user wants to start work on a feature or fix, asks for a new branch, or says "branch for", "start feature", "start fix", or invokes /new-branch.
allowed-tools: Bash(git:*)
---

# New branch

Create a correctly named branch off an up-to-date `master`.

## Naming convention

```
feature/<number>_<short-name>
fix/<number>_<short-name>
```

- `<number>` — the GitHub issue number for the feature or fix. Digits only, no `#`.
- `_` — the single underscore is the delimiter between number and name. It appears exactly once.
- `<short-name>` — lowercase, **hyphen-separated**, two to four words.

Examples:

```
feature/12_tcd1304-frame-codec
feature/15_probe-based-discovery
fix/18_acquisition-loop-interval
fix/21_fake-telemetry-tiles
```

Not valid: `feature/12-frame-codec` (hyphen where the delimiter belongs) · `feature/12_TCD1304_Frame_Codec` (uppercase, extra underscores) · `feature/frame-codec` (no number) · `feature/#12_codec` (hash).

## Steps

1. **Determine type.** `feature` for new capability, `fix` for correcting broken behaviour. If the user's wording is ambiguous, ask — it is one word and it lives in the branch name permanently.

2. **Determine the number.**
   - Use it if the user gave one.
   - Otherwise look it up in `feature_list.json` — every planned feature carries its `issue` number and an `id` like `E2a`. Confirm the match before using it.
   - Otherwise ask. Do not invent a number and do not fall back to a nameless branch — the number is what links the branch to its issue.

3. **Derive the short name.** From the issue title when there is one, otherwise from the user's description. Lowercase, hyphenate, strip filler words ("add", "the", "support for") unless removing them loses the meaning.

4. **Check the working tree.** Run `git status --short`. If it is dirty, say what is uncommitted and ask whether to carry the changes onto the new branch or stash them first. Never discard uncommitted work.

5. **Create the branch from current `master`:**

   ```bash
   git fetch origin
   git checkout -b <branch-name> origin/master
   ```

   Branch from `origin/master`, not from whatever is currently checked out. A branch accidentally rooted on another feature branch drags that work into its eventual merge.

6. **Update `feature_list.json`** — set the feature's `branch` field and move its `status` to `in-progress`.

7. **Report** the branch name and what it was based on. Do not push, and do not create an upstream branch, unless asked.

## Notes

- If the branch already exists, say so and offer to switch to it rather than creating a variant name.
- Feature and fix branches merge back into `master` through a pull request. `master` is the release line — never commit to it directly.
- The remote is SSH (`git@github.com:CheckAG/Jasper_UI.git`). If a fetch or push fails on auth, check `ssh -T git@github.com` before anything else.
