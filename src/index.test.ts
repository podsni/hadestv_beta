import { expect, test } from "bun:test";

test("slugify produces stable ids", async () => {
  const { slugify } = await import("./api");
  expect(slugify("beIN Sports AU 1 A+")).toBe("bein-sports-au-1-a");
  expect(slugify("FIFA World Cup — México vs South Korea")).toBe(
    "fifa-world-cup-mexico-vs-south-korea",
  );
  expect(slugify("  Hello World!! ")).toBe("hello-world");
});
