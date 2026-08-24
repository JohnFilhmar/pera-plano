import { newId } from "../ids";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("newId returns RFC 4122 v4 UUIDs", () => {
  expect(newId()).toMatch(UUID_V4);
});

test("newId sets the version nibble to 4 and the variant bits to 10xx (8/9/a/b)", () => {
  // Decoded separately from the regex above so a helper that merely returns a
  // fixed-length hex string with the dashes in the right places, but with the
  // wrong version/variant nibble, still gets caught explicitly here.
  const id = newId();
  const versionNibble = id[14];
  const variantNibble = id[19];
  expect(versionNibble).toBe("4");
  expect(["8", "9", "a", "b"]).toContain(variantNibble);
});

test("newId does not repeat", () => {
  const ids = new Set(Array.from({ length: 500 }, () => newId()));
  expect(ids.size).toBe(500);
});
