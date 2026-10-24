export class Rejected extends Error {}

export function reject(reason: string): never {
  throw new Rejected(reason);
}

export const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
