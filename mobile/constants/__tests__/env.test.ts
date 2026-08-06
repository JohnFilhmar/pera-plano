describe("ENV", () => {
  const ORIGINAL = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = ORIGINAL;
    jest.resetModules();
  });

  test("falls back to the dev default when unset", () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    jest.resetModules();
    const { ENV } = require("../env") as typeof import("../env");
    expect(ENV.API_URL).toBe("http://localhost:3000");
  });

  test("reads EXPO_PUBLIC_API_URL when set", () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.peraplano.example";
    jest.resetModules();
    const { ENV } = require("../env") as typeof import("../env");
    expect(ENV.API_URL).toBe("https://api.peraplano.example");
  });
});
