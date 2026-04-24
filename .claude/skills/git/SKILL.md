---
name: git
description: Use this skill when the user asks to commit changes, stage files, write a commit message, create a pull request, push a branch, open a PR, manage branches, or perform any git operation. Trigger on phrases like "commit this", "make a commit", "commit my changes", "open a PR", "create a pull request", "push my changes", "create a branch", "what's the git status", or any request involving git workflow.
argument-hint: commit [message] | pr [title] | branch [name] | status
allowed-tools: Bash(git *), mcp__github__create_pull_request, mcp__github__list_pull_requests, mcp__github__pull_request_read, mcp__github__update_pull_request, mcp__github__update_pull_request_branch, mcp__github__merge_pull_request, mcp__github__list_branches, mcp__github__create_branch, mcp__github__list_commits, mcp__github__get_me
---

# Git Operations

The user invoked this with: $ARGUMENTS

Parse the first word of `$ARGUMENTS` as the subcommand, then follow the matching section below. If no subcommand is given, run **status** and suggest what to do next.

---

## Subcommand: `commit`

Goal: produce one clean, well-scoped commit that moves the work forward.

### 1. Gather context (run in parallel)

```
git status
git diff HEAD
git log --oneline -10
```

### 2. Decide what to stage

Stage only files that belong to a single logical change. If the diff mixes several concerns (e.g., feature code + unrelated refactor), ask the user which files to include before proceeding.

Never stage:

- `.env`, `*.key`, credential files, or secrets of any kind
- Build artifacts or generated files already in `.gitignore`
- Lock file changes unless dependency versions actually changed

### 3. Write the commit message

Follow **Conventional Commits** (`type(scope): subject`):

| Type       | When to use                                  |
| ---------- | -------------------------------------------- |
| `feat`     | New capability visible to a user or consumer |
| `fix`      | Corrects a bug                               |
| `refactor` | Internal restructure; no behavior change     |
| `test`     | Adds or updates tests only                   |
| `docs`     | Documentation only                           |
| `chore`    | Tooling, config, deps — nothing ships        |
| `perf`     | Performance improvement                      |

**Subject line rules:**

- Imperative mood: "add login" not "added login"
- No period at the end
- ≤ 72 characters
- Lowercase after the colon

**Body (add when the why isn't obvious):**

- Blank line between subject and body
- Wrap at 72 characters
- Explain _why_, not _what_ — the diff already shows what changed

**Examples:**

```
feat(domain): add ArrowDeleted event to applyEvent

fix(realtime): prevent broadcast to the disconnected sender

refactor(event-bus): extract publish into a standalone helper
```

### 4. Create the commit

Pass the message via heredoc to preserve formatting:

```bash
git add <specific files>
git commit -m "$(cat <<'EOF'
type(scope): subject

Optional body here.
EOF
)"
```

### 5. If the commit fails

Never use `--no-verify`. If a pre-commit hook fails, fix the underlying issue (lint error, type error, test failure) and create a **new** commit — do not amend.

---

## Subcommand: `pr`

Goal: open a pull request that reviewers can merge with confidence.

### 1. Gather context (run in parallel)

```
git status
git log main..HEAD --oneline
git diff main...HEAD
git branch --show-current
```

### 2. Branch hygiene

- Never open a PR from `main` or `master`. If on main, create a branch first:
  ```bash
  git checkout -b <type>/<short-description>
  ```
- If the branch is behind main, rebase before opening:
  ```bash
  git fetch origin && git rebase origin/main
  ```

### 3. Push

```bash
git push -u origin HEAD
```

### 4. Resolve the repo owner and name

Use `mcp__github__get_me` to get the authenticated user if needed, and derive `owner`/`repo` from `git remote get-url origin`.

### 5. Write the PR

Keep the title short (≤ 70 characters), same Conventional Commits style as a commit subject.

Call `mcp__github__create_pull_request` with:

```
owner:  <org or user>
repo:   <repo name>
title:  "<type(scope): subject>"
body:   |
  ## Summary
  - <what changed and why — 1-3 bullets>

  ## Test plan
  - [ ] <what you ran to verify it works>
  - [ ] <edge case you checked>
head:   <current branch>
base:   main
```

**Good PR body habits:**

- Link the issue if one exists: `Closes #<n>`
- Call out breaking changes explicitly
- If there are risky areas, say so — don't make reviewers discover them

### 6. After opening

Report the PR URL from the tool response to the user.

---

## Subcommand: `branch`

Goal: keep branches small, named consistently, and cleaned up.

### Naming convention

```
<type>/<short-kebab-description>
```

Examples: `feat/arrow-deletion`, `fix/broadcast-loop`, `chore/add-eslint`

### Common operations

**Create and switch:**

```bash
git checkout -b feat/my-feature
```

**List with tracking info:**

```bash
git branch -vv
```

**Delete a merged local branch:**

```bash
git branch -d feat/my-feature
```

**Delete the remote branch:**

```bash
git push origin --delete feat/my-feature
```

**Update local from remote (safe):**

```bash
git fetch --prune
```

**Rebase current branch onto main:**

```bash
git fetch origin && git rebase origin/main
```

Prefer `rebase` over `merge` when updating a feature branch from main — it keeps history linear and makes the eventual PR diff easier to review.

---

## Subcommand: `status`

Run a quick situation report and suggest the most sensible next action:

```
git status
git log --oneline -5
git stash list
```

Report:

- Working tree state (clean / dirty)
- Current branch and how far ahead/behind origin
- Any stashes
- Recommended next step (commit, push, open PR, etc.)

---

## General best practices (always apply)

- **One concern per commit.** A commit that does two unrelated things should be two commits.
- **Never force-push to main/master.** Force-push to feature branches is acceptable when rewriting history before review.
- **Never skip hooks** (`--no-verify`). If a hook blocks you, fix the root cause.
- **Never commit secrets.** If you accidentally do, treat it as a security incident: rotate the credential, then remove it from history.
- **Keep PRs small.** Under 400 lines of diff is the sweet spot. Larger PRs should be split unless they're indivisible.
- **Destructive operations need explicit user approval** before running: `git reset --hard`, `git push --force`, `git branch -D`, `git clean -f`.
