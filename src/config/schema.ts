import { z } from "zod";

const nonEmptyString = z.string().trim().min(1, "Must not be empty");
const nonEmptyStringArray = z.array(nonEmptyString);

export const CompanySchema = z
  .object({
    id: nonEmptyString,
    name: nonEmptyString,
    enabled: z.boolean(),
    adapter: z.enum(["greenhouse", "lever", "smartrecruiters"]),
    handle: nonEmptyString,
  })
  .strict();

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
  })
  .strict();

export const AppConfigSchema = z
  .object({
    companies: CompanyListSchema,
    filters: FiltersConfigSchema,
  })
  .strict();

export type CompanyConfig = z.infer<typeof CompanySchema>;
export type CompaniesConfig = z.infer<typeof CompaniesConfigSchema>;
export type FiltersConfig = z.infer<typeof FiltersConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
