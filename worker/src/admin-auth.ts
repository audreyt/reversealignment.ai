import { sha256Hex, timingSafeEqualHex } from './crypto';

/** Constant-time admin bearer check. Never compares raw strings first. */
export async function adminTokenAccepted(token: string, header: string): Promise<boolean> {
  if (!token || !header) return false;
  const expect = await sha256Hex(token);
  const got = await sha256Hex(header);
  return timingSafeEqualHex(expect, got);
}
