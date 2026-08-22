import config from "../../tailwind.config";

type FontUtilities = Record<string, { fontFamily: string }>;

function collectAddedUtilities(): FontUtilities {
  const collected: FontUtilities = {};
  for (const entry of config.plugins ?? []) {
    const handler = (entry as { handler?: (api: unknown) => void }).handler;
    if (handler === undefined) continue;
    handler({
      addUtilities: (utilities: FontUtilities) => Object.assign(collected, utilities),
    });
  }
  return collected;
}

test("every weight utility resolves to a real Inter family, not a fontWeight", () => {
  const utilities = collectAddedUtilities();
  expect(utilities[".font-normal"]).toEqual({ fontFamily: "Inter_400Regular" });
  expect(utilities[".font-medium"]).toEqual({ fontFamily: "Inter_500Medium" });
  expect(utilities[".font-semibold"]).toEqual({ fontFamily: "Inter_600SemiBold" });
  expect(utilities[".font-bold"]).toEqual({ fontFamily: "Inter_700Bold" });
  expect(utilities[".font-extrabold"]).toEqual({ fontFamily: "Inter_800ExtraBold" });
});

test("no weight utility emits fontWeight, which Android ignores for a loaded family", () => {
  for (const style of Object.values(collectAddedUtilities())) {
    expect(style).not.toHaveProperty("fontWeight");
  }
});

test("the design's type scale is present and sized as the spec's table states", () => {
  const sizes = config.theme?.extend?.fontSize as Record<string, [string, { lineHeight: string }]>;
  expect(sizes.hero[0]).toBe("40px");
  expect(sizes.title[0]).toBe("20px");
  expect(sizes.section[0]).toBe("15px");
  expect(sizes.body[0]).toBe("14px");
  expect(sizes.row[0]).toBe("13px");
  expect(sizes.secondary[0]).toBe("12px");
  expect(sizes.micro[0]).toBe("11px");
  expect(sizes.badge[0]).toBe("10px");
});
