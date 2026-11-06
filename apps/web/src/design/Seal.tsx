// The seal: the clasp shut around the hash. It lands at the end of the mandate when the person has
// locked it, and stays as the mandate's signature wherever the mandate is shown: "Locked by you,
// sha256 ..., date". The corner is the mark's, closed, on all four sides.

// A hash in the groups it is read in: the first 24 hex digits, eight at a time. The full hash is
// what the gates check; this is what a person can compare by eye.
export function sealGroups(hash: string): string[] {
  const hex = hash.replace(/^sha256:/, "");
  return [0, 8, 16].map((at) => hex.slice(at, at + 8)).filter((group) => group.length > 0);
}

export function Seal({
  hash,
  lockedAt,
  who = "you",
}: {
  hash: string;
  // Already formatted, in UTC.
  lockedAt?: string | null;
  who?: string;
}) {
  const [first, second, third] = sealGroups(hash);
  return (
    <div
      className="seal"
      role="img"
      aria-label={`Seal: locked by ${who}, sha256 ${sealGroups(hash).join(" ")}`}
    >
      <span className="seal-title" aria-hidden="true">
        Locked by {who}
      </span>
      <span className="seal-hash" aria-hidden="true">
        sha256 {first}
        <br />
        {second} {third}
      </span>
      {lockedAt && (
        <span className="seal-date" aria-hidden="true">
          {lockedAt}
        </span>
      )}
    </div>
  );
}
