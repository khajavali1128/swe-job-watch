import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => ({
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail }),
  },
}));

import {
  sendRunSummaryEmail,
  type RunSummary,
} from "../src/email/run-summary.js";

const summary: RunSummary = {
  companies: 2,
  summaries: 10,
  cheapFilterMatches: 2,
  previouslyProcessed: 0,
  qualified: 1,
  rejected: 1,
  appended: 1,
  duplicates: 0,
  processedRecorded: 2,
  unavailableSources: 0,
  failed: 0,
  alerts: [],
};

beforeEach(() => {
  process.env.EMAIL_USER = "sender@example.com";
  process.env.EMAIL_APP_PASSWORD = "password";
  process.env.EMAIL_TO = "recipient@example.com";
  process.env.JOB_WATCH_RUN_NAME = "custom careers";
  sendMail.mockReset().mockResolvedValue({});
});

describe("sendRunSummaryEmail", () => {
  it("marks the subject and identifies sources when a run has alerts", async () => {
    await sendRunSummaryEmail({
      ...summary,
      unavailableSources: 1,
      alerts: ["Apple source unavailable (503): Service Unavailable"],
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject:
          "[ALERT] SWE Job Watch (custom careers): Completed with unavailable sources",
        text: expect.stringContaining(
          "ALERTS:\n- Apple source unavailable (503): Service Unavailable",
        ),
      }),
    );
  });

  it("keeps the normal subject when the run succeeds", async () => {
    await sendRunSummaryEmail(summary);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "SWE Job Watch (custom careers): Completed",
      }),
    );
  });
});
