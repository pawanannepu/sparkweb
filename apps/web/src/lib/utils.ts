import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const POSTGRES_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Validates any standard 8-4-4-4-12 hexadecimal PostgreSQL UUID, including
 * deterministic demo IDs (e.g. 00000000-0000-0000-0000-000000000001) that
 * Zod v4's strict RFC 4122 .uuid() validator rejects.
 */
export function isValidUuid(value: string): boolean {
  return POSTGRES_UUID_REGEX.test(value);
}
