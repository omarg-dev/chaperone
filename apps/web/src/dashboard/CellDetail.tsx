import { Button, Pill } from "../design";
import { type CellDetail, GATE_NAMES, type GateCell, type SettingDetail } from "./detail";

function GateCellView({ cell }: { cell: GateCell }) {
  switch (cell.kind) {
    case "ran":
      return (
        <span className="detail-gate">
          <Pill state={cell.verdict} />
          <span className="t-meta">{cell.cost ? `${cell.time} · ${cell.cost}` : cell.time}</span>
        </span>
      );
    case "skipped":
      return <span className="t-meta">Didn't run</span>;
    case "absent":
      return <span className="visually-hidden">Not part of this setting</span>;
  }
}

function VerdictView({ verdict }: { verdict: SettingDetail["verdict"] }) {
  return verdict.kind === "verdict" ? (
    <Pill state={verdict.verdict} />
  ) : (
    <span className="t-meta">{verdict.text}</span>
  );
}

// One cell of the matrix, opened under its row: the same recorded checkout read by each firewall
// setting, a column each, with what every gate said and what the review cost. Everything here is
// the results file's own (see detail.ts); the row above says what the money did, so this says why.
export function CellDetailPanel({ detail, onClose }: { detail: CellDetail; onClose: () => void }) {
  return (
    <section
      className="cell-detail"
      aria-label={`${detail.title}, seed ${detail.seed}, under each setting`}
    >
      <div className="cell-detail-head">
        <h3 className="t-item">Under each setting</h3>
        <Button variant="secondary" small onClick={onClose}>
          Close
        </Button>
      </div>
      <table className="cell-detail-table">
        <thead>
          <tr>
            <td />
            {detail.settings.map((setting) => (
              <th key={setting.config} scope="col">
                <span className="cell-detail-setting">{setting.name}</span>
                <span className="t-meta">{setting.what}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.gates.map((gate) => (
            <tr key={gate}>
              <th scope="row">{GATE_NAMES[gate]}</th>
              {detail.settings.map((setting) => (
                <td key={setting.config}>
                  <GateCellView cell={setting.gates[gate]} />
                </td>
              ))}
            </tr>
          ))}
          <tr className="cell-detail-total">
            <th scope="row">Verdict</th>
            {detail.settings.map((setting) => (
              <td key={setting.config}>
                <VerdictView verdict={setting.verdict} />
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Review cost</th>
            {detail.settings.map((setting) => (
              <td key={setting.config} className="t-data">
                {setting.cost}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Review time</th>
            {detail.settings.map((setting) => (
              <td key={setting.config} className="t-data">
                {setting.time}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {detail.notes.map((note) => (
        <p key={note} className="t-meta cell-detail-note">
          {note}
        </p>
      ))}
    </section>
  );
}
