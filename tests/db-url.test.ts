import { describe, expect, it } from "vitest";
import { POOL_SIZE, POOL_TIMEOUT_SECONDS, runtimeDatabaseUrl } from "../src/lib/db-url";

const params = (url: string | undefined) => Object.fromEntries(new URL(url!).searchParams);

describe("runtimeDatabaseUrl", () => {
  it("moves Prisma Postgres's direct host to the pooled one, in pgbouncer mode with a small pool", () => {
    const url = runtimeDatabaseUrl("postgres://u:p@db.prisma.io:5432/postgres?sslmode=require", { pooling: true });
    expect(new URL(url!).host).toBe("pooled.db.prisma.io:5432");
    expect(new URL(url!).username).toBe("u");
    expect(new URL(url!).password).toBe("p");
    expect(params(url)).toEqual({ sslmode: "require", connection_limit: POOL_SIZE, pool_timeout: POOL_TIMEOUT_SECONDS, pgbouncer: "true" });
  });

  it("stays on the direct host, without pgbouncer, when pooling is off", () => {
    const url = runtimeDatabaseUrl("postgres://u:p@db.prisma.io:5432/postgres?sslmode=require", { pooling: false });
    expect(new URL(url!).host).toBe("db.prisma.io:5432");
    expect(params(url)).toEqual({ sslmode: "require", connection_limit: POOL_SIZE, pool_timeout: POOL_TIMEOUT_SECONDS });
  });

  it("keeps settings already in the URL, and the password as written", () => {
    const raw = "postgresql://user:pa%2Fss@pooled.db.prisma.io:5432/postgres?connection_limit=10&pool_timeout=5&pgbouncer=false";
    const url = runtimeDatabaseUrl(raw, { pooling: true });
    expect(params(url)).toEqual({ connection_limit: "10", pool_timeout: "5", pgbouncer: "false" });
    expect(new URL(url!).password).toBe("pa%2Fss");
  });

  it("only caps the pool on any other Postgres", () => {
    const url = runtimeDatabaseUrl("postgresql://campus:x@127.0.0.1:55432/campusos", { pooling: true });
    expect(new URL(url!).host).toBe("127.0.0.1:55432");
    expect(params(url)).toEqual({ connection_limit: POOL_SIZE, pool_timeout: POOL_TIMEOUT_SECONDS });
  });

  it("leaves other URLs alone", () => {
    expect(runtimeDatabaseUrl(undefined)).toBeUndefined();
    expect(runtimeDatabaseUrl("")).toBe("");
    expect(runtimeDatabaseUrl("prisma+postgres://accelerate.prisma-data.net/?api_key=x")).toBe("prisma+postgres://accelerate.prisma-data.net/?api_key=x");
    expect(runtimeDatabaseUrl("not a url")).toBe("not a url");
  });
});
