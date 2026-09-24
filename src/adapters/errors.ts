export class AdapterHttpError extends Error {
  constructor(
    public readonly provider: string,
    public readonly companyName: string,
    public readonly status: number,
    public readonly statusText: string,
  ) {
    super(
      `${provider} request failed for ${companyName}: ${status} ${statusText}`,
    );
    this.name = "AdapterHttpError";
  }
}

export function isUnavailableSourceError(
  error: unknown,
): error is AdapterHttpError {
  return (
    error instanceof AdapterHttpError &&
    (error.status === 404 || error.status === 410 || error.status === 429)
  );
}
