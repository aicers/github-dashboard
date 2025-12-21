# Changelog

This file documents recent notable changes to this project. The format of this
file is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Displayed author, reviewer, assignee, and repository maintainer in the
  Activity/Follow-ups overlay panel header.

### Changed

- Replaced the Activity/Follow-ups PR "주의" grouping with three explicit
  follow-ups: "리뷰어 미지정 PR", "리뷰 정체 PR", and "머지 지연 PR".
- Updated PR follow-up thresholds to use a configurable "업무일" calculation
  (defaulting to 2 days) that respects per-person timezone + personal time off +
  selected holiday calendars (falling back to `Asia/Seoul` when settings are
  missing).

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

[Unreleased]: https://github.com/aicers/github-dashboard/compare/0.1.0...HEAD
[0.1.0]: https://github.com/aicers/github-dashboard/tree/0.1.0
