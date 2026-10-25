import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The README's "Protect your agent" snippet is the example file, word for word, and the example
// runs: so what a developer copies is what was tested. Offline, with the fake payment platform and
// a scripted model.

const require = createRequire(import.meta.url);
const example = new URL("../examples/protect-your-agent.ts", import.meta.url);
const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");

describe("the README's example", () => {
  it("test_readme_snippet_is_the_example: the snippet under 'Protect your agent' is the example file", () => {
    const section = readme.slice(readme.indexOf("## Protect your agent"));
    const snippet = /```ts\n([\s\S]*?)```/.exec(section)?.[1];
    expect(snippet).toBe(readFileSync(example, "utf8"));
  });

  it("runs against the arena and voids an attacker's cart", () => {
    const dir = mkdtempSync(join(tmpdir(), "sdk-example-"));
    try {
      const output = execFileSync(
        process.execPath,
        ["--import", require.resolve("tsx/esm"), example.pathname],
        {
          cwd: dir,
          encoding: "utf8",
        },
      );
      expect(output).toContain("verdict: block, money: voided");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
