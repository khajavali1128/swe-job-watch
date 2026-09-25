import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig, type FiltersConfig } from "../src/config/index.js";
import type { JobDetails } from "../src/types.js";

const { generateContent, parseOpenAIResponse } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  parseOpenAIResponse: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

vi.mock("openai", () => ({
  default: class {
    responses = { parse: parseOpenAIResponse };
  },
}));

import {
  validateJobWithGemini,
  validateJobWithOpenAI,
} from "../src/ai/job-validator.js";

let filters: FiltersConfig;

beforeAll(async () => {
  ({ filters } = await loadConfig());
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-key";
  generateContent.mockReset();
  parseOpenAIResponse.mockReset();
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
        citizenshipRequired: false,
        requiredYears: 5,
        experienceStatus: "OVER_LIMIT",
        reasons: ["Five years required."],
      }),
    });

    await expect(validateJobWithGemini(job, filters)).rejects.toThrow(
      "Gemini returned an inconsistent decision: expected REJECTED",
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
        citizenshipRequired: false,
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
        citizenshipRequired: false,
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
        citizenshipRequired: false,
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

  it("rejects a qualified decision when U.S. citizenship is required", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        decision: "QUALIFIED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: true,
        citizenshipRequired: true,
        requiredYears: 2,
        experienceStatus: "WITHIN_LIMIT",
        reasons: ["The role requires U.S. citizenship."],
      }),
    });

    await expect(validateJobWithGemini(job, filters)).rejects.toThrow(
      "expected REJECTED",
    );

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.stringContaining(
          "mandates an active U.S. government security clearance",
        ),
      }),
    );
  });

  it("accepts a rejected result when U.S. citizenship is required", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        decision: "REJECTED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: true,
        citizenshipRequired: true,
        requiredYears: 2,
        experienceStatus: "WITHIN_LIMIT",
        reasons: ["The role requires U.S. citizenship."],
      }),
    });

    await expect(validateJobWithGemini(job, filters)).resolves.toMatchObject({
      decision: "REJECTED",
      citizenshipRequired: true,
    });
  });
});

describe("validateJobWithOpenAI", () => {
  it("identifies OpenAI as the source of an inconsistent result", async () => {
    parseOpenAIResponse.mockResolvedValue({
      output_parsed: {
        decision: "REJECTED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: true,
        citizenshipRequired: false,
        requiredYears: 2,
        experienceStatus: "WITHIN_LIMIT",
        reasons: ["The role otherwise satisfies the configured rules."],
      },
    });

    await expect(validateJobWithOpenAI(job, filters)).rejects.toThrow(
      "OpenAI returned an inconsistent decision: expected QUALIFIED",
    );
  });

  it("deterministically rejects an active U.S. security clearance requirement", async () => {
    parseOpenAIResponse.mockResolvedValue({
      output_parsed: {
        decision: "QUALIFIED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: true,
        citizenshipRequired: false,
        requiredYears: 2,
        experienceStatus: "WITHIN_LIMIT",
        reasons: ["The role otherwise satisfies the configured rules."],
      },
    });
    const clearanceJob = {
      ...job,
      description: `
        <p>Minimum qualifications</p>
        <ul><li>Active US Security Clearance at or above the Secret level.</li></ul>
      `,
    };

    await expect(
      validateJobWithOpenAI(clearanceJob, filters),
    ).resolves.toMatchObject({
      decision: "REJECTED",
      citizenshipRequired: true,
      reasons: expect.arrayContaining([
        "The role requires an active U.S. government security clearance.",
      ]),
    });
  });

  it("deterministically rejects mandatory experience above the limit", async () => {
    parseOpenAIResponse.mockResolvedValue({
      output_parsed: {
        decision: "QUALIFIED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: true,
        citizenshipRequired: false,
        requiredYears: null,
        experienceStatus: "NOT_SPECIFIED",
        reasons: ["No mandatory experience requirement was identified."],
      },
    });
    const crowdStrikeJob = {
      ...job,
      description: `
        <p><strong>What You'll Need:</strong></p>
        <ul>
          <li>10(+) years' experience combined between backend/cloud development and data platform engineering roles</li>
          <li>5+ years of experience programming with Java, Scala or Kotlin</li>
        </ul>
      `,
    };

    await expect(
      validateJobWithOpenAI(crowdStrikeJob, filters),
    ).resolves.toMatchObject({
      decision: "REJECTED",
      requiredYears: 10,
      experienceStatus: "OVER_LIMIT",
      reasons: expect.arrayContaining([
        "The role explicitly requires at least 10 years of experience, exceeding the configured maximum of 4 years.",
      ]),
    });
  });

  it("does not treat preferred experience as mandatory", async () => {
    parseOpenAIResponse.mockResolvedValue({
      output_parsed: {
        decision: "QUALIFIED",
        roleMatch: true,
        usEligible: true,
        excludedSeniority: false,
        excludedDomain: false,
        excludedEmploymentType: false,
        sponsorshipEligible: true,
        citizenshipRequired: false,
        requiredYears: 2,
        experienceStatus: "WITHIN_LIMIT",
        reasons: ["Two years of experience are required."],
      },
    });
    const preferredExperienceJob = {
      ...job,
      description: `
        <p><strong>Minimum Qualifications</strong></p>
        <ul><li>At least 2 years of experience developing software.</li></ul>
        <p><strong>Preferred Qualifications</strong></p>
        <ul><li>5+ years of experience developing distributed systems.</li></ul>
      `,
    };

    await expect(
      validateJobWithOpenAI(preferredExperienceJob, filters),
    ).resolves.toMatchObject({
      decision: "QUALIFIED",
      requiredYears: 2,
      experienceStatus: "WITHIN_LIMIT",
    });
  });
});
