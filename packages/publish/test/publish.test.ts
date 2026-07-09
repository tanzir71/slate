import { describe, expect, it } from "vitest";
import {
  createPublishRegistry,
  createStaticPublishAdapter,
  type PublishDocument
} from "../src/index";

const document: PublishDocument = {
  title: "Launch Plan",
  html: "<h1>Launch Plan</h1><p>Ship calmly.</p>",
  tags: ["release", "planning"]
};

describe("publish adapters", () => {
  it("publishes through a registered static adapter contract", async () => {
    const registry = createPublishRegistry([
      createStaticPublishAdapter({ baseUrl: "https://example.com/slate" })
    ]);

    const result = await registry.publish({
      provider: "static",
      document,
      visibility: "draft"
    });

    expect(result).toEqual({
      provider: "static",
      remoteId: "static:launch-plan",
      status: "draft",
      title: "Launch Plan",
      url: "https://example.com/slate/launch-plan",
      warnings: []
    });
  });

  it("rejects unsupported publish providers", async () => {
    const registry = createPublishRegistry([]);

    await expect(registry.publish({ provider: "ghost", document, visibility: "public" })).rejects.toThrow(
      "No publish adapter registered for ghost"
    );
  });

  it("rejects duplicate publish providers", () => {
    const adapter = createStaticPublishAdapter({ baseUrl: "https://example.com" });

    expect(() => createPublishRegistry([adapter, adapter])).toThrow(
      "Duplicate publish adapter registered for static"
    );
  });
});
