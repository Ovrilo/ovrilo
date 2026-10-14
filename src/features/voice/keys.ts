/** A push-to-talk key as the host expects it: a Windows virtual-key code and a display label. */
export interface PushToTalkKey {
  code: number;
  label: string;
}

const NAMED: Record<string, [number, string]> = {
  Space: [0x20, "Space"],
  Tab: [0x09, "Tab"],
  CapsLock: [0x14, "Caps Lock"],
  Backquote: [0xc0, "`"],
  Minus: [0xbd, "-"],
  Equal: [0xbb, "="],
  BracketLeft: [0xdb, "["],
  BracketRight: [0xdd, "]"],
  Backslash: [0xdc, "\\"],
  Semicolon: [0xba, ";"],
  Quote: [0xde, "'"],
  Comma: [0xbc, ","],
  Period: [0xbe, "."],
  Slash: [0xbf, "/"],
  IntlBackslash: [0xe2, "<"],
  ShiftLeft: [0xa0, "Left Shift"],
  ShiftRight: [0xa1, "Right Shift"],
  ControlLeft: [0xa2, "Left Ctrl"],
  ControlRight: [0xa3, "Right Ctrl"],
  AltLeft: [0xa4, "Left Alt"],
  AltRight: [0xa5, "Right Alt"],
  ArrowLeft: [0x25, "Left"],
  ArrowUp: [0x26, "Up"],
  ArrowRight: [0x27, "Right"],
  ArrowDown: [0x28, "Down"],
  Insert: [0x2d, "Insert"],
  Delete: [0x2e, "Delete"],
  Home: [0x24, "Home"],
  End: [0x23, "End"],
  PageUp: [0x21, "Page Up"],
  PageDown: [0x22, "Page Down"],
  Pause: [0x13, "Pause"],
  ScrollLock: [0x91, "Scroll Lock"],
  NumpadAdd: [0x6b, "Num +"],
  NumpadSubtract: [0x6d, "Num -"],
  NumpadMultiply: [0x6a, "Num *"],
  NumpadDivide: [0x6f, "Num /"],
  NumpadDecimal: [0x6e, "Num ."],
};

/**
 * Maps a browser `KeyboardEvent.code` (physical key, layout independent) to a Windows virtual-key
 * code. Returns null for keys that cannot be push-to-talk keys (Escape cancels binding; Enter,
 * Backspace and the Windows key are reserved).
 */
export function keyFromCode(code: string): PushToTalkKey | null {
  let match: RegExpMatchArray | null;
  if ((match = code.match(/^Key([A-Z])$/))) return { code: match[1]!.charCodeAt(0), label: match[1]! };
  if ((match = code.match(/^Digit([0-9])$/))) return { code: 0x30 + Number(match[1]), label: match[1]! };
  if ((match = code.match(/^Numpad([0-9])$/))) return { code: 0x60 + Number(match[1]), label: `Num ${match[1]}` };
  if ((match = code.match(/^F([1-9]|1[0-9]|2[0-4])$/))) {
    return { code: 0x70 + Number(match[1]) - 1, label: `F${match[1]}` };
  }
  const named = NAMED[code];
  return named ? { code: named[0], label: named[1] } : null;
}

/** Mouse buttons usable for push-to-talk: middle and the two side buttons (never left/right). */
export function keyFromMouseButton(button: number): PushToTalkKey | null {
  switch (button) {
    case 1:
      return { code: 0x04, label: "Middle mouse" };
    case 3:
      return { code: 0x05, label: "Mouse 4" };
    case 4:
      return { code: 0x06, label: "Mouse 5" };
    default:
      return null;
  }
}
