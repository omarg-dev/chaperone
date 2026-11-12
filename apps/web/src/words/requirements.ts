// A rule about what the item must be, in a person's words. The builder writes requirements the way
// the command line reads them ("switch_feel = tactile; weight_g <= 70 g; form = over_ear") and the
// locked rules keep them as {attribute, op, value}; a person reads "Switch feel: tactile",
// "Weight: at most 70 g" and "Fit: over ear". Shared by the Start page and the run page, so the
// rules read the same before and after they are locked.

// The catalog's attribute names and values that don't read as words on their own.
const ATTRIBUTE_NAMES: Record<string, string> = {
  anc: "Noise cancelling",
  dpi: "Sensor (DPI)",
  form: "Fit",
};
const ATTRIBUTE_VALUES: Record<string, string> = {
  tkl: "tenkeyless",
  true: "yes",
  false: "no",
};
// An attribute named for its unit ("weight_g", "battery_h") says the unit after the number.
const UNITS = new Set(["g", "h", "ms", "mm", "hz"]);

export type RequirementOp = "=" | "<=" | ">=";

// One requirement: the attribute's name, and what it has to be.
export function requirementOf(attribute: string, op: RequirementOp, written: string): string {
  let rest = ATTRIBUTE_VALUES[written] ?? written.replace(/_/g, " ");
  const suffix = /_([a-z]+)$/.exec(attribute)?.[1];
  const saidUnit = /\s(\S+)$/.exec(rest)?.[1];
  // "70" for weight_g is 70 g; "70 g" already says so.
  if (suffix && UNITS.has(suffix) && !saidUnit && /^[\d.,]+$/.test(rest))
    rest = `${rest} ${suffix}`;
  const unit = saidUnit ?? (suffix && UNITS.has(suffix) ? suffix : undefined);
  const plain = (unit ? attribute.replace(new RegExp(`_${unit}$`), "") : attribute).replace(
    /_/g,
    " ",
  );
  const name = ATTRIBUTE_NAMES[attribute] ?? `${plain.charAt(0).toUpperCase()}${plain.slice(1)}`;
  const said = op === "<=" ? `at most ${rest}` : op === ">=" ? `at least ${rest}` : rest;
  return `${name}: ${said}`;
}

// The builder's own text, one requirement per part. Anything that isn't in that shape is passed
// through as it was written.
export function requirementsOf(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const found = /^([a-z0-9_]+) (=|<=|>=) (.+)$/i.exec(part);
      if (!found) return part;
      const [, attribute, op, written] = found as unknown as [
        string,
        string,
        RequirementOp,
        string,
      ];
      return requirementOf(attribute, op, written);
    });
}
