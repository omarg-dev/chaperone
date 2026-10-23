import { describeDraft, EDIT_PROMPTS, fieldNamed, parseEdit } from "./describe.js";
import { EDITABLE_FIELDS, MandateError } from "./mandate.js";
import type { Person } from "./session.js";
import type { Vocabulary } from "./vocabulary.js";

export interface Terminal {
  ask(question: string): Promise<string>;
  print(text: string): void;
}

// The person at the command line: sees the draft, then accepts it, edits one field at a time, or
// rejects it. A typo is asked again here and never reaches the log; an edit that reads fine but
// doesn't fit the catalog comes back from the session as a problem and is shown before the draft.
export function terminalPerson(terminal: Terminal, vocabulary: Vocabulary): Person {
  const fieldList = EDITABLE_FIELDS.map((f) => EDIT_PROMPTS[f].name).join(", ");
  return {
    async review(draft, problems) {
      for (const problem of problems) terminal.print(`  ! ${problem}`);
      terminal.print(`\n${describeDraft(draft, vocabulary)}\n`);
      for (;;) {
        const answer = (await terminal.ask("Accept, edit or reject? [a/e/r] "))
          .trim()
          .toLowerCase();
        if (answer === "a" || answer === "accept") return { kind: "accept" };
        if (answer === "r" || answer === "reject") {
          const reason = await terminal.ask("Why? (optional) ");
          return { kind: "reject", reason };
        }
        if (answer !== "e" && answer !== "edit") {
          terminal.print("Type a to accept, e to edit a field, or r to reject.");
          continue;
        }
        const field = fieldNamed(await terminal.ask(`Which field? (${fieldList}) `));
        if (!field) {
          terminal.print(`That isn't one of: ${fieldList}.`);
          continue;
        }
        const prompt = EDIT_PROMPTS[field];
        const input = await terminal.ask(`New ${prompt.name} (${prompt.hint}): `);
        try {
          return { kind: "edit", edit: parseEdit(field, input, draft, vocabulary) };
        } catch (error) {
          if (!(error instanceof MandateError)) throw error;
          for (const problem of error.problems) terminal.print(`  ! ${problem}`);
        }
      }
    },
  };
}
