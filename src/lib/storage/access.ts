import { AsyncLocalStorage } from "node:async_hooks";

// Only the server session boundary and local maintenance commands enter this scope.
// There is no HTTP header, query parameter, or environment flag that grants it.
const access = new AsyncLocalStorage<{ kind: "owner" | "maintenance"; id: string }>();
export function asOwner<T>(id: string, work: () => T): T {
  return access.run({ kind: "owner", id }, work);
}
export function asMaintenance<T>(work: () => T): T {
  return access.run({ kind: "maintenance", id: "local-command" }, work);
}
export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}
export function requireAccess() {
  const current = access.getStore();
  if (!current) throw new DomainError("UNAUTHENTICATED", "Sign in to continue.", 401);
  return current;
}
