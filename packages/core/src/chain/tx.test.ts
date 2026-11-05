import { decodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { validatorShareAbi } from "./abis";
import { GAS_LIMIT_FLOOR, encodeClaim, encodeDelegate, encodeUndelegate, gasLimitFor } from "./tx";

describe("calldata encoders (selectors from RECON §1)", () => {
  it("delegate() = 0xc89e4361", () => {
    expect(encodeDelegate()).toBe("0xc89e4361");
  });

  it("claimRewards() = 0x372500ab", () => {
    expect(encodeClaim()).toBe("0x372500ab");
  });

  it("undelegate(uint256) = 0x6c68c0e1 + amount", () => {
    const data = encodeUndelegate(123n * 10n ** 18n);
    expect(data.slice(0, 10)).toBe("0x6c68c0e1");
    const decoded = decodeFunctionData({ abi: validatorShareAbi, data });
    expect(decoded.functionName).toBe("undelegate");
    expect(decoded.args).toEqual([123n * 10n ** 18n]);
    expect(() => encodeUndelegate(0n)).toThrow();
  });

  it("ABI has no onlyCallHelper overloads", () => {
    const names = validatorShareAbi.filter((x) => x.type === "function").map((f) => `${f.name}/${f.inputs.length}`);
    expect(names).toContain("delegate/0");
    expect(names).not.toContain("delegate/2");
    expect(names).not.toContain("undelegate/2");
    expect(names).not.toContain("claimRewards/1");
  });
});

describe("gasLimitFor", () => {
  it("uses the floor when estimate × 1.25 is below it", () => {
    expect(gasLimitFor("delegate", 150_000n)).toBe(260_000n);
    expect(gasLimitFor("claim", 100_000n)).toBe(140_000n);
    expect(gasLimitFor("undelegate", 150_000n)).toBe(230_000n);
  });

  it("uses estimate × 1.25 above the floor", () => {
    expect(gasLimitFor("delegate", 240_000n)).toBe(300_000n);
    expect(gasLimitFor("claim", 200_000n)).toBe(250_000n);
  });

  it("floors match RECON", () => {
    expect(GAS_LIMIT_FLOOR).toEqual({ delegate: 260_000n, claim: 140_000n, undelegate: 230_000n });
  });
});
