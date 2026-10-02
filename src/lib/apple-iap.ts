import "server-only";
import crypto, { X509Certificate } from "node:crypto";
import { planForAppleProduct, type Plan, type SubscriptionStatus } from "@/lib/billing";

// Apple's subscription records are JWS: a header carrying the signing
// certificate chain (x5c), a JSON payload and an ES256 signature. A record
// counts only when the chain ends at Apple Root CA - G3 (embedded below,
// from macOS's system root store), the certificates are Apple's App Store
// signing ones, and the signature matches. Same checks as Apple's
// app-store-server-library, without the dependency.

export const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

// DER encodings of the marker extensions Apple puts on its App Store
// signing certificate (1.2.840.113635.100.6.11.1) and on the intermediate
// that issues it (1.2.840.113635.100.6.2.1).
const LEAF_MARKER = Buffer.from("060a2a864886f76364060b01", "hex");
const INTERMEDIATE_MARKER = Buffer.from("060a2a864886f76364060201", "hex");

export class AppleJwsError extends Error {}

/** Verifies an App Store JWS and returns its payload. `rootPem` is for tests. */
export function verifyAppleJws<T extends { signedDate?: number }>(
  jws: string,
  options: { rootPem?: string; now?: Date } = {}
): T {
  const parts = jws.split(".");
  if (parts.length !== 3) throw new AppleJwsError("Not an App Store record.");
  let header: { alg?: string; x5c?: string[] };
  let payload: T;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new AppleJwsError("Not an App Store record.");
  }
  if (header.alg !== "ES256" || !Array.isArray(header.x5c) || header.x5c.length === 0) {
    throw new AppleJwsError("Unexpected App Store record format.");
  }

  let certs: X509Certificate[];
  try {
    certs = header.x5c.map((der) => new X509Certificate(Buffer.from(der, "base64")));
  } catch {
    throw new AppleJwsError("Unreadable signing certificate.");
  }

  if (certs.length !== 3) throw new AppleJwsError("Unexpected certificate chain.");
  const [leaf, intermediate, root] = certs;
  const trusted = new X509Certificate(options.rootPem ?? APPLE_ROOT_CA_G3_PEM);
  if (root.fingerprint256 !== trusted.fingerprint256) throw new AppleJwsError("Not signed by Apple.");
  if (!intermediate.verify(trusted.publicKey) || !leaf.verify(intermediate.publicKey)) {
    throw new AppleJwsError("Broken certificate chain.");
  }
  // Checked as of when Apple signed the record, so a restored older
  // purchase still verifies after its signing certificate has expired.
  const at = payload.signedDate ? new Date(payload.signedDate) : (options.now ?? new Date());
  for (const cert of [leaf, intermediate]) {
    if (new Date(cert.validFrom) > at || new Date(cert.validTo) < at) throw new AppleJwsError("Certificate not valid.");
  }
  if (!leaf.raw.includes(LEAF_MARKER) || !intermediate.raw.includes(INTERMEDIATE_MARKER)) {
    throw new AppleJwsError("Not an App Store signing certificate.");
  }

  const signed = crypto.verify(
    "sha256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    { key: leaf.publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(parts[2], "base64url")
  );
  if (!signed) throw new AppleJwsError("Signature doesn't match.");
  return payload;
}

/** The parts of Apple's JWSTransactionDecodedPayload this app uses. */
export interface AppleTransaction {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  bundleId: string;
  appAccountToken?: string;
  expiresDate?: number;
  revocationDate?: number;
  environment?: string;
  signedDate?: number;
}

/** The parts of JWSRenewalInfoDecodedPayload this app uses. */
export interface AppleRenewalInfo {
  originalTransactionId: string;
  autoRenewStatus?: number;
  gracePeriodExpiresDate?: number;
  signedDate?: number;
  environment?: string;
}

/** App Store Server Notifications V2 (the decoded signedPayload). */
export interface AppleNotification {
  notificationType: string;
  subtype?: string;
  signedDate?: number;
  environment?: string;
  data?: { bundleId?: string; environment?: string; signedTransactionInfo?: string; signedRenewalInfo?: string };
}

/**
 * A subscription's state from its latest transaction (and renewal info,
 * when a notification brings it). Null for anything that isn't one of
 * this app's subscriptions.
 */
export function appleSubscriptionState(
  tx: AppleTransaction,
  renewal: AppleRenewalInfo | null,
  now: Date
): { plan: Plan; status: SubscriptionStatus; currentPeriodEnd: Date; cancelAtPeriodEnd: boolean } | null {
  const plan = planForAppleProduct(tx.productId);
  if (!plan || !tx.expiresDate) return null;
  const cancelAtPeriodEnd = renewal?.autoRenewStatus === 0;
  if (tx.revocationDate) {
    return { plan, status: "canceled", currentPeriodEnd: new Date(tx.revocationDate), cancelAtPeriodEnd: false };
  }
  const expires = new Date(tx.expiresDate);
  if (expires > now) return { plan, status: "active", currentPeriodEnd: expires, cancelAtPeriodEnd };
  // A failed renewal in Apple's billing grace period keeps access until it ends.
  const grace = renewal?.gracePeriodExpiresDate ? new Date(renewal.gracePeriodExpiresDate) : null;
  if (grace && grace > now) return { plan, status: "past_due", currentPeriodEnd: grace, cancelAtPeriodEnd };
  return { plan, status: "expired", currentPeriodEnd: expires, cancelAtPeriodEnd };
}
