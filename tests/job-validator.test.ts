import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig, type FiltersConfig } from "../src/config/index.js";
import type { JobDetails } from "../src/types.js";

const { generateContent } = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { validateJobWithGemini } from "../src/ai/job-validator.js";

let filters: FiltersConfig;

beforeAll(async () => {
  ({ filters } = await loadConfig());
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  generateContent.mockReset();
});

const job: JobDetails = {
  companyId: "example",
  companyName: "Example",
  jobId: "job-1",
  title: "Software Engineer",
  location: "New York, NY",
  url: "https://example.com/jobs/job-1",
  postedAt: new Date(),
  updatedAt: null,
  source: "greenhouse",
  description: "Requires 5 years of professional experience.",
};

describe("validateJobWithGemini", () => {
  it("rejects a decision that contradicts an over-limit experience result", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        decision: "QUALIFIED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: true,
        requiredYears: 5,
        experienceStatus: "OVER_LIMIT",
        reasons: ["Five years required."],
      }),
    });

    await expect(validateJobWithGemini(job, filters)).rejects.toThrow(
      "expected REJECTED",
    );
  });

  it("accepts a logically consistent rejected result", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        decision: "REJECTED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: true,
        requiredYears: 5,
        experienceStatus: "OVER_LIMIT",
        reasons: ["Five years required."],
      }),
    });

    await expect(validateJobWithGemini(job, filters)).resolves.toMatchObject({
      decision: "REJECTED",
      requiredYears: 5,
      experienceStatus: "OVER_LIMIT",
    });
  });

  it("rejects a qualified decision when sponsorship is unavailable", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        decision: "QUALIFIED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: false,
        requiredYears: 2,
        experienceStatus: "WITHIN_LIMIT",
        reasons: ["The employer does not provide visa sponsorship."],
      }),
    });

    await expect(validateJobWithGemini(job, filters)).rejects.toThrow(
      "expected REJECTED",
    );
  });

  it("accepts a rejected result when sponsorship is unavailable", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        decision: "REJECTED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: false,
        requiredYears: 2,
        experienceStatus: "WITHIN_LIMIT",
        reasons: ["The employer does not provide visa sponsorship."],
      }),
    });

    await expect(validateJobWithGemini(job, filters)).resolves.toMatchObject({
      decision: "REJECTED",
      sponsorshipEligible: false,
    });
  });
});
