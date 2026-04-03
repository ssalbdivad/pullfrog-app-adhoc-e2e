import { type } from "arktype";
import type { ToolContext } from "./server.ts";
import { execute, tool } from "./shared.ts";

const CLOSING_ISSUES_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 10) {
        nodes { number title }
      }
    }
  }
}
`;

type ClosingIssuesResponse = {
  repository: {
    pullRequest: {
      closingIssuesReferences: { nodes: Array<{ number: number; title: string }> };
    };
  };
};

export const PullRequestInfo = type({
  pull_number: type.number.describe("The pull request number to fetch"),
});

export function PullRequestInfoTool(ctx: ToolContext) {
  return tool({
    name: "get_pull_request",
    description:
      "Retrieve PR metadata (title, body, state, branches, author, labels, linked issues). To checkout a PR branch locally, use checkout_pr instead.",
    parameters: PullRequestInfo,
    execute: execute(async ({ pull_number }) => {
      // fetch REST and GraphQL in parallel
      const [restResponse, graphqlResponse] = await Promise.all([
        ctx.octokit.rest.pulls.get({
          owner: ctx.repo.owner,
          repo: ctx.repo.name,
          pull_number,
        }),
        ctx.octokit.graphql<ClosingIssuesResponse>(CLOSING_ISSUES_QUERY, {
          owner: ctx.repo.owner,
          repo: ctx.repo.name,
          number: pull_number,
        }),
      ]);

      const data = restResponse.data;
      const isFork = data.head.repo?.full_name !== data.base.repo.full_name;
      const closingIssues = graphqlResponse.repository.pullRequest.closingIssuesReferences.nodes;

      return {
        number: data.number,
        url: data.html_url,
        title: data.title,
        body: data.body,
        state: data.state,
        draft: data.draft,
        merged: data.merged,
        maintainerCanModify: data.maintainer_can_modify,
        base: data.base.ref,
        head: data.head.ref,
        isFork,
        author: data.user?.login,
        assignees: data.assignees?.map((a) => a.login),
        labels: data.labels.map((l) => l.name),
        closingIssues: closingIssues.map((i) => ({ number: i.number, title: i.title })),
      };
    }),
  });
}
