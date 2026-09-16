// Safely extracts a human-readable message from any thrown value.
// Using `error: unknown` in catch clauses (the TypeScript-safe default) means
// we can't call `.message` directly — this helper centralises the coercion so
// every catch block in the codebase reads the same way.
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
