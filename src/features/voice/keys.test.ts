import { describe, expect, it } from "vitest";

import { keyFromCode, keyFromMouseButton } from "./keys";

describe("keyFromCode", () => {
  it.each([
    ["KeyV", 0x56, "V"],
    ["Digit4", 0x34, "4"],
    ["Numpad0", 0x60, "Num 0"],
    ["F1", 0x70, "F1"],
    ["F13", 0x7c, "F13"],
    ["F24", 0x87, "F24"],
    ["Backquote", 0xc0, "`"],
    ["CapsLock", 0x14, "Caps Lock"],
    ["AltLeft", 0xa4, "Left Alt"],
  ])("maps %s to VK 0x%s", (code, vk, label) => {
    expect(keyFromCode(code)).toEqual({ code: vk, label });
  });

  it("rejects reserved and unknown keys", () => {
    for (const code of ["Escape", "Enter", "Backspace", "MetaLeft", "F25", "Unidentified"]) {
      expect(keyFromCode(code)).toBeNull();
    }
  });
});

describe("keyFromMouseButton", () => {
  it("allows middle and side buttons only", () => {
    expect(keyFromMouseButton(0)).toBeNull();
    expect(keyFromMouseButton(2)).toBeNull();
    expect(keyFromMouseButton(1)?.code).toBe(0x04);
    expect(keyFromMouseButton(3)).toEqual({ code: 0x05, label: "Mouse 4" });
    expect(keyFromMouseButton(4)).toEqual({ code: 0x06, label: "Mouse 5" });
  });
});
