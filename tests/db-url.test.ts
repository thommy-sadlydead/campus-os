import { describe, expect, it } from "vitest";
import { runtimeDatabaseUrl } from "../src/lib/db-url";

const params = (url: string | undefined) => Object.fromEntries(new URL(url!).searchParams);

describe("runtimeDatabaseUrl", () => {
  it("moves Prisma Postgres's direct host to the pooled one, keeping the login and the full SSL check", () => {
    const url = runtimeDatabaseUrl("postgres://u:p@db.prisma.io:5432/postgres?sslmode=require", { pooling: true });
    expect(new URL(url!).host).toBe("pooled.db.prisma.io:5432");
    expect(new URL(url!).username).toBe("u");
    expect(new URL(url!).password).toBe("p");
    expect(params(url)).toEqual({ sslmode: "verify-full" });
  });

  it("stays on the direct host when pooling is off", () => {
    const url = runtimeDatabaseUrl("postgres://u:p@db.prisma.io:5432/postgres?sslmode=require", { pooling: false });
    expect(new URL(url!).host).toBe("db.prisma.io:5432");
    expect(params(url)).toEqual({ sslmode: "verify-full" });
  });

  it("drops the Prisma engine settings node-postgres doesn't use, and keeps the password as written", () => {
    const raw = "postgresql://user:pa%2Fss@pooled.db.prisma.io:5432/postgres?sslmode=require&connection_limit=10&pool_timeout=5&connect_timeout=3&pgbouncer=true&schema=public";
    const url = runtimeDatabaseUrl(raw, { pooling: true });
    expect(params(url)).toEqual({ sslmode: "verify-full" });
    expect(new URL(url!).password).toBe("pa%2Fss");
  });

  it("leaves an sslmode that already says what it checks, or none", () => {
    expect(params(runtimeDatabaseUrl("postgres://u:p@db.prisma.io/postgres?sslmode=verify-full"))).toEqual({ sslmode: "verify-full" });
    expect(params(runtimeDatabaseUrl("postgres://u:p@db.prisma.io/postgres?sslmode=disable"))).toEqual({ sslmode: "disable" });
  });

  it("leaves any other Postgres where it is", () => {
    const url = runtimeDatabaseUrl("postgresql://campus:x@127.0.0.1:55432/campusos", { pooling: true });
    expect(new URL(url!).host).toBe("127.0.0.1:55432");
    expect(params(url)).toEqual({});
  });

  it("leaves other URLs alone", () => {
    expect(runtimeDatabaseUrl(undefined)).toBeUndefined();
    expect(runtimeDatabaseUrl("")).toBe("");
    expect(runtimeDatabaseUrl("prisma+postgres://accelerate.prisma-data.net/?api_key=x")).toBe("prisma+postgres://accelerate.prisma-data.net/?api_key=x");
    expect(runtimeDatabaseUrl("not a url")).toBe("not a url");
  });
});
