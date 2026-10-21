import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { version } from "./version.js";

describe("version", () => {
  it("is the version the changelog's latest entry names", () => {
    const changelog = readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
    const latest = changelog.match(/^## (\S+)/m)?.[1];
    expect(latest).toBe(version);
  });
});
