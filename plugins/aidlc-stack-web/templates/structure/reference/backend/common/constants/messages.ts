// ONE home for user-facing + error messages. Reference these — never inline a
// string in a controller/service. Keeps copy consistent and turns future i18n or
// message auditing into a config change, not a codebase sweep.
export const MESSAGES = {
  auth: {
    invalidCredentials: "Invalid email or password.",
    unauthenticated: "Authentication required.",
    forbidden: "You don't have permission to perform this action.",
  },
  common: {
    notFound: (resource: string) => `${resource} was not found.`,
    conflict: (resource: string) => `${resource} already exists.`,
    validationFailed: "The submitted data is invalid.",
    internal: "Something went wrong. Please try again.",
  },
} as const;
