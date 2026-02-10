/**
 * Standardized error handling utilities.
 */

export interface ExecError {
  message: string;
  stderr?: string;
  exitCode?: number;
}

/**
 * Extract a useful error message from an unknown error value.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    return (e.stderr as string) || (e.message as string) || "Unknown error";
  }
  return String(error);
}

/**
 * Extract structured error info from an execa error.
 */
export function toExecError(error: unknown): ExecError {
  if (error instanceof Error) {
    const e = error as Error & { stderr?: string; exitCode?: number };
    return {
      message: e.message,
      stderr: e.stderr,
      exitCode: e.exitCode,
    };
  }
  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    return {
      message: (e.message as string) || "Unknown error",
      stderr: e.stderr as string | undefined,
      exitCode: e.exitCode as number | undefined,
    };
  }
  return { message: String(error) };
}
