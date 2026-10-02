import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appleSubscriptionState, AppleJwsError, verifyAppleJws, type AppleTransaction } from "@/lib/apple-iap";

// A throwaway chain shaped like Apple's (same marker extensions), made with
// openssl for these tests only. It is not Apple's and unlocks nothing: the
// app only trusts Apple Root CA - G3.
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures/apple-test-chain", name), "utf8");
const derBase64 = (pem: string) => new crypto.X509Certificate(pem).raw.toString("base64");
const ROOT = fixture("root.pem");
const CHAIN = [fixture("leaf.pem"), fixture("intermediate.pem"), ROOT].map(derBase64);
const LEAF_KEY = crypto.createPrivateKey(fixture("leaf.key"));

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
function sign(payload: object, x5c: string[] = CHAIN, key = LEAF_KEY): string {
  const head = `${b64url({ alg: "ES256", x5c })}.${b64url(payload)}`;
  const signature = crypto.sign("sha256", Buffer.from(head), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${signature.toString("base64url")}`;
}

const NOW = Date.UTC(2026, 9, 2);
const transaction: AppleTransaction = {
  originalTransactionId: "2000000123",
  transactionId: "2000000456",
  productId: "com.reecebroderick.campusos.monthly",
  bundleId: "com.reecebroderick.campusos",
  appAccountToken: "6f1a2b3c-0000-4000-8000-000000000001",
  expiresDate: NOW + 30 * 86_400_000,
  // Certificates are checked as of signing; the test chain was made in 2026-10.
  signedDate: Date.now(),
};

describe("verifyAppleJws", () => {
  it("returns the payload of a correctly signed record", () => {
    expect(verifyAppleJws<AppleTransaction>(sign(transaction), { rootPem: ROOT })).toEqual(transaction);
  });

  it("rejects the same record against Apple's real root", () => {
    expect(() => verifyAppleJws(sign(transaction))).toThrow(AppleJwsError);
  });

  it("rejects a payload changed after signing", () => {
    const [head, , sig] = sign(transaction).split(".");
    const forged = `${head}.${b64url({ ...transaction, expiresDate: NOW + 3650 * 86_400_000 })}.${sig}`;
    expect(() => verifyAppleJws(forged, { rootPem: ROOT })).toThrow("Signature doesn't match.");
  });

  it("rejects a record signed with a key that isn't the leaf certificate's", () => {
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(() => verifyAppleJws(sign(transaction, CHAIN, privateKey), { rootPem: ROOT })).toThrow(AppleJwsError);
  });

  it("rejects a chain missing the intermediate, or without the App Store markers", () => {
    expect(() => verifyAppleJws(sign(transaction, [CHAIN[0], CHAIN[2]]), { rootPem: ROOT })).toThrow(AppleJwsError);
    // The intermediate in the leaf's place: chains to the root, but lacks the leaf marker.
    expect(() => verifyAppleJws(sign(transaction, [CHAIN[1], CHAIN[1], CHAIN[2]]), { rootPem: ROOT })).toThrow(AppleJwsError);
  });

  it("rejects things that aren't JWS", () => {
    expect(() => verifyAppleJws("not-a-jws", { rootPem: ROOT })).toThrow(AppleJwsError);
    expect(() => verifyAppleJws("a.b.c", { rootPem: ROOT })).toThrow(AppleJwsError);
  });
});

describe("appleSubscriptionState", () => {
  const now = new Date(NOW);

  it("is active until it expires, and notes a turned-off auto-renew", () => {
    expect(appleSubscriptionState(transaction, null, now)).toMatchObject({ plan: "monthly", status: "active", cancelAtPeriodEnd: false });
    expect(
      appleSubscriptionState(transaction, { originalTransactionId: "2000000123", autoRenewStatus: 0 }, now)?.cancelAtPeriodEnd
    ).toBe(true);
  });

  it("is expired after the expiry date, unless Apple's grace period is still running", () => {
    const lapsed = { ...transaction, expiresDate: NOW - 1000 };
    expect(appleSubscriptionState(lapsed, null, now)?.status).toBe("expired");
    const grace = { originalTransactionId: "2000000123", gracePeriodExpiresDate: NOW + 86_400_000 };
    expect(appleSubscriptionState(lapsed, grace, now)).toMatchObject({ status: "past_due", currentPeriodEnd: new Date(NOW + 86_400_000) });
  });

  it("is canceled when Apple refunded or revoked it", () => {
    expect(appleSubscriptionState({ ...transaction, revocationDate: NOW - 1000 }, null, now)?.status).toBe("canceled");
  });

  it("ignores products that aren't this app's subscriptions", () => {
    expect(appleSubscriptionState({ ...transaction, productId: "com.other.app.monthly" }, null, now)).toBeNull();
  });
});
