# Changelog

This file documents recent notable changes to this project. The format of this
file is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1](https://github.com/aicers/github-dashboard/compare/0.4.0...0.4.1) (2026-11-22)


### Other

* automate releases with release-please ([#596](https://github.com/aicers/github-dashboard/issues/596)) ([dd640c4](https://github.com/aicers/github-dashboard/commit/dd640c4d975a82a8dd110964a1d28ad4f5c82558))
* count the triggering CI run as passed in the release gate ([#608](https://github.com/aicers/github-dashboard/issues/608)) ([a1d12b1](https://github.com/aicers/github-dashboard/commit/a1d12b1a992737e0ac7b7d9c38c8f09977bbb979)), closes [#607](https://github.com/aicers/github-dashboard/issues/607)
* limit release checks to titles and merge-commit CI ([#602](https://github.com/aicers/github-dashboard/issues/602)) ([7dcdf59](https://github.com/aicers/github-dashboard/commit/7dcdf5926d8668976a871a8790d9ad6b04c33034))
* update shared instruction blocks to 0.6.3 ([#605](https://github.com/aicers/github-dashboard/issues/605)) ([b537e9c](https://github.com/aicers/github-dashboard/commit/b537e9cf225e996d255dc7b3b4ef66beaf6fbd7f))
* update shared instruction blocks to 0.6.4 ([#606](https://github.com/aicers/github-dashboard/issues/606)) ([575bd1d](https://github.com/aicers/github-dashboard/commit/575bd1d39aa5c3bb3fd8da3f8e9696c0c1256018))

## [0.4.0] - 2026-11-22

### Changed

- Upgraded the runtime baseline to Next.js 16, React 19, and Node 24, and
  aligned the related CI, Docker, dependency, and documentation settings with
  that stack.

### Fixed

- Improved first-run database bootstrap diagnostics so missing `public` schema
  privileges are reported clearly and schema initialization can be retried after
  fixing the role grants.
- Prevented recoverable hydration mismatches in dashboard timestamp badges by
  normalizing locale-specific spacing differences and suppressing expected
  client-only text variance for auto-formatted timestamps.
- Recovered transient post-login dashboard fetch failures by refreshing and
  retrying the first unauthorized client-side requests for Analytics, People,
  Activity saved filters, and the shared sync status panel.
- Fixed date picker calendar showing weekdays off by one (e.g., Wednesday
  dates appearing under Tuesday) due to a mismatch between the Sunday-first
  header and Luxon's Monday-first grid start.
- Fixed review participation metric computing the inverse ratio (requested
  over responded) instead of the correct responded-over-requested ratio.
- Fixed date picker crashing when the Clear button was clicked in custom
  date-range mode.

## [0.3.1] - 2026-02-18

### Changed

- Switched the unanswered-mention classification model default/config examples
  from `gpt-4` to `gpt-5-mini`.

### Fixed

- Kept the Sync tab's "Sync in progress" banner visible until all post-sync
  steps complete (`reaction-refresh`, `status-automation`,
  `activity-snapshot`, `activity-cache`, and `unanswered-mentions`) instead of
  hiding immediately after GitHub collection.

## [0.3.0] - 2026-02-01

### Changed

- Improved long-lived sign-in handling with reauthentication prompts for
  sensitive settings and cleanup actions, plus device/IP heuristics for
  higher-risk flows.
  - Added configurable session TTL defaults (access, idle, refresh, max
    lifetime) and surfaced them in organization settings.
- Included Done issues without an In Progress event in average work-time
  calculations by falling back to the issue creation timestamp.

### Fixed

- Fixed the Activity filter for "응답 없는 리뷰 요청" so person selection matches the
  pending review request recipient (stuck reviewer), not anyone listed as a PR
  reviewer.
- Limited "리뷰어 미지정 PR" follow-ups to open pull requests only.

## [0.2.0] - 2025-12-22

### Added

- Displayed author, reviewer, assignee, and repository maintainer in the
  Activity/Follow-ups overlay panel header.

### Changed

- Changed the default thresholds for "응답 없는 리뷰 요청" and "응답 없는 멘션" from
  5 days to 2 days in Activity/Follow-ups.
- Replaced the Activity/Follow-ups PR "주의" grouping with three explicit
  follow-ups: "리뷰어 미지정 PR", "리뷰 정체 PR", and "머지 지연 PR".
  - Updated PR follow-up thresholds to use a configurable "업무일" calculation
    (defaulting to 2 days) that respects per-person timezone, personal time off,
    and selected holiday calendars (falling back to `Asia/Seoul` when settings
    are missing).
  - **Breaking:** Legacy "업데이트 없는 PR" / `pr_inactive` / `pr_open_too_long`
    saved filters and URL params are migrated to `pr_review_stalled`
    (리뷰 정체 PR) only. Review and adjust saved filters if you previously relied
    on the older PR attention semantics.

### Fixed

- Prevented list misalignment for long titles.
- Prevented Transfer sync and DB backup schedules from getting stuck showing
  "진행 중" while waiting for other jobs by tracking a distinct waiting state.
- Added timeouts and admin cleanup actions for stuck Transfer sync and DB backup
  runs.
- Fixed inverted "최근 실행" date ranges by clearing the last completed timestamp
  when a new run starts.

## [0.1.0] - 2025-12-21

### Added

- Initial public release of the GitHub Dashboard

[0.4.0]: https://github.com/aicers/github-dashboard/compare/0.3.1...0.4.0
[0.3.1]: https://github.com/aicers/github-dashboard/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/aicers/github-dashboard/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/aicers/github-dashboard/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/aicers/github-dashboard/tree/0.1.0
