import { useState } from "react";
import { ApiError, type MandateRow, type MandateView, postMandate } from "../api";
import { Amount, Button, Seal } from "../design";
import { formatTime } from "../format";
import { ceilingOf } from "./copy";

// Step two: the terms the builder drafted from the request, each one visible, editable where the
// builder supports editing it, and then locked or rejected. Locking is the person's confirmation:
// the hash is what every gate later verifies.
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
  const open = mandate.state === "drafted";

  async function send(
    kind: "edit" | "confirm" | "reject",
    action: Parameters<typeof postMandate>[1],
  ): Promise<boolean> {
    setAsking(kind);
    setProblem(null);
    try {
      const next = await postMandate(mandate.runId, action);
      onChange(next);
      if (kind === "reject") onRejected();
      return true;
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? error.message
          : "The server didn't answer. Nothing was changed; try again.",
      );
      return false;
    } finally {
      setAsking(null);
    }
  }

  return (
    <div className="start-body">
      <div className="start-brief">
        <div>
          <span className="t-meta">What you asked</span>
          <q className="start-request t-voice">{mandate.request}</q>
        </div>
        <ul className="terms" aria-label="The mandate's terms">
          {mandate.rows.map((row) => (
            <Term
              key={row.label}
              row={row}
              editable={open && row.field !== null}
              editing={editing === row.label}
              busy={asking !== null}
              onEdit={() => {
                setProblem(null);
                setEditing(row.label);
              }}
              onCancel={() => {
                setProblem(null);
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
            {asking === "confirm" ? "Locking…" : "Lock this mandate"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => send("reject", { action: "reject" })}
            disabled={asking !== null}
          >
            {asking === "reject" ? "Rejecting…" : "Reject and start over"}
          </Button>
          <span className="t-meta">
            {mandate.canConfirm
              ? "Locking is your confirmation. Nothing is bought until you start the run."
              : "Set a price ceiling first: the most to pay for one item."}
          </span>
        </div>
      ) : (
        mandate.lock && (
          <div className="start-seal">
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
  onEdit,
  onCancel,
  onSave,
}: {
  row: MandateRow;
  editable: boolean;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (input: string) => void;
}) {
  const [text, setText] = useState(row.editText ?? "");
  // The price ceiling is the one amount in the mandate, so it is drawn as one: the most to pay.
  const ceiling = row.label === "Price ceiling" ? ceilingOf(row.value) : null;
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
          {ceiling && (
            <span className="term-dollar amt" aria-hidden="true">
              $
            </span>
          )}
          <input
            className={`filter-control term-input${ceiling ? " term-input-money amt" : ""}`}
            aria-label={`New ${row.label.toLowerCase()}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" small disabled={busy}>
            Save
          </Button>
          <Button type="button" variant="secondary" small onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {row.hint && <span className="t-meta term-hint">{row.hint}</span>}
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
