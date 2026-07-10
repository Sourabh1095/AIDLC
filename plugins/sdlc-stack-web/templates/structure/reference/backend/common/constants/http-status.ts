// Single import site for status codes + the project's machine-readable error-code
// taxonomy. Prefer these over raw numbers/strings so usage is greppable and stable
// (see sdlc-stack-web:api-design for which code means what).
export { HttpStatus } from "@nestjs/common";

/** Stable, client-facing error codes. Add cases; never renumber/rename existing ones. */
export enum AppErrorCode {
  VALIDATION_FAILED = "VALIDATION_FAILED",
  UNAUTHENTICATED = "UNAUTHENTICATED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  CONFLICT = "CONFLICT",
  INTERNAL = "INTERNAL",
}
