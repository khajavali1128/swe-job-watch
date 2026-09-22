import { afterEach, describe, expect, it, vi } from "vitest";

import { ByteDanceAdapter } from "../src/adapters/bytedance.js";
import type { ByteDanceCompanyConfig } from "../src/config/index.js";

const company: ByteDanceCompanyConfig = {
  id: "tiktok",
  name: "TikTok",
  enabled: true,
  adapter: "bytedance",
  handle: "tiktok",
  apiBaseUrl: "https://api.lifeattiktok.com/api/v1/public/supplier",
  careerBaseUrl: "https://lifeattiktok.com/search",
  websitePath: "tiktok",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ByteDanceAdapter", () => {
  it("paginates, normalizes jobs, and reuses cached descriptions", async () => {
    const job = (index: number) => ({
      id: String(7000 + index),
      title: index === 100 ? "Backend Software Engineer" : `Role ${index}`,
      description: "Build reliable software platforms.",
      requirement: "Three years of professional experience required.",
      city_info: {
        en_name: "San Jose",
        parent: {
          en_name: "California",
          parent: {
            en_name: "United States of America",
          },
        },
      },
    });
    const firstPage = Array.from({ length: 100 }, (_, index) => job(index));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          message: "ok",
          data: { job_post_list: firstPage, count: 101 },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          message: "ok",
          data: { job_post_list: [job(100)], count: 101 },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new ByteDanceAdapter();
    const summaries = await adapter.fetchJobSummaries(company);

    expect(summaries).toHaveLength(101);
    expect(summaries[100]).toMatchObject({
      jobId: "7100",
      title: "Backend Software Engineer",
      location: "San Jose, California, United States of America",
      url: "https://lifeattiktok.com/search/7100",
      postedAt: null,
      updatedAt: null,
      source: "bytedance",
    });

    const firstRequest = fetchMock.mock.calls[0];
    expect(String(firstRequest?.[0])).toBe(
      "https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts",
    );
    expect(firstRequest?.[1]?.headers).toMatchObject({
      Origin: "https://lifeattiktok.com",
      Referer: "https://lifeattiktok.com/search",
      "website-path": "tiktok",
    });
    expect(JSON.parse(String(firstRequest?.[1]?.body))).toEqual({
      keyword: "",
      limit: 100,
      offset: 0,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).offset).toBe(
      100,
    );

    await expect(
      adapter.fetchJobDetails(company, summaries[100]!),
    ).resolves.toMatchObject({
      description:
        "Build reliable software platforms.\n\nQualifications\nThree years of professional experience required.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when the API returns an error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ code: 1001, message: "invalid website path" }),
      ),
    );

    await expect(
      new ByteDanceAdapter().fetchJobSummaries(company),
    ).rejects.toThrow(
      "ByteDance request failed for TikTok: invalid website path",
    );
  });
});
