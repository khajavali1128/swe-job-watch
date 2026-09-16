import { describe, expect, it } from "vitest";

import {
  AdapterHttpError,
  isUnavailableSourceError,
} from "../src/adapters/errors.js";

describe("isUnavailableSourceError", () => {
  it.each([404, 410])("treats HTTP %i as an unavailable source", (status) => {
    const error = new AdapterHttpError(
      "Greenhouse",
      "Postman",
      status,
      "Unavailable",
    );

    expect(isUnavailableSourceError(error)).toBe(true);
  });

  it.each([401, 429, 500, 503])(
    "keeps HTTP %i fatal",
    (status) => {
      const error = new AdapterHttpError(
        "Greenhouse",
        "Example",
        status,
        "Request failed",
      );

      expect(isUnavailableSourceError(error)).toBe(false);
    },
  );

  it("does not classify unrelated errors as unavailable sources", () => {
    expect(isUnavailableSourceError(new Error("network failure"))).toBe(false);
  });
});
