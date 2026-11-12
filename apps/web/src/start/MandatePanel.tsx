import { useEffect, useId, useRef, useState } from "react";
import { ApiError, type MandateRow, type MandateView, postMandate } from "../api";
import { Amount, Button, Seal } from "../design";
import { formatTime } from "../format";
import { ceilingOf, requirementsOf } from "./copy";

// Step two: the rules the builder wrote from the request (the mandate), each one visible, editable
// where the builder supports editing it, and then locked or thrown away. Locking is the person's
// confirmation: the hash is what every gate later verifies.
export function MandatePanel({
  mandate,
  onChange,
  onRejected,
}: {
  mandate: MandateView;
  onChange: (next: MandateView) => void;
  onRejected: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState<"edit" | "confirm" | "reject" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A refused edit is said in the row being edited, next to the box.
  const [editProblem, setEditProblem] = useState<string | null>(null);
  const open = mandate.state === "drafted";

  async function send(
    kind: "edit" | "confirm" | "reject",
    action: Parameters<typeof postMandate>[1],
  ): Promise<boolean> {
    setAsking(kind);
    setProblem(null);
    setEditProblem(null);
    try {
      const next = await postMandate(mandate.runId, action);
      onChange(next);
      if (kind === "reject") onRejected();
      return true;
    } catch (error) {
      const said =
        error instanceof ApiError
          ? error.message
          : "The server didn't answer. Nothing was changed. Try again.";
      if (kind === "edit") setEditProblem(said);
      else setProblem(said);
      return false;
    } finally {
      setAsking(null);
    }
  }

  return (
    <div className="start-body">
      <p className="start-intro">
        {open
          ? "Chaperone turned the request into these rules (it calls them the mandate). When the agent checks out, the cart is checked against them. Change anything that's wrong, then lock them."
          : "These rules (the mandate) are what every check will use. They're locked, so nobody can change them now, not even the agent."}
      </p>
      <div className="start-brief">
        <div>
          <span className="t-meta">What the person asked for</span>
          <q className="start-request t-voice">{mandate.request}</q>
        </div>
        <ul className="terms" aria-label="The rules">
          {mandate.rows.map((row) => (
            <Term
              key={row.label}
              row={row}
              editable={open && row.field !== null}
              editing={editing === row.label}
              busy={asking !== null}
              problem={editing === row.label ? editProblem : null}
              onEdit={() => {
                setEditProblem(null);
                setEditing(row.label);
              }}
              onCancel={() => {
                setEditProblem(null);
                setEditing(null);
              }}
              onSave={async (input) => {
                if (!row.field) return;
                if (await send("edit", { action: "edit", field: row.field, input })) {
                  setEditing(null);
                }
              }}
            />
          ))}
        </ul>
      </div>

      {problem && (
        <p className="start-problem" role="alert">
          {problem}
        </p>
      )}

      {open ? (
        <div className="start-actions">
          <Button
            onClick={() => send("confirm", { action: "confirm" })}
            disabled={asking !== null || !mandate.canConfirm}
          >
            {asking === "confirm" ? "Locking…" : "Lock these rules"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => send("reject", { action: "reject" })}
            disabled={asking !== null}
          >
            {asking === "reject" ? "Throwing them away…" : "Start over"}
          </Button>
          <span className="t-meta">
            {mandate.canConfirm
              ? "Once locked, they can't change. Nothing is bought until you start the run. Start over throws these rules away so you can pick another task."
              : "Set a price ceiling first: the most to pay for one item."}
          </span>
        </div>
      ) : (
        mandate.lock && (
          <div className="start-seal">
            <p className="t-meta start-seal-says">
              The code in the seal is the rules' fingerprint. Every check confirms it first, so a
              changed rule would be caught.
            </p>
            <Seal hash={mandate.lock.hash} lockedAt={formatTime(mandate.lock.confirmedAt)} />
          </div>
        )
      )}
    </div>
  );
}

function Term({
  row,
  editable,
  editing,
  busy,
  problem,
  onEdit,
  onCancel,
  onSave,
}: {
  row: MandateRow;
  editable: boolean;
  editing: boolean;
  busy: boolean;
  // Why the server refused this row's edit, in its own words.
  problem: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (input: string) => void;
}) {
  const [text, setText] = useState(row.editText ?? "");
  const input = useRef<HTMLInputElement>(null);
  const wasEditing = useRef(false);
  const id = useId();
  // The price ceiling is the one amount in the mandate, so it is drawn as one: the most to pay.
  const ceiling = row.label === "Price ceiling" ? ceilingOf(row.value) : null;
  const requirements = row.label === "Requirements" ? requirementsOf(row.value) : null;

  // Opening the box puts the cursor in it, so the person can type at once.
  // Closing it (saved or cancelled) puts focus back on the term's Change button, not nowhere.
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (wasEditing.current) document.getElementById(`${id}-change`)?.focus();
    wasEditing.current = editing;
  }, [editing, id]);

  return (
    <li
      className={["term", ceiling && "term-ceiling", editing && "term-editing"]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="term-label">{row.label}</span>
      {editing ? (
        <form
          className="term-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave(text);
          }}
        >
          <span className="term-field">
            {ceiling && (
              <span className="term-dollar amt" aria-hidden="true">
                $
              </span>
            )}
            <input
              ref={input}
              className={`filter-control term-input${ceiling ? " term-input-money amt" : ""}`}
              aria-label={`New ${row.label.toLowerCase()}`}
              aria-describedby={
                [row.hint && `${id}-hint`, problem && `${id}-problem`].filter(Boolean).join(" ") ||
                undefined
              }
              aria-invalid={problem ? true : undefined}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onCancel();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </span>
          {row.hint && (
            <span className="t-meta term-hint" id={`${id}-hint`}>
              Format: {row.hint}
            </span>
          )}
          {problem && (
            <span className="start-problem term-problem" id={`${id}-problem`} role="alert">
              {problem}
            </span>
          )}
          <span className="term-buttons">
            <Button type="submit" small disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" small onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </span>
        </form>
      ) : (
        <>
          <span className="term-value">
            {ceiling ? (
              <>
                <span className="visually-hidden">{row.value}</span>
                <span className="term-money" aria-hidden="true">
                  <Amount cents={ceiling.cents} size="lg" />
                  {ceiling.rest && <span className="term-each">{ceiling.rest}</span>}
                </span>
              </>
            ) : requirements && requirements.length > 1 ? (
              <span className="term-lines">
                {requirements.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            ) : requirements ? (
              requirements[0]
            ) : row.label === "Not covered" ? (
              <span className="term-uncovered">{row.value}</span>
            ) : (
              row.value
            )}
            {row.label === "Not covered" && (
              <span className="t-meta term-note">In your request, but not made a rule</span>
            )}
          </span>
          {editable && (
            <Button
              id={`${id}-change`}
              variant="secondary"
              small
              onClick={() => {
                setText(row.editText ?? "");
                onEdit();
              }}
              aria-label={`Change ${row.label.toLowerCase()}`}
            >
              Change
            </Button>
          )}
        </>
      )}
    </li>
  );
}
