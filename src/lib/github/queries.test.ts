import { print } from "graphql";
import { describe, expect, it } from "vitest";

import {
  discussionCommentsQuery,
  issueCommentsQuery,
  pullRequestCommentsQuery,
  pullRequestReviewCommentsQuery,
} from "./queries";

describe("GitHub comment queries", () => {
  it("include bodyHTML field to persist rendered markdown", () => {
    const queries = [
      issueCommentsQuery,
      pullRequestCommentsQuery,
      discussionCommentsQuery,
      pullRequestReviewCommentsQuery,
    ];

    for (const query of queries) {
      const source = typeof query === "string" ? query : print(query);
      expect(source).toMatch(/bodyHTML/);
    }
  });
});
