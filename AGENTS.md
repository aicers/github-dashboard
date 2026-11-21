# GitHub Dashboard — Agent Guide

<!-- BEGIN shared:workflow -->
## Branching and pushing

- NEVER push directly to `main`. Always create a new branch before
  pushing.
- Branch names must follow the format `<github-username>/issue-#` (e.g.,
  `alice/issue-42`). If there is no related issue, ask the user how to
  proceed before creating the branch.
- The sole exception is a branch carrying an update to the shared blocks
  below, which needs no issue. CI opens it as
  `shared-instructions/<release>`; a maintainer running the fan-out by
  hand opens it as `<github-username>/instructions-<release>`.

## GitHub issues and PRs

- Do NOT hard-wrap lines in issue or PR body text. GitHub renders
  Markdown, so manual line breaks hurt readability. (This applies to the
  body text only — commit messages still wrap at 72.)
- Issues and PRs share ONE number namespace, so `gh issue edit N` and
  `gh issue view N` can silently operate on PR #N when N is a PR. Before
  ANY `gh` write (edit, close, comment), confirm the target's type and
  identity with a read first: `gh issue view N --json
  number,title,state,url`, and check `/pull/` vs `/issues/` in the URL.
- Never act on failed or garbled command output. Re-verify every create
  and edit with a structured `--json` re-query before reporting success.
- A body that was overwritten is recoverable: GitHub keeps every prior
  version, and `gh api graphql` reads them out of
  `userContentEdits(first: N) { nodes { editedAt editor { login } diff } }`
  on the issue or pull request. Restore the one you want with
  `--body-file`. Do NOT retype it from memory — a body that reads like
  the original and is not is worse than the empty one it replaced.

## Referring to other issues and PRs

- Any reference GitHub recognizes as an issue or PR posts an entry on
  that issue's or PR's timeline: a bare `#N`, `GH-N`, `owner/repo#N`,
  its URL (a link to one of its comments or a URL with a query
  included), and a Markdown or HTML link to that URL alike. Editing the
  text or deleting the comment afterwards does not remove the entry, so
  choose the form before you post.
- Ask one question of every reference: once the other side sees it,
  does it give them something to do or something to avoid?
  - **Yes: link it.** Use `#N` within the repository and `owner/repo#N`
    across repositories. This covers closes, part of, depends on or
    blocks, follow-up of, taking over part of its work, parent or
    child, and supersedes or duplicates. On a pull request, the
    narrower bullet below applies. An issue that takes over part of
    another's work links it: when AgentCoop's verification finds
    work missing from an issue, it looks for an owner only among that
    issue's open siblings and the issues of its repository that
    mention it.
  - **No: use a form that posts no entry.** A PR as its
    `https://github.com/owner/repo/pull/N/files` URL; a commit as its
    SHA and title; a range of commits as one
    `https://github.com/owner/repo/compare/A...B` URL; an issue as its
    full URL in a code span,
    `` `https://github.com/owner/repo/issues/N` ``. Never a bare
    `` `#N` `` in a code span: it names no repository. Describe what
    must be left alone by what it is ("every other open PR based on
    `main`"), not by listing numbers. If you find yourself returning to
    the target as you work, your work relies on it, and the answer is
    yes.
- Quoting text with `>` posts entries again for every reference in it,
  and a `<details>` block does not stop them. Put pasted logs and
  command output in a fenced code block, where references post none.
- Anywhere on a pull request (its body, a comment, a review, an inline
  review comment), link an issue of the same repository only if the
  pull request delivers it, and then as `Closes #N` or `Part of #N` in
  the body, never in a code span. AgentCoop's verification takes every
  merged pull request that mentions an issue anywhere as a candidate,
  and an agent judges from its title and body whether it delivered that
  issue; a `Part of #N` link is the only trace a partial delivery
  leaves. State any other relationship in the issue.
- Leave the references in the sections AgentCoop writes as they are:
  `## Children`, `## Dependencies` and `## Execution order` in the
  issues it files, and `## Implementation deviations`, between its HTML
  comment markers, in any issue it implements. It reads some of them
  back, and its verification walks the entries they post.

## Markdown lint configuration

- The repository-root `.markdownlint-cli2.yaml` carries `globs`,
  `ignores`, and `MD024: siblings_only`. No other rule configuration
  belongs there, and no rule is disabled there.
- Configure or disable any other rule at the narrowest scope that
  works, choosing in this order: the line, then the file, then the
  directory. Use `markdownlint-disable-next-line` for one line,
  `markdownlint-disable-file` for one file, and a
  `.markdownlint-cli2.yaml` beside the files for one directory.
- A directory config named `.markdownlint-cli2.yaml` merges with the
  root config; one named `.markdownlint.yaml` replaces it wholesale.
  Use the former.
- Scope narrowly because a global entry outlives its reason. It
  silences the file that needed it and every file added afterwards
  that should have tripped the rule, and nothing in the config records
  which was which.

## Shared instruction blocks

- The regions between `<!-- BEGIN shared:... -->` and
  `<!-- END shared:... -->` in this file are generated from a shared
  source. Do NOT edit them here. Change the wording upstream and cut a
  release there; it arrives as a pull request against this repository.
  An edit made here is overwritten by the next one of those, and turns
  the drift check red until it lands.
- `.agent-instructions.toml` records which release those regions came
  from and which blocks this repository carries. It is source, not tool
  output: the drift check reads it, the apply rewrites it, and nothing
  generates it from anything else. Never add it to `.gitignore`, and
  never untrack it — a repository whose pin cannot be read fails the
  check outright rather than being read as carrying no blocks.

## Attribution

- Do NOT add `Co-Authored-By` lines naming an AI (`Claude`, `Codex`,
  `Gemini`, or any similar name) to commit messages.
- Do NOT add "Generated with Claude Code", "Generated with Codex",
  "Generated with Gemini", or any similar AI attribution to PR
  descriptions or issue comments.
<!-- END shared:workflow -->

<!-- BEGIN shared:commit-messages -->
## Commit messages

- Pull requests are squash-merged, and a pull request's title becomes
  the title of its squash commit. So the title follows Conventional
  Commits 1.0.0: `<type>[(<scope>)][!]: <description>`.
- `<type>` is one of `feat`, `fix`, `docs`, `style`, `refactor`,
  `perf`, `test`, `build`, `ci`, `chore`, or `revert`. A dependency
  update is `chore(deps)`.
- A breaking change puts `!` before the colon, as in
  `feat(api)!: drop the v1 endpoints`. A `BREAKING CHANGE:` footer
  alone is not enough: merge checks and reviewers read only the title.
  A breaking change that alters only a wire or stored format takes `!`
  too, even though no API compatibility check detects it.
- The description is English and imperative, starts with a lowercase
  letter, and has no trailing period and no issue or PR number. The
  merge appends the pull request's number to it, as `(#N)`.
- Write the description as a line a user of the release would read:
  what changed for them, not how the code got there.
- The pull request body carries `Closes #N`, or `Part of #N` when the
  pull request delivers part of the issue; `Closes #N` closes the issue
  at merge. The pull request body does not become the squash commit's
  body: the merge takes the body of the commit message an AgentCoop run
  suggested on the pull request, else the body of the pull request's
  only commit, else no body. A `## Changelog` section in the pull
  request body, where the Changelog rules call for one, is appended
  after it.
- Body: wrap at 72 characters, free-form, explain *why* not *what*.
- Separate title and body with a blank line.
- Do NOT rely on literal `\n` escapes for a commit body — they land in
  the subject line as characters, and git reports success. Use a real
  multiline string, or `git commit -F` with a file or heredoc.
- Reference issues in the body, not the title, and only the issue the
  commit delivers: `Closes #N` to close it, or `Part of #N` when the
  commit addresses part of it. Every new version of the commit you
  push, after an amend or a rebase, posts another entry on the timeline
  of each issue it names.
<!-- END shared:commit-messages -->

<!-- BEGIN shared:agentcoop -->
## AgentCoop

AgentCoop is the AI agent orchestration system this organization runs
over its GitHub issues, so its vocabulary turns up in issue bodies and
pull request comments here — and an agent working in this repository
may itself be running inside it.

- Two agents do the work. The **author** (Agent A) produces, the
  **reviewer** (Agent B) reviews independently, and the two converge
  through structured feedback; a deadlock escalates to a human rather
  than resolving silently. They are usually different models.
- **Implementation** turns one issue into a pull request with green CI.
  The author implements it in a dedicated worktree, self-checks, opens
  the pull request, and drives CI to green; the reviewer then reviews
  the pushed branch and the two iterate in the pull request's comment
  thread, tagged `[Author Round N]` and `[Reviewer Round N]`, until it
  is approved.
- **Design** shapes work into issues: an RFC file becomes an umbrella
  issue over a sub-issue tree, or a single issue is refined — and split
  only when one pull request cannot cover it.
- **Verification** holds a completed issue against the diffs that closed
  it and files follow-up sub-issues for whatever it did not deliver.
- The issue is the contract, and the only input a run is given. A human
  writes that seed and merges the result; AgentCoop invents no
  requirement and asks no clarifying question along the way.
<!-- END shared:agentcoop -->

<!-- BEGIN shared:node -->
## Package manager

- This project uses **pnpm** exclusively. NEVER use `npm`, `bun`, `yarn`,
  or any other package manager.
- Run CLI tools through `pnpm`. For linting, formatting and type checking,
  prefer the `package.json` scripts over hand-written equivalents: a script
  runs the tool with the options and configuration CI uses. NEVER use `npx`:
  where the name is not already installed it resolves and installs a remote
  package instead of failing, so a typo or a dependency someone dropped
  becomes a silent download. Run a project dependency with
  `pnpm exec <tool>`. Run a one-off that is deliberately not a dependency —
  a scaffolder, a utility a scheduled job reaches for — with
  `pnpm dlx <tool>@<version>`, naming an exact version and never a dist-tag:
  `@latest` pins nothing, so a scheduled run executes whatever was published
  since the last one.
- Install with the lockfile as the authority — CI runs
  `pnpm install --frozen-lockfile`, so a `package.json` change that never
  reached `pnpm-lock.yaml` fails there instead of resolving to something
  nobody chose.
- Do not add a dependency for something an existing dependency already
  provides, and do not add one without a stated reason.

## TypeScript

- Do not use `any`. Data crossing a boundary — a network response, a
  file, an environment variable, a third-party callback — enters as
  `unknown` and is validated or narrowed at that boundary, before
  anything downstream sees it.
- Do not suppress a TypeScript or Biome diagnostic — `@ts-expect-error`,
  `biome-ignore` — without a comment saying why the suppression is
  correct. Never `@ts-ignore`: it outlives the error it was written for
  and goes on hiding whatever appears on that line next, where
  `@ts-expect-error` fails once the error it names is gone.
- A suppression is not a substitute for a type. Where a rule here already
  names what to write instead — `unknown` and a narrowing, a discriminated
  union, the type a dependency already exports — write that. Suppressing
  the rule that forbids `any` still leaves an `any`, and a comment
  recording that the real type was inconvenient is not a reason. What
  makes one is a shape nobody here controls, or a test whose point is
  that the code under it does not type-check:

  ```ts
  // biome-ignore lint/suspicious/noExplicitAny: the vendor declares this
  // callback `any`; every value out of it is narrowed before use
  ```

- Never write a double assertion (`as unknown as T`). A single `as` still
  has to be plausible to the compiler; routing through `unknown` removes
  even that, so what is left asserts a relationship nothing checked. This
  binds the code you write — generated output belongs to whatever emits
  it, and editing it by hand is undone on the next run.
- Do not use non-null assertions (`!`) to satisfy the compiler. Narrow the
  value, or handle the absent case.
- Prefer discriminated unions over optional fields when a finite set of
  shapes is expected.
- Never interpolate a secret into a log line, an error message, or a
  serialized response.
<!-- END shared:node -->

<!-- BEGIN shared:changelog -->
## Changelog

- `CHANGELOG.md` is generated by the release tool. Nobody edits it
  outside the release pull request that tool opens: an edit made
  anywhere else is overwritten by the next release.
- Its entries are the titles of the pull requests merged since the last
  release. A pull request's title is therefore its changelog entry, and
  the Commit messages rules say how to write it.
<!-- END shared:changelog -->

## Purpose

- Onboard AI/people quickly: what to run, what to watch for, and how to avoid
  common pitfalls.

## Quick dev loop

- Install: `pnpm install` → `pnpm approve-builds`
- Browsers (one-time): `pnpm exec playwright install --with-deps`
- Run dev: `pnpm dev` (Next.js 16; Turbopack is the default dev bundler)

## Quality gates (run after every code change)

- `biome ci --error-on-warnings .` — lint/format check; warnings fail the run.
- `pnpm run typecheck` — TypeScript types; uses project tsconfig.
- `pnpm lint:md` — markdownlint for docs.

CI also reruns these on every pull request and on pushes to `main`; keep them
green locally to avoid surprises.

## Useful scripts

- Lint/format: `pnpm lint`, `pnpm format:check`, `pnpm format`
- Tests: `pnpm test`, `pnpm test:db` (needs Postgres), `pnpm test:e2e`
  (Playwright)
- CI bundle: `pnpm ci` (lint → typecheck → tests)

## Env basics

- Copy `.env.example` to `.env.local`; fill `GITHUB_TOKEN`, `GITHUB_ORG`,
  `GITHUB_OAUTH_CLIENT_ID/SECRET`, `APP_BASE_URL`, `DATABASE_URL`,
  `SESSION_SECRET`, `DASHBOARD_ADMIN_IDS`.

## Language

- Code comments: English.
- Commit messages: English.
- GitHub issue and pull request bodies, and comments on them: English.
