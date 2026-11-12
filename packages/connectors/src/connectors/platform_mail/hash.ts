import { createHash } from "node:crypto";

/**
 * sha256 hex of an address trimmed and lowercased: the value `suppression_list.email_hash` holds (packages/db
 * `suppressionHash("email", …)`) and the gateway's `hashRecipient("email", …)` checks. Kept here so the connector
 * package needs no database import; a test holds the three equal.
 */
export const suppressionHashOfEmail = (email: string): string => createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
