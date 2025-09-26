export const organizationMetricTooltips = {
  issuesCreated: "선택한 기간 동안 생성된 이슈 개수입니다.",
  issuesClosed: "선택한 기간 동안 종료된 이슈 개수입니다.",
  issueResolutionTime: "이슈 생성부터 종료까지 걸린 평균 시간입니다.",
  issueWorkTime:
    "설정된 프로젝트 보드에서 진행 상태로 이동한 시점부터 완료 상태까지의 평균 시간입니다.",
  prsCreated:
    "선택한 기간 동안 생성된 Pull Request 개수입니다. Dependabot PR은 제외됩니다.",
  prsMerged:
    "선택한 기간 동안 병합된 Pull Request 개수입니다. Dependabot PR은 제외됩니다.",
  reviewParticipation:
    "리뷰 요청에 응답한 구성원의 비율(응답한 리뷰어 수 ÷ 요청된 리뷰어 수)입니다. Dependabot PR은 제외됩니다.",
  reviewResponseTime:
    "리뷰 요청이 생성된 후 첫 응답까지 걸린 평균 업무 시간입니다. 주말과 지정 휴일은 제외하며 Dependabot PR은 제외됩니다.",
  parentIssueResolutionTime:
    "부모 이슈(다른 이슈를 하위 이슈로 포함하는 이슈)의 생성부터 종료까지 걸린 평균 시간입니다.",
  parentIssueWorkTime:
    "부모 이슈가 프로젝트 보드에서 진행 상태로 이동한 시점부터 완료 상태까지의 평균 시간입니다.",
  childIssueResolutionTime:
    "Child 이슈(부모 이슈에 의해 추적되거나 부모가 없는 독립 이슈 포함)의 생성부터 종료까지 걸린 평균 시간입니다.",
  childIssueWorkTime:
    "Child 이슈(부모 이슈에 의해 추적되거나 부모가 없는 독립 이슈 포함)가 프로젝트 보드에서 진행 상태로 이동한 시점부터 완료 상태까지의 평균 시간입니다.",
} as const;

export const individualMetricTooltips = {
  issuesCreated: "이 구성원이 생성한 이슈 개수입니다.",
  issuesClosed: "이 구성원이 종료한 이슈 개수입니다.",
  issueResolutionTime: "이 구성원이 처리한 이슈의 평균 해결 시간입니다.",
  issueWorkTime: "이 구성원의 프로젝트 보드 작업 시간 평균입니다.",
  prsCreated: "이 구성원이 생성한 Pull Request 개수입니다.",
  prsMerged:
    "이 구성원이 작성한 Pull Request 가운데 선택한 기간 동안 병합된 개수입니다.",
  prsMergedBy:
    "이 구성원이 직접 머지 완료한 Pull Request 개수입니다 (본인 PR 포함).",
  reviewsCompleted:
    "이 구성원이 완료한 리뷰 개수입니다. Dependabot이 생성한 Pull Request는 제외됩니다.",
  reviewResponseTime:
    "이 구성원이 리뷰 요청을 받은 후 응답하기까지 걸린 평균 업무 시간입니다. 주말과 지정 휴일은 제외되며 Dependabot이 생성한 Pull Request는 제외됩니다.",
  reviewCoverage:
    "선택한 기간 동안 머지된 PR 가운데 이 구성원이 리뷰에 참여한 PR 비율입니다. (리뷰한 PR 수 ÷ 동일 기간 머지된 PR 수) Dependabot이 생성한 Pull Request는 제외됩니다.",
  reviewParticipation: "이 구성원의 리뷰 참여 비율입니다.",
  discussionComments: "이슈와 PR에서 남긴 코멘트 개수입니다.",
  parentIssueResolutionTime:
    "이 구성원이 담당한 부모 이슈의 평균 해결 시간입니다.",
  parentIssueWorkTime:
    "이 구성원이 담당한 부모 이슈의 프로젝트 보드 작업 시간 평균입니다.",
  childIssueResolutionTime:
    "이 구성원이 담당한 Child 이슈(부모 이슈에 의해 추적되거나 독립적으로 존재하는 이슈)의 평균 해결 시간입니다.",
  childIssueWorkTime:
    "이 구성원이 담당한 Child 이슈의 프로젝트 보드 작업 시간 평균입니다.",
  prsReviewed: "이 구성원이 리뷰한 Pull Request 개수입니다.",
  reviewComments: "이 구성원이 남긴 리뷰 코멘트 개수입니다.",
  reopenedIssues: "이 구성원이 다시 연 이슈 개수입니다.",
} as const;
