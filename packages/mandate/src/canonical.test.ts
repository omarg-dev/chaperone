import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "./canonical.js";

describe("canonicalJson", () => {
  it("gives the same text whatever order the keys were written in", () => {
    const a = { b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } };
    const b = { a: { c: "x", d: [3, { y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
  });

  it("keeps array order, which means something", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("drops undefined fields, as JSON does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("refuses numbers JSON can't hold", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});

describe("sha256", () => {
  it("is the hex digest", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
