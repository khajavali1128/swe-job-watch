import { GoogleGenAI } from "@google/genai";
import { load, type CheerioAPI } from "cheerio";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type { FiltersConfig } from "../config/index.js";
import type { JobDetails } from "../types.js";

export const JobValidationResultSchema = z
  .object({
    roleMatch: z.boolean(),
    usEligible: z.boolean(),
    excludedSeniority: z.boolean(),
    excludedDomain: z.boolean(),
    excludedEmploymentType: z.boolean(),
    sponsorshipEligible: z.boolean(),
    citizenshipRequired: z.boolean(),
    hiringContactName: z.string().trim().min(1).nullable(),
    hiringContactEmail: z
      .string()
      .trim()
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
      .nullable(),
    requiredYears: z.number().nonnegative().nullable(),
    experienceStatus: z.enum([
      "WITHIN_LIMIT",
      "OVER_LIMIT",
      "NOT_SPECIFIED",
    ]),
    decision: z.enum(["QUALIFIED", "REJECTED"]),
    reasons: z.array(z.string().trim().min(1)),
  })
  .strict();

export type JobValidationResult = z.infer<
  typeof JobValidationResultSchema
>;

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_OPENAI_MODEL = "gpt-5-nano";
const responseJsonSchema = z.toJSONSchema(JobValidationResultSchema);
delete (responseJsonSchema as Record<string, unknown>).$schema;
(responseJsonSchema as Record<string, unknown>).propertyOrdering = [
  "roleMatch",
  "usEligible",
  "excludedSeniority",
  "excludedDomain",
  "excludedEmploymentType",
  "sponsorshipEligible",
  "citizenshipRequired",
  "hiringContactName",
  "hiringContactEmail",
  "requiredYears",
  "experienceStatus",
  "decision",
  "reasons",
];

function buildPrompt(job: JobDetails, filters: FiltersConfig): string {
  const qualificationRules = {
    location: filters.location,
    roles: filters.roles,
    seniority: filters.seniority,
    experience: filters.experience,
    employmentType: filters.employmentType,
    sponsorship: filters.sponsorship,
  };

  return `You are validating a job opening against configured qualification rules.

Evaluate the actual responsibilities and mandatory requirements, not isolated keyword mentions.

Rules:
- Role match: software development must be a core responsibility. Do not accept a role merely because "software" appears somewhere in the description.
- Seniority: reject only configured excluded levels. Do not treat ordinary "Senior" or "Sr." as excluded unless the configuration says so.
- Experience: use only an explicitly mandatory minimum number of professional experience years. Ignore preferred qualifications when configured to do so. If no mandatory numeric minimum is stated, set requiredYears to null and experienceStatus to NOT_SPECIFIED. Set WITHIN_LIMIT when the mandatory minimum is at or below maxRequiredYears and OVER_LIMIT when it is above it. Apply acceptWhenNotSpecified to the final decision.
- Excluded domains: reject only when a configured excluded domain is materially part of the role's actual work, not when a term appears incidentally.
- Employment type: apply the configured included and excluded employment types.
- Sponsorship: when rejectNegativeStatements is true, set sponsorshipEligible to false if the description explicitly says sponsorship or immigration support is unavailable. This includes wording such as "no sponsorship," "will not/cannot/unable to sponsor," "must be authorized to work without current or future sponsorship," or no support for visa programs such as H-1B, OPT, or CPT. Positive sponsorship language and descriptions that do not mention sponsorship should set sponsorshipEligible to true. Do not interpret a neutral reference to work authorization as a negative restriction unless it excludes sponsorship or immigration support.
- Citizenship: set citizenshipRequired to true when the job explicitly requires U.S. citizenship, says the applicant must be a U.S. citizen, or mandates an active U.S. government security clearance or eligibility to obtain and maintain one. When rejectCitizenshipRequirements is true, any such requirement is a hard rejection. Do not set citizenshipRequired merely because the role supports a federal customer, mentions a background check or Public Trust review without a citizenship restriction, or contains equal-employment language about citizenship status.
- Hiring contact: extract hiringContactName and hiringContactEmail only when the description explicitly identifies a recruiter, hiring manager, talent-acquisition contact, or role/team contact, or explicitly invites candidates to send a resume or role-specific questions to that person or address. Never infer or fabricate a contact. Set absent values to null. Exclude addresses used for accommodations, disability/accessibility requests, privacy, legal notices, security or fraud reports, technical support, application-status support, equal-opportunity notices, and no-reply mailboxes.
- Location: apply the configured U.S. rules. Accept eligible U.S. locations, U.S.-remote roles, and allowed multi-location roles containing a U.S. location. Reject exclusively non-U.S. roles. Do not invent U.S. eligibility.
- Decision: return REJECTED if roleMatch is false, usEligible is false, any excluded flag is true, sponsorshipEligible is false while rejectNegativeStatements is true, citizenshipRequired is true while rejectCitizenshipRequirements is true, experienceStatus is OVER_LIMIT, or experienceStatus is NOT_SPECIFIED while acceptWhenNotSpecified is false. Return QUALIFIED only when none of those conditions applies.
- Reasons: provide short, factual reasons for the decision, not an essay.

Qualification configuration:
${JSON.stringify(qualificationRules, null, 2)}

Job:
Company: ${job.companyName}
Title: ${job.title}
Location: ${job.location ?? "Not specified"}

Full job description:
${job.description}

Final consistency check after evaluating every field:
1. If requiredYears is greater than ${filters.experience.maxRequiredYears}, experienceStatus MUST be OVER_LIMIT and decision MUST be REJECTED.
2. If roleMatch is false or usEligible is false, decision MUST be REJECTED.
3. If any excluded flag is true, decision MUST be REJECTED.
4. If sponsorshipEligible is false and rejectNegativeStatements is true, decision MUST be REJECTED.
5. If citizenshipRequired is true and rejectCitizenshipRequirements is true, decision MUST be REJECTED.
6. If experienceStatus is NOT_SPECIFIED and acceptWhenNotSpecified is false, decision MUST be REJECTED.
7. Only if none of rules 1-6 applies may decision be QUALIFIED.
Generate the evidence fields first and decision afterward.`;
}

export async function validateJobWithGemini(
  job: JobDetails,
  filters: FiltersConfig,
): Promise<JobValidationResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required to validate jobs with Gemini");
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    contents: buildPrompt(job, filters),
    config: {
      responseMimeType: "application/json",
      responseJsonSchema,
      temperature: 0,
    },
  });

  if (!response.text) {
    throw new Error("Gemini returned an empty job validation response");
  }

  let parsedResponse: unknown;

  try {
    parsedResponse = JSON.parse(response.text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Gemini returned malformed JSON: ${message}`, {
      cause: error,
    });
  }

  const validationResult = JobValidationResultSchema.safeParse(parsedResponse);

  if (!validationResult.success) {
    throw new Error(
      `Gemini returned an invalid job validation result: ${validationResult.error.message}`,
      { cause: validationResult.error },
    );
  }

  const guardedResult = applyDeterministicRestrictions(
    job,
    validationResult.data,
    filters,
  );
  assertLogicalConsistency(guardedResult, filters, "Gemini");

  return guardedResult;
}

export async function validateJobWithOpenAI(
  job: JobDetails,
  filters: FiltersConfig,
): Promise<JobValidationResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to validate jobs with OpenAI");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({
    model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    input: buildPrompt(job, filters),
    text: {
      format: zodTextFormat(
        JobValidationResultSchema,
        "job_validation_result",
      ),
    },
  });
  const parsedResponse = response.output_parsed;

  if (!parsedResponse) {
    throw new Error("OpenAI returned an empty job validation response");
  }

  const validationResult = JobValidationResultSchema.safeParse(parsedResponse);

  if (!validationResult.success) {
    throw new Error(
      `OpenAI returned an invalid job validation result: ${validationResult.error.message}`,
      { cause: validationResult.error },
    );
  }

  const guardedResult = applyDeterministicRestrictions(
    job,
    validationResult.data,
    filters,
  );
  assertLogicalConsistency(guardedResult, filters, "OpenAI");
  return guardedResult;
}

export async function validateJob(
  job: JobDetails,
  filters: FiltersConfig,
): Promise<JobValidationResult> {
  try {
    return await validateJobWithOpenAI(job, filters);
  } catch (error) {
    console.warn(
      `OpenAI validation failed; falling back to Gemini: ${errorMessage(error)}`,
    );
    return validateJobWithGemini(job, filters);
  }
}

function assertLogicalConsistency(
  result: JobValidationResult,
  filters: FiltersConfig,
  provider: "Gemini" | "OpenAI",
): void {
  const expectedExperienceStatus =
    result.requiredYears === null
      ? "NOT_SPECIFIED"
      : result.requiredYears <= filters.experience.maxRequiredYears
        ? "WITHIN_LIMIT"
        : "OVER_LIMIT";

  if (result.experienceStatus !== expectedExperienceStatus) {
    throw new Error(
      `${provider} returned an inconsistent experience result: requiredYears=${result.requiredYears} requires experienceStatus=${expectedExperienceStatus}`,
    );
  }

  const hasHardFailure =
    !result.roleMatch ||
    !result.usEligible ||
    result.excludedSeniority ||
    result.excludedDomain ||
    result.excludedEmploymentType ||
    (filters.sponsorship.rejectNegativeStatements &&
      !result.sponsorshipEligible) ||
    (filters.sponsorship.rejectCitizenshipRequirements &&
      result.citizenshipRequired) ||
    result.experienceStatus === "OVER_LIMIT" ||
    (result.experienceStatus === "NOT_SPECIFIED" &&
      !filters.experience.acceptWhenNotSpecified);
  const expectedDecision = hasHardFailure ? "REJECTED" : "QUALIFIED";

  if (result.decision !== expectedDecision) {
    throw new Error(
      `${provider} returned an inconsistent decision: expected ${expectedDecision} from the structured validation fields, received ${result.decision}`,
    );
  }
}

function applyDeterministicRestrictions(
  job: JobDetails,
  result: JobValidationResult,
  filters: FiltersConfig,
): JobValidationResult {
  let guardedResult = removeUnsupportedHiringContact(job, result);

  if (
    filters.sponsorship.rejectCitizenshipRequirements &&
    requiresActiveSecurityClearance(job.description)
  ) {
    const clearanceReason =
      "The role requires an active U.S. government security clearance.";

    guardedResult = {
      ...guardedResult,
      citizenshipRequired: true,
      decision: "REJECTED",
      reasons: addReason(guardedResult.reasons, clearanceReason),
    };
  }

  const mandatoryYears = findMandatoryExperienceYears(job.description);

  if (
    mandatoryYears !== null &&
    mandatoryYears > filters.experience.maxRequiredYears
  ) {
    const experienceReason =
      `The role explicitly requires at least ${mandatoryYears} years of experience, exceeding the configured maximum of ${filters.experience.maxRequiredYears} years.`;

    guardedResult = {
      ...guardedResult,
      requiredYears: mandatoryYears,
      experienceStatus: "OVER_LIMIT",
      decision: "REJECTED",
      reasons: addReason(guardedResult.reasons, experienceReason),
    };
  }

  return guardedResult;
}

function removeUnsupportedHiringContact(
  job: JobDetails,
  result: JobValidationResult,
): JobValidationResult {
  const descriptionText = load(job.description).text().toLowerCase();
  const hiringContactName =
    result.hiringContactName &&
      descriptionText.includes(result.hiringContactName.toLowerCase())
      ? result.hiringContactName
      : null;
  const hiringContactEmail =
    result.hiringContactEmail &&
      descriptionText.includes(result.hiringContactEmail.toLowerCase())
      ? result.hiringContactEmail
      : null;

  return {
    ...result,
    hiringContactName,
    hiringContactEmail,
  };
}

function findMandatoryExperienceYears(description: string): number | null {
  const $ = load(description);
  const matches: number[] = [];

  $("li, p").each((_, element) => {
    const candidate = $(element);

    if (candidate.is("p") && candidate.parents("li").length > 0) {
      return;
    }

    const text = candidate.text().replace(/\s+/g, " ").trim();

    if (!text || isPreferredExperience(text)) {
      return;
    }

    const section = experienceSection($, element);

    if (
      section === "preferred" ||
      (section !== "required" && !hasExplicitRequirementLanguage(text))
    ) {
      return;
    }

    matches.push(...extractExperienceYears(text));
  });

  return matches.length > 0 ? Math.max(...matches) : null;
}

function experienceSection(
  $: CheerioAPI,
  element: Parameters<CheerioAPI>[0],
): "required" | "preferred" | "unknown" {
  let cursor = $(element).is("li") ? $(element).parent() : $(element);

  for (let depth = 0; depth < 4 && cursor.length > 0; depth += 1) {
    for (const sibling of cursor.prevAll().toArray()) {
      const classification = classifySectionHeading(
        $(sibling).text().replace(/\s+/g, " ").trim(),
      );

      if (classification) {
        return classification;
      }
    }

    cursor = cursor.parent();
  }

  return "unknown";
}

function classifySectionHeading(
  text: string,
): "required" | "preferred" | null {
  if (!text || text.length > 160) {
    return null;
  }

  if (
    /\b(?:preferred|nice to have|bonus|desired|ideally)\b/i.test(text)
  ) {
    return "preferred";
  }

  if (
    /\b(?:minimum|basic|required) qualifications?\b/i.test(text) ||
    /\b(?:requirements?|qualifications?|what you(?:'|’)?ll need|what you bring)\b/i.test(
      text,
    )
  ) {
    return "required";
  }

  return null;
}

function isPreferredExperience(text: string): boolean {
  return /\b(?:preferred|nice to have|bonus|desired|ideally)\b/i.test(text);
}

function hasExplicitRequirementLanguage(text: string): boolean {
  return /\b(?:at least|minimum(?: of)?|requires?|required|must (?:have|possess))\b/i.test(
    text,
  );
}

function extractExperienceYears(text: string): number[] {
  const patterns = [
    /\b(\d{1,2})\s*(?:\(\+\)|\+)\s*years?(?:['’])?\s+(?:of\s+)?experience\b/gi,
    /\b(?:at least|minimum(?: of)?)\s+(\d{1,2})\s*years?(?:['’])?\s+(?:of\s+)?experience\b/gi,
    /\b(?:requires?|required|must (?:have|possess))\b.{0,80}\b(\d{1,2})\s*years?(?:['’])?\s+(?:of\s+)?experience\b/gi,
  ];

  return patterns.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => Number(match[1]))
  );
}

function addReason(reasons: string[], reason: string): string[] {
  return reasons.includes(reason) ? reasons : [...reasons, reason];
}

function requiresActiveSecurityClearance(description: string): boolean {
  const text = load(description).text().replace(/\s+/g, " ").trim();

  return (
    /\bactive\s+(?:u\.?\s*s\.?\s+)?(?:government\s+)?security\s+clearance\b/i.test(
      text,
    ) ||
    /\b(?:must|requires?|required|mandatory|eligible|ability)\b.{0,100}\b(?:obtain(?:ing)?\s+(?:and\s+maintain(?:ing)?\s+)?|hold(?:ing)?\s+|possess(?:ing)?\s+)?(?:an?\s+)?(?:u\.?\s*s\.?\s+)?(?:government\s+)?security\s+clearance\b/i.test(
      text,
    ) ||
    /\b(?:u\.?\s*s\.?\s+)?(?:government\s+)?security\s+clearance\b.{0,80}\b(?:required|mandatory)\b/i.test(
      text,
    )
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
