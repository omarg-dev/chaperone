import manifest from "../../../package.json" with { type: "json" };

// The root package.json is the only place the version is written down.
export const version: string = manifest.version;
