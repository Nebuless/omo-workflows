import { expect, test } from "bun:test";

test("before_agent_start returns bounded safe custom message without prompt replacement", async () => {
  // Given: recommendation lifecycle source and persisted hook contract.
  const source = await Bun.file(
    new URL("../src/index.ts", import.meta.url),
  ).text();
  // When: inspecting returned hook contract.
  // Then: hook message exists, stays bounded, and excludes unsafe recommendation data.
  expect(source).toContain('customType: "workflow-capability"');
  expect(source).toContain(".slice(0, 5)");
  expect(source).toContain("({ key, title })");
  expect(source).not.toContain("systemPrompt:");
  expect(source).not.toContain("rationale });");
  expect(source).not.toContain("details:");
  expect(source).not.toContain("executeTool");
});

test("headless hook message remains separate from widget", async () => {
  // Given: lifecycle source with mode-gated widget.
  const source = await Bun.file(
    new URL("../src/index.ts", import.meta.url),
  ).text();
  // When: checking UI gate.
  // Then: widget calls require TUI while message path remains unconditional after recommendations check.
  expect(source).toContain(
    'context.mode === "tui" && !recommendationWidgetShown',
  );
  expect(source).toContain('customType: "workflow-capability"');
});
