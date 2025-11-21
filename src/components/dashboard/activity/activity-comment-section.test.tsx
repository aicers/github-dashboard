import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ActivityItemComment, ActivityUser } from "@/lib/activity/types";
import {
  ActivityCommentSection,
  buildDiscussionCommentTree,
} from "./detail-shared";

const baseAuthor: ActivityUser = {
  id: "user-1",
  login: "user1",
  name: "User One",
  avatarUrl: null,
};

function createComment(
  overrides: Partial<ActivityItemComment> & { id: string },
): ActivityItemComment {
  return {
    id: overrides.id,
    author: overrides.author ?? baseAuthor,
    body: overrides.body ?? null,
    bodyHtml: overrides.bodyHtml ?? `<p>${overrides.id}</p>`,
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2024-01-01T00:00:00Z",
    url: overrides.url ?? null,
    reviewId: overrides.reviewId ?? null,
    replyToId: overrides.replyToId ?? null,
    isAnswer: overrides.isAnswer ?? false,
    reactions: overrides.reactions ?? [],
    commitContext: overrides.commitContext ?? null,
    projectContext: overrides.projectContext ?? null,
    reviewerContext: overrides.reviewerContext ?? null,
  };
}

describe("buildDiscussionCommentTree", () => {
  it("groups replies beneath their parent comment", () => {
    const comments = [
      createComment({ id: "root" }),
      createComment({ id: "reply-1", replyToId: "root" }),
      createComment({ id: "reply-2", replyToId: "reply-1" }),
      createComment({ id: "orphan" }),
    ];

    const tree = buildDiscussionCommentTree(comments);

    expect(tree).toHaveLength(2);
    expect(tree[0]?.comment.id).toBe("root");
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.comment.id).toBe("reply-1");
    expect(tree[0]?.children[0]?.children[0]?.comment.id).toBe("reply-2");
    expect(tree[1]?.comment.id).toBe("orphan");
  });

  it("treats replies without a parent as root nodes", () => {
    const comments = [
      createComment({ id: "lonely", replyToId: "missing-parent" }),
    ];

    const tree = buildDiscussionCommentTree(comments);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.comment.id).toBe("lonely");
    expect(tree[0]?.children).toHaveLength(0);
  });
});

describe("ActivityCommentSection", () => {
  const threadedComments = [
    createComment({ id: "root", bodyHtml: "<p>Root comment</p>" }),
    createComment({
      id: "child",
      replyToId: "root",
      bodyHtml: "<p>First reply</p>",
    }),
    createComment({
      id: "grandchild",
      replyToId: "child",
      bodyHtml: "<p>Nested reply</p>",
    }),
  ];

  it("renders flat comments for non-discussion contexts", () => {
    const { container } = render(
      <ActivityCommentSection
        comments={threadedComments}
        commentContext="issue"
      />,
    );

    expect(container.querySelectorAll("article")).toHaveLength(3);
    expect(container.querySelectorAll(".border-l")).toHaveLength(0);
  });

  it("renders nested replies only for discussions", () => {
    const { container } = render(
      <ActivityCommentSection
        comments={threadedComments}
        commentContext="discussion"
      />,
    );

    const nestedWrappers = container.querySelectorAll(".border-l");
    expect(nestedWrappers).toHaveLength(2);
    expect(nestedWrappers[0]?.textContent).toContain("First reply");
    expect(nestedWrappers[1]?.textContent).toContain("Nested reply");
  });
});
