import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { acquireNewToken } from "../utils/github.ts";
import { getReviewData } from "./reviewComments.ts";

async function getToken(): Promise<string> {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  return await acquireNewToken();
}

describe("getFormattedReviewThreads", () => {
  it("formats thread blocks with TOC and correct line numbers", { timeout: 30000 }, async () => {
    const token = await getToken();
    const octokit = new Octokit({ auth: token });

    const { formatted } = (await getReviewData({
      octokit,
      owner: "pullfrog",
      name: "scratch",
      pullNumber: 49,
      reviewId: 3485940013,
    }))!;

    expect(formatted.toc).toMatchSnapshot("toc");
    expect(formatted.content).toMatchSnapshot("content");
  });

  it("formats body-only review", { timeout: 30000 }, async () => {
    const token = await getToken();
    const octokit = new Octokit({ auth: token });

    const { formatted } = (await getReviewData({
      octokit,
      owner: "pullfrog",
      name: "scratch",
      pullNumber: 64,
      reviewId: 3531000326,
    }))!;

    expect(formatted.toc).toMatchSnapshot("toc");
    expect(formatted.content).toMatchSnapshot("content");
  });
});
