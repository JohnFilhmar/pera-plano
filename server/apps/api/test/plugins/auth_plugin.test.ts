import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { signAccessToken, ACCESS_TOKEN_TTL_MS } from "../../src/lib/jwt.js";

const app = buildApp();

beforeAll(async () => {
  // Decorations from fastify-plugin land during ready; add the scratch route
  // inside a register callback so instance.authenticate exists when it runs.
  await app.register((instance) => {
    instance.get(
      "/test_protected",
      { preHandler: instance.authenticate },
      (request) => ({ userId: request.userId }),
    );
    return Promise.resolve();
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("auth plugin", () => {
  it("rejects a missing Authorization header with 401 unauthorized", async () => {
    const res = await app.inject({ method: "GET", url: "/test_protected" });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(
      "unauthorized",
    );
  });

  it("rejects a non-Bearer scheme", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a garbage token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: "Bearer garbage" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired token", async () => {
    const token = signAccessToken(
      "user-1",
      app.config.jwtSecret,
      Date.now() - ACCESS_TOKEN_TTL_MS - 1000,
    );
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = signAccessToken("user-1", "some_other_secret");
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("gives every rejection the same code and message", async () => {
    const wrongSecretToken = signAccessToken("user-1", "some_other_secret");
    const expiredToken = signAccessToken(
      "user-1",
      app.config.jwtSecret,
      Date.now() - ACCESS_TOKEN_TTL_MS - 1000,
    );
    const headerSets: (Record<string, string> | undefined)[] = [
      undefined,
      { authorization: "Basic dXNlcjpwYXNz" },
      { authorization: "Bearer garbage" },
      { authorization: `Bearer ${wrongSecretToken}` },
      { authorization: `Bearer ${expiredToken}` },
    ];
    const errors = [];
    for (const headers of headerSets) {
      const res = await app.inject({
        method: "GET",
        url: "/test_protected",
        headers: headers ?? {},
      });
      errors.push(res.json<{ error: { code: string; message: string } }>().error);
    }
    for (const error of errors) {
      expect(error.code).toBe("unauthorized");
      expect(error).toEqual(errors[0]);
    }
  });

  it("decorates the request with userId on a valid token", async () => {
    const token = signAccessToken("user-42", app.config.jwtSecret);
    const res = await app.inject({
      method: "GET",
      url: "/test_protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: "user-42" });
  });
});
