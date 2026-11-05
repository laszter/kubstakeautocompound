import { describe, expect, it } from "vitest";
import * as browserEntry from "../browser";
import * as serverEntry from "../index";
import { ADMIN_PASSWORD_MAX_LENGTH, ADMIN_PASSWORD_MIN_LENGTH, validateNewAdminPassword } from "./admin-password";

/** Same value in both fields, so only the password rules can fail. */
const validateSame = (password: unknown) => validateNewAdminPassword(password, password);

describe("validateNewAdminPassword", () => {
  it("uses the documented limits", () => {
    expect(ADMIN_PASSWORD_MIN_LENGTH).toBe(8);
    expect(ADMIN_PASSWORD_MAX_LENGTH).toBe(1024);
  });

  it("accepts lengths 8 and 1024, rejects 7 and 1025 with a Thai message naming the limit", () => {
    expect(validateSame("x".repeat(8))).toBeNull();
    expect(validateSame("x".repeat(1024))).toBeNull();

    const short = validateSame("x".repeat(7));
    expect(Object.keys(short ?? {})).toEqual(["password"]);
    expect(short?.password).toMatch(/[฀-๿]/);
    expect(short?.password).toContain(String(ADMIN_PASSWORD_MIN_LENGTH));

    const long = validateSame("x".repeat(1025));
    expect(Object.keys(long ?? {})).toEqual(["password"]);
    expect(long?.password).toMatch(/[฀-๿]/);
    expect(long?.password).toContain(String(ADMIN_PASSWORD_MAX_LENGTH));
  });

  it("counts leading and trailing spaces and never trims them", () => {
    // would be too short if trimmed
    expect(validateSame("  abcd  ")).toBeNull();
    expect(validateSame(" ".repeat(8))).toBeNull();
    // 7 including the spaces: still too short
    expect(validateSame(" abcde ")).toHaveProperty("password");
    // would be within the limit if trimmed
    expect(validateSame(`${"x".repeat(1024)} `)).toHaveProperty("password");
    // would match if trimmed
    expect(validateNewAdminPassword("abcdefgh ", "abcdefgh")).toHaveProperty("confirm");
    expect(validateNewAdminPassword("abcdefgh", " abcdefgh")).toHaveProperty("confirm");
  });

  it("reports a confirmation that differs, on the confirm field only", () => {
    const errors = validateNewAdminPassword("abcdefgh", "abcdefgH");
    expect(Object.keys(errors ?? {})).toEqual(["confirm"]);
    expect(errors?.confirm).toMatch(/[฀-๿]/);
  });

  it("reports both fields when both are invalid", () => {
    expect(Object.keys(validateNewAdminPassword("short", "other") ?? {})).toEqual(["password", "confirm"]);
    expect(Object.keys(validateNewAdminPassword("x".repeat(1025), "other") ?? {})).toEqual(["password", "confirm"]);
  });

  it.each([[undefined], [null], [12345678], [true], [["12345678"]], [{ length: 8 }]])(
    "rejects non-string password %j",
    (value) => {
      expect(Object.keys(validateSame(value) ?? {})).toEqual(["password"]);
    },
  );

  it.each([[undefined], [null], [12345678], [["12345678"]]])("rejects non-string confirm %j", (value) => {
    expect(Object.keys(validateNewAdminPassword("12345678", value) ?? {})).toEqual(["confirm"]);
  });

  it.each([
    ["too short", "S3cr3t!", "S3cr3t!"],
    ["too long", `L0ngS3cr3t${"x".repeat(1024)}`, `L0ngS3cr3t${"x".repeat(1024)}`],
    ["mismatched", "P4ssw0rd-first", "C0nf1rm-second"],
    ["short and mismatched", "S3cr3t!", "C0nf1rm-second"],
  ])("does not echo the submitted values when %s", (_name, password, confirm) => {
    const text = JSON.stringify(validateNewAdminPassword(password, confirm));
    expect(text).not.toBe("null");
    for (const value of [password, confirm]) {
      expect(text).not.toContain(value);
      expect(text).not.toContain(value.slice(0, 6));
    }
  });

  it("is exported from both the server and the browser entry points", () => {
    for (const entry of [serverEntry, browserEntry]) {
      expect(entry.validateNewAdminPassword).toBe(validateNewAdminPassword);
      expect(entry.ADMIN_PASSWORD_MIN_LENGTH).toBe(ADMIN_PASSWORD_MIN_LENGTH);
      expect(entry.ADMIN_PASSWORD_MAX_LENGTH).toBe(ADMIN_PASSWORD_MAX_LENGTH);
    }
  });
});
