import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_HASH_PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derived.toString("hex")}`;
}

export function isHashedPassword(value: string): boolean {
  return value.startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

export async function verifyPassword(password: string, storedPassword: string): Promise<boolean> {
  if (!isHashedPassword(storedPassword)) {
    return password === storedPassword;
  }

  const [, salt, expectedHex] = storedPassword.split("$");
  if (!salt || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const derived = (await scrypt(password, salt, expected.length)) as Buffer;

  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
