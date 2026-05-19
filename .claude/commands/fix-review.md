---
description: Triage and fix unresolved PR review comments, then commit and push.
argument-hint: "[PR#]"
---

# /fix-review

Address unresolved review feedback on a GitHub PR. One-shot: triage, fix valid comments, commit, push, reply per comment.

## Inputs

- `$1` (optional): PR number. If omitted, resolve from current branch via `gh pr view --json number,headRefName,baseRefName,state,isDraft,url,headRepositoryOwner,headRepository`. If unavailable, fall back to `git rev-parse --abbrev-ref HEAD` + `mcp__github__list_pull_requests` filtered by head.

Owner/repo: parse from `git remote get-url origin`.

## Preconditions (abort on any failure)

1. Working tree clean: `git status --porcelain` must be empty.
2. Branch up-to-date with remote: `git fetch && git rev-list --count HEAD..@{u}` must be 0.
3. PR state is `OPEN` (draft allowed). Closed/merged → abort with message.
4. Local HEAD matches PR head SHA. Mismatch → abort (someone else pushed).

On abort, print the reason and exit. Do not modify anything.

## Step 1 — Fetch threads

Call `mcp__github__pull_request_read` with `method: get_review_comments`, paginate until exhausted.

Each thread has: `id`, `isResolved`, `isOutdated`, `isCollapsed`, `comments[]` (root + replies). Each comment has `id`, `databaseId`, `user.login`, `body`, `path`, `line`, `diffHunk`.

Filter to threads where `isResolved == false`.

## Step 2 — Fetch PR diff scope

Call `mcp__github__pull_request_read` with `method: get_files`. Collect the set of file paths touched by the PR — this is the "in-scope" file set.

## Step 3 — Triage each unresolved thread

Classify into one of four buckets. Read the full thread (root + all replies) before classifying — later replies may override the root.

| Bucket | Action |
|---|---|
| `outdated` | `isOutdated == true` → skip, reply "Outdated after subsequent commits — skipping." |
| `out-of-scope` | `path` not in PR file set → skip, reply "Out of scope for this PR — please open a separate issue/PR." |
| `invalid` | Comment is wrong, contradicts repo conventions in [CLAUDE.md](../../CLAUDE.md), violates an intentional tradeoff, or a thread reply already dismissed it → skip, reply with one-sentence reason. |
| `valid` | Actionable, correct, in-scope → fix. |

Invalid criteria (be strict — push back on bad reviews):
- Suggests removing an intentional tradeoff documented in CLAUDE.md (e.g., "add CRDTs", "add auth").
- Subjective style with no repo convention backing it.
- Factually wrong about the code.
- Already addressed in a later thread reply.
- Asks for tests/docs/comments the project conventions explicitly avoid.

If uncertain → treat as `valid` and fix; reviewer can re-comment if wrong.

## Step 4 — Apply fixes

For each `valid` thread:
1. Read the file at `path`.
2. Apply the fix using `Edit`. Keep the change minimal — only what the comment asks for, no opportunistic refactors.
3. Track `commentId → status` (fixed / skipped+reason) in a TodoWrite list for the run.

If zero `valid` threads after triage:
- Still post the skip replies for outdated / out-of-scope / invalid threads.
- Print summary, exit. No commit, no push.

## Step 5 — Per-package test gate

Group changed files by top-level directory containing a `package.json`. For each such package:

```bash
cd <package> && npm test
```

Any failure → abort push, keep local state, print failures, exit. Do not commit yet if not committed; if already committed, leave the commit local and report.

Recommended order: stage + commit first (so failures don't lose work), then test, then push.

## Step 6 — Commit

Stage only files modified by this run — explicit `git add <file>` per fix, never `git add -A`. Preconditions should have caught unrelated changes.

Delegate commit creation to the [`git` skill](../skills/git/SKILL.md) via the `Skill` tool to keep commit conventions consistent across the project:

```
Skill(skill="git", args="commit chore(<scope>): address PR #<N> review")
```

Where `<scope>` is:
- A single package name (e.g., `backend`) if all fixes are confined to that package.
- Omitted (`chore: address PR #<N> review`) if fixes span multiple packages or repo root.

The `git` skill handles heredoc formatting, husky hook failures (no `--amend`), and Conventional Commits style per its SKILL.md.

## Step 7 — Push

```bash
git push
```

Capture the resulting commit SHA (`git rev-parse HEAD`) for replies.

## Step 8 — Reply per thread

For each thread acted on, call `mcp__github__add_reply_to_pull_request_comment` with `commentId` = the root comment's `databaseId`.

- Fixed: `Fixed in <sha>.`
- Outdated: `Outdated after subsequent commits — skipping.`
- Out-of-scope: `Out of scope for this PR — please open a separate issue/PR.`
- Invalid: `Skipping: <one-sentence reason>.`

Do NOT resolve threads. Reviewer (Gemini or human) resolves on re-review.

## Step 9 — Final report

Print to user:
- PR URL
- Counts: fixed / outdated / out-of-scope / invalid
- New commit SHA + push status
- Any test failures (if push aborted)

## Notes

- One-shot only. After Gemini re-reviews, user re-invokes `/fix-review` for next round.
- Do not loop, do not poll.
- Never force-push. Commit-on-top only.
- If the user has the GitHub MCP unavailable for any reason, fall back to `gh` CLI with equivalent calls.
