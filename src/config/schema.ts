import { z } from "zod";

const nonEmptyString = z.string().trim().min(1, "Must not be empty");
const nonEmptyStringArray = z.array(nonEmptyString);
const urlString = z.string().trim().url("Must be a valid URL");

const companyBase = {
  id: nonEmptyString,
  name: nonEmptyString,
  enabled: z.boolean(),
};

const createHandleCompanySchema = <
  Adapter extends
    | "apple"
    | "greenhouse"
    | "lever"
    | "smartrecruiters"
    | "ashby",
>(adapter: Adapter) =>
  z
    .object({
      ...companyBase,
      adapter: z.literal(adapter),
      handle: nonEmptyString,
    })
    .strict();

const GreenhouseCompanySchema = createHandleCompanySchema("greenhouse");
const LeverCompanySchema = createHandleCompanySchema("lever");
const SmartRecruitersCompanySchema = createHandleCompanySchema(
  "smartrecruiters",
);
const AshbyCompanySchema = createHandleCompanySchema("ashby");
export const AppleCompanySchema = createHandleCompanySchema("apple");

export const IcimsCompanySchema = z
  .object({
    ...companyBase,
    adapter: z.literal("icims"),
    handle: nonEmptyString,
    apiBaseUrl: urlString,
  })
  .strict();

export const ByteDanceCompanySchema = z
  .object({
    ...companyBase,
    adapter: z.literal("bytedance"),
    handle: nonEmptyString,
    apiBaseUrl: urlString,
    careerBaseUrl: urlString,
    websitePath: nonEmptyString,
  })
  .strict();

export const AvatureCompanySchema = z
  .object({
    ...companyBase,
    adapter: z.literal("avature"),
    handle: nonEmptyString,
    apiBaseUrl: urlString,
    searchTerms: nonEmptyStringArray.min(1).optional(),
    hydrateListingDates: z.boolean().optional(),
  })
  .strict();

export const EightfoldCompanySchema = z
  .object({
    ...companyBase,
    adapter: z.literal("eightfold"),
    handle: nonEmptyString,
    apiBaseUrl: urlString,
  })
  .strict();

export const OracleCompanySchema = z
  .object({
    ...companyBase,
    adapter: z.literal("oracle"),
    handle: nonEmptyString,
    apiBaseUrl: urlString,
    siteNumber: nonEmptyString,
    publicJobBaseUrl: urlString,
  })
  .strict();

export const SuccessFactorsCompanySchema = z
  .object({
    ...companyBase,
    adapter: z.literal("successfactors"),
    apiBaseUrl: urlString,
    searchPath: nonEmptyString.refine(
      (value) => value.startsWith("/"),
      "Must start with /",
    ),
  })
  .strict();

export const WorkdayCompanySchema = z
  .object({
    ...companyBase,
    adapter: z.literal("workday"),
    handle: nonEmptyString,
    apiBaseUrl: urlString,
    tenant: nonEmptyString,
  })
  .strict();

export const CompanySchema = z.discriminatedUnion("adapter", [
  AppleCompanySchema,
  AvatureCompanySchema,
  EightfoldCompanySchema,
  ByteDanceCompanySchema,
  GreenhouseCompanySchema,
  IcimsCompanySchema,
  LeverCompanySchema,
  SmartRecruitersCompanySchema,
  AshbyCompanySchema,
  OracleCompanySchema,
  SuccessFactorsCompanySchema,
  WorkdayCompanySchema,
]);

const CompanyListSchema = z.array(CompanySchema).superRefine((companies, context) => {
  const seenIds = new Set<string>();

  companies.forEach((company, index) => {
    if (seenIds.has(company.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate company id: ${company.id}`,
        path: [index, "id"],
      });
    }

    seenIds.add(company.id);
  });
});

export const CompaniesConfigSchema = z
  .object({
    companies: CompanyListSchema,
  })
  .strict();

export const FiltersConfigSchema = z
  .object({
    freshness: z
      .object({
        lookbackHours: z.number().int().positive(),
        requireOpenJob: z.boolean(),
        allowFirstSeenFallback: z.boolean(),
        useUpdatedAtAsPostedAt: z.boolean(),
      })
      .strict(),
    location: z
      .object({
        country: z.literal("US"),
        allowRemoteUS: z.boolean(),
        allowMultiLocationWithUS: z.boolean(),
        rejectNonUSOnly: z.boolean(),
      })
      .strict(),
    roles: z
      .object({
        matchMode: z.literal("contains"),
        caseSensitive: z.boolean(),
        include: nonEmptyStringArray.min(1),
        excludeTitles: nonEmptyStringArray,
        excludeDomains: nonEmptyStringArray,
      })
      .strict(),
    seniority: z
      .object({
        exclude: nonEmptyStringArray,
      })
      .strict(),
    experience: z
      .object({
        maxRequiredYears: z.number().int().nonnegative(),
        acceptWhenNotSpecified: z.boolean(),
        ignorePreferredQualifications: z.boolean(),
      })
      .strict(),
    employmentType: z
      .object({
        include: nonEmptyStringArray,
        exclude: nonEmptyStringArray,
      })
      .strict(),
    sponsorship: z
      .object({
        rejectNegativeStatements: z.boolean(),
        rejectCitizenshipRequirements: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const AppConfigSchema = z
  .object({
    companies: CompanyListSchema,
    filters: FiltersConfigSchema,
  })
  .strict();

export type CompanyConfig = z.infer<typeof CompanySchema>;
export type AppleCompanyConfig = z.infer<typeof AppleCompanySchema>;
export type ByteDanceCompanyConfig = z.infer<typeof ByteDanceCompanySchema>;
export type AvatureCompanyConfig = z.infer<typeof AvatureCompanySchema>;
export type EightfoldCompanyConfig = z.infer<typeof EightfoldCompanySchema>;
export type IcimsCompanyConfig = z.infer<typeof IcimsCompanySchema>;
export type OracleCompanyConfig = z.infer<typeof OracleCompanySchema>;
export type SuccessFactorsCompanyConfig = z.infer<
  typeof SuccessFactorsCompanySchema
>;
export type WorkdayCompanyConfig = z.infer<typeof WorkdayCompanySchema>;
export type CompaniesConfig = z.infer<typeof CompaniesConfigSchema>;
export type FiltersConfig = z.infer<typeof FiltersConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
