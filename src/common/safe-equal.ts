import { timingSafeEqual } from 'crypto';

/** Constant-time string comparison to prevent timing attacks on secret checks. */
export function safeEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
