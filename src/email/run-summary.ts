import nodemailer from "nodemailer";

export interface RunSummary {
  companies: number;
  summaries: number;
  cheapFilterMatches: number;
  previouslyProcessed: number;
  qualified: number;
  rejected: number;
  appended: number;
  duplicates: number;
  processedRecorded: number;
  unavailableSources: number;
  failed: number;
  alerts: string[];
}

export async function sendRunSummaryEmail(
  summary: RunSummary,
): Promise<boolean> {
  const user = process.env.EMAIL_USER;
  const password = process.env.EMAIL_APP_PASSWORD;
  const recipient = process.env.EMAIL_TO;
  const runName = process.env.JOB_WATCH_RUN_NAME?.trim();

  if (!user || !password || !recipient) {
    console.log("Email summary skipped: email credentials are not configured");
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass: password },
  });
  const status =
    summary.failed > 0
      ? "Completed with errors"
      : summary.unavailableSources > 0
        ? "Completed with unavailable sources"
        : "Completed";
  const hasAlerts =
    summary.alerts.length > 0 ||
    summary.failed > 0 ||
    summary.unavailableSources > 0;
  const displayedAlerts = summary.alerts.slice(0, 20);
  const remainingAlerts = summary.alerts.length - displayedAlerts.length;
  const alertLines = hasAlerts
    ? [
        "",
        "ALERTS:",
        ...(displayedAlerts.length > 0
          ? displayedAlerts.map((alert) => `- ${alert}`)
          : ["- One or more failures were reported. Check the workflow logs."]),
        ...(remainingAlerts > 0
          ? [`- ${remainingAlerts} additional alert(s); check the workflow logs.`]
          : []),
        "",
      ]
    : [];
  const lines = [
    ...(runName ? [`Run: ${runName}`] : []),
    `Status: ${status}`,
    ...alertLines,
    `Companies checked: ${summary.companies}`,
    `Jobs scanned: ${summary.summaries}`,
    `Passed cheap filters: ${summary.cheapFilterMatches}`,
    `Previously processed: ${summary.previouslyProcessed}`,
    `Qualified: ${summary.qualified}`,
    `Rejected: ${summary.rejected}`,
    `Added to sheet: ${summary.appended}`,
    `Duplicates skipped: ${summary.duplicates}`,
    `Processed decisions recorded: ${summary.processedRecorded}`,
    `Unavailable sources skipped: ${summary.unavailableSources}`,
    `Failures: ${summary.failed}`,
  ];

  await transporter.sendMail({
    from: user,
    to: recipient,
    subject: `${hasAlerts ? "[ALERT] " : ""}SWE Job Watch${runName ? ` (${runName})` : ""}: ${status}`,
    text: lines.join("\n"),
  });

  return true;
}
