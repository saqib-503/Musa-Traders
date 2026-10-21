export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
export function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "Something went wrong. Please try again.";
}
