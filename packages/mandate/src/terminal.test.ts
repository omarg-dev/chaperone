import { describe, expect, it } from "vitest";
import { terminalPerson } from "./terminal.js";
import { tactileDraft, vocabulary } from "./test-helpers.js";

// A terminal that answers from a script and keeps what was printed.
function scripted(answers: string[]) {
  const printed: string[] = [];
  const asked: string[] = [];
  return {
    printed,
    asked,
    terminal: {
      ask: async (question: string) => {
        asked.push(question);
        const answer = answers.shift();
        if (answer === undefined) throw new Error(`No answer scripted for "${question}"`);
        return answer;
      },
      print: (text: string) => printed.push(text),
    },
  };
}

describe("terminalPerson", () => {
  it("shows the draft and accepts it", async () => {
    const t = scripted(["a"]);
    const decision = await terminalPerson(t.terminal, vocabulary).review(tactileDraft, []);
    expect(decision).toEqual({ kind: "accept" });
    expect(t.printed.join("\n")).toContain("Price ceiling    $120.00 each");
  });

  it("turns an edit into a decision, asking again after anything it can't read", async () => {
    const t = scripted(["x", "e", "colour", "e", "price", "cheap", "e", "price", "99"]);
    const decision = await terminalPerson(t.terminal, vocabulary).review(tactileDraft, []);
    expect(decision).toEqual({ kind: "edit", edit: { field: "maxUnitPriceCents", value: 9900 } });
    const printed = t.printed.join("\n");
    expect(printed).toContain("Type a to accept");
    expect(printed).toContain("That isn't one of: category, requirements, brands");
    expect(printed).toContain('"cheap" isn\'t a price');
  });

  it("rejects with the reason given", async () => {
    const t = scripted(["r", "I changed my mind"]);
    expect(await terminalPerson(t.terminal, vocabulary).review(tactileDraft, [])).toEqual({
      kind: "reject",
      reason: "I changed my mind",
    });
  });

  it("shows why the last decision didn't go through", async () => {
    const t = scripted(["a"]);
    await terminalPerson(t.terminal, vocabulary).review(tactileDraft, ["It has no price ceiling"]);
    expect(t.printed[0]).toBe("  ! It has no price ceiling");
  });
});
