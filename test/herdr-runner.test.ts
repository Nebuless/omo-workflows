import { describe, expect, test } from "bun:test";
import {
  boundedHerdrOutput,
  MAX_OUTPUT_BYTES,
  OUTPUT_TRUNCATED_SUFFIX,
} from "../extensions/herdr/runner.ts";

describe("Herdr runner", () => {
  test("keeps truncated UTF-8 output within the byte cap", async () => {
    const result = boundedHerdrOutput([Buffer.from("😀".repeat(5001))]);

    expect(result.truncated).toBe(true);
    expect(result.output).toEndWith(OUTPUT_TRUNCATED_SUFFIX);
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
    expect(result.output).not.toContain("\uFFFD");
  });

  test("exports no raw executable runner", async () => {
    const runner = await import("../extensions/herdr/runner.ts");

    expect("spawnHerdr" in runner).toBe(false);
  });
});
