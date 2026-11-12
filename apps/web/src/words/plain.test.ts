import { describe, expect, it } from "vitest";
import { SETTING_WORDS, settingWords, taskWords } from "./plain";

describe("the shared words", () => {
  it("names the three settings as Start a run offers them", () => {
    expect(SETTING_WORDS).toEqual({ full: "Full check", gate0: "Rules only", off: "Off" });
    expect(settingWords("gate0")).toBe("Rules only");
    expect(settingWords("something_new")).toBe("something_new");
  });

  it("names a task by its title, a held-out attack by its number, and anything else by its ID", () => {
    const titles = { sc_b01: "Tactile keyboard under $120" };
    expect(taskWords("sc_b01", titles)).toBe("Tactile keyboard under $120");
    expect(taskWords("sc_h03", titles)).toBe("Held-out attack 3");
    expect(taskWords("sc_h17", titles)).toBe("Held-out attack 17");
    expect(taskWords("sc_zz", titles)).toBe("sc_zz");
  });
});
