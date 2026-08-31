import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { ApiError } from "../../src/lib/errors.js";

const app = buildApp();

beforeAll(async () => {
  await app.register((instance) => {
    instance.get("/boom_api_error", () => {
      throw new ApiError(418, "teapot", "I am a teapot");
    });
    instance.get("/boom_unexpected", () => {
      throw new Error("secret internal detail");
    });
    instance.post(
      "/boom_validation",
      {
        schema: {
          body: {
            type: "object",
            required: ["mustHave"],
            properties: { mustHave: { type: "string" } },
          },
        },
      },
      () => ({ ok: true }),
    );
    return Promise.resolve();
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("shared error handler", () => {
  it("maps ApiError to its status and envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/boom_api_error" });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({
      error: { code: "teapot", message: "I am a teapot" },
    });
  });

  it("maps schema validation failures to a 400 validation_error envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/boom_validation",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toContain("mustHave");
  });

  it("maps unexpected errors to a 500 internal_error envelope without leaking details", async () => {
    const res = await app.inject({ method: "GET", url: "/boom_unexpected" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: "internal_error", message: "Internal server error" },
    });
  });
});
