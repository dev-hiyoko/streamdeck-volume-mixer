// Generates the key image (as an SVG data URI).
// - Mute: a speaker, with a red slash when muted.
// - Volume up/down: each key is one half of a single fader (up = top half,
//   down = bottom half). The knob sits at the current volume, so an up key
//   stacked over a down key reads as one continuous fader.

const WHITE = "#f4f4f5";
const MUTED = "#b9b9c0";
const FAINT = "#4a4a52";
const TRACK = "#3a3a40";
const RED = "#ff5a5a";
const GREEN = "#5ad48a";
const AMBER = "#ffcf5a";
const BG = "#151517";
const STROKE = "#34343a";
const FONT = "Segoe UI, system-ui, sans-serif";

export type KeyImageOptions =
  | { kind: "volume"; direction: "up" | "down"; name: string; percent: number; count?: number }
  | { kind: "mute"; name: string; muted: boolean; count?: number }
  | { kind: "empty"; name: string }
  | { kind: "offline" }
  | { kind: "restart"; status: "idle" | "working" | "ok" | "error" };

const FADER = { top: 21, bottom: 59, cx: 36, trackW: 4, knobW: 26, knobH: 8 };

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function label(name: string, count?: number): string {
  const base = count && count > 1 ? `${name.trim()}×${count}` : name.trim();
  const clipped = base.length > 10 ? `${base.slice(0, 9)}…` : base;
  return esc(clipped);
}

function speaker(color: string, withWaves: boolean): string {
  const waves = withWaves
    ? `<path d="M16 8 a4 4 0 0 1 0 8" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M16 5 a7 7 0 0 1 0 14" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
    : "";
  return `<g transform="translate(21,18) scale(1.25)"><path d="M4 9 L8 9 L13 4 L13 20 L8 15 L4 15 Z" fill="${color}"/>${waves}</g>`;
}

/** Renders one half of a shared fader. `level` is 0–1; `half` picks the range. */
function faderHalf(half: "top" | "bottom", level: number): string {
  const { top, bottom, cx, trackW, knobW, knobH } = FADER;
  const height = bottom - top;
  const lv = Math.max(0, Math.min(1, level));
  const x = cx - trackW / 2;
  const track = `<rect x="${x}" y="${top}" width="${trackW}" height="${height}" rx="${trackW / 2}" fill="${TRACK}"/>`;

  let fill = "";
  let knob = "";
  const drawKnob = (y: number): string =>
    `<rect x="${cx - knobW / 2}" y="${y - knobH / 2}" width="${knobW}" height="${knobH}" rx="${knobH / 2}" fill="${WHITE}" stroke="#0d0d0f" stroke-width="1.5"/>`;
  const drawFill = (fromY: number): string =>
    `<rect x="${x}" y="${fromY}" width="${trackW}" height="${bottom - fromY}" rx="${trackW / 2}" fill="${WHITE}"/>`;

  if (half === "top") {
    if (lv >= 0.5) {
      const knobY = bottom - ((lv - 0.5) / 0.5) * height;
      fill = drawFill(knobY);
      knob = drawKnob(knobY);
    }
    // lv < 0.5: this half is above the level — empty track only.
  } else {
    if (lv >= 0.5) {
      fill = drawFill(top); // whole lower half is filled; knob lives on the top key
    } else {
      const knobY = bottom - (lv / 0.5) * height;
      fill = drawFill(knobY);
      knob = drawKnob(knobY);
    }
  }
  return track + fill + knob;
}

function nameText(text: string): string {
  return `<text x="36" y="14" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${MUTED}">${text}</text>`;
}

function bottomText(text: string, color: string, bold = false): string {
  return `<text x="36" y="67" text-anchor="middle" font-family="${FONT}" font-size="${bold ? 15 : 12}" font-weight="${bold ? 700 : 400}" fill="${color}">${text}</text>`;
}

function frame(inner: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="72" height="72">` +
    `<rect x="2" y="2" width="68" height="68" rx="14" fill="${BG}" stroke="${STROKE}" stroke-width="2"/>` +
    `${inner}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/** A circular refresh arrow, centred, for the audio-server restart key. */
function refreshGlyph(color: string): string {
  return (
    `<g transform="translate(36,38)">` +
    `<path d="M 11 -5 A 13 13 0 1 0 13 6" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round"/>` +
    `<path d="M 6 -13 L 17 -8 L 8 0 Z" fill="${color}"/>` +
    `</g>`
  );
}

export function renderKeyImage(opts: KeyImageOptions): string {
  if (opts.kind === "offline") {
    return frame(speaker(FAINT, false) + bottomText("オフライン", MUTED));
  }

  if (opts.kind === "restart") {
    const color =
      opts.status === "ok" ? GREEN : opts.status === "error" ? RED : opts.status === "working" ? AMBER : WHITE;
    const text =
      opts.status === "ok"
        ? bottomText("OK", GREEN, true)
        : opts.status === "error"
          ? bottomText("失敗", RED, true)
          : opts.status === "working"
            ? bottomText("実行中…", AMBER)
            : bottomText("再起動", MUTED);
    return frame(nameText("音声サーバー") + refreshGlyph(color) + text);
  }

  if (opts.kind === "empty") {
    return frame(nameText(label(opts.name)) + `<text x="36" y="46" text-anchor="middle" font-family="${FONT}" font-size="22" fill="${FAINT}">—</text>`);
  }

  if (opts.kind === "mute") {
    const glyph = opts.muted
      ? speaker(WHITE, false) + `<line x1="20" y1="20" x2="50" y2="50" stroke="${RED}" stroke-width="4.5" stroke-linecap="round"/>`
      : speaker(WHITE, true);
    const state = opts.muted
      ? bottomText("ミュート", RED, true)
      : bottomText("通常", MUTED);
    return frame(nameText(label(opts.name, opts.count)) + glyph + state);
  }

  // volume — half of a shared fader
  const half = opts.direction === "up" ? "top" : "bottom";
  const sign = opts.direction === "up" ? "＋" : "－";
  const badge = `<text x="55" y="42" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="700" fill="${WHITE}">${sign}</text>`;
  return frame(nameText(label(opts.name, opts.count)) + faderHalf(half, opts.percent / 100) + badge + bottomText(`${Math.round(opts.percent)}%`, WHITE, true));
}
