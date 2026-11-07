/**
 * The eval charts (#102): SVG files drawn from `evals/history.jsonl`, for the
 * README and `evals/report.md`. GitHub renders a README's images but none of
 * its scripts, so a chart there is a static image; generating it from the
 * history, and failing CI when the committed file differs, keeps it as true
 * as the report (ADR 0014, amendment of #102).
 *
 * Each chart comes in a light and a dark file: GitHub picks one with
 * `<picture>` and `prefers-color-scheme`, which follows the reader's GitHub
 * theme. A media query inside one SVG would follow the operating system
 * instead.
 *
 * Deterministic on purpose: no clock, no locale, no font measuring. Text
 * widths are estimated, so labels are kept short.
 */
import { type HistoryEntry, sameSet, type SetKey, setName } from "./history.js";
import { percent } from "./report.js";

export type Theme = "light" | "dark";

interface Palette {
  text: string;
  muted: string;
  grid: string;
  axis: string;
  series: readonly string[];
}

const PALETTES: Record<Theme, Palette> = {
  light: {
    text: "#1f2328",
    muted: "#59636e",
    grid: "#d8dee4",
    axis: "#8c959f",
    series: ["#0969da", "#bc4c00", "#8250df", "#1a7f37"],
  },
  dark: {
    text: "#f0f6fc",
    muted: "#9198a1",
    grid: "#30363d",
    axis: "#656c76",
    series: ["#4493f8", "#f0883e", "#ab7df8", "#3fb950"],
  },
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

/** The chart files by name, as `evals/charts/<name>`. */
export function renderCharts(
  history: readonly HistoryEntry[],
): Map<string, string> {
  const files = new Map<string, string>();
  for (const theme of ["light", "dark"] as const) {
    files.set(`accuracy-${theme}.svg`, accuracyChart(history, theme));
    files.set(`rates-${theme}.svg`, ratesChart(history, theme));
  }
  return files;
}

/** The sets in the order they first appear in the history. */
export function seriesOf(history: readonly HistoryEntry[]): SetKey[] {
  const sets: SetKey[] = [];
  for (const entry of history) {
    if (!sets.some((set) => sameSet(set, entry))) {
      sets.push({ provider: entry.provider, model: entry.model });
    }
  }
  return sets;
}

interface Frame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Plot {
  /** The x of the entry at this index of the whole history. */
  x: (index: number) => number;
  y: (value: number) => number;
}

function plot(
  frame: Frame,
  count: number,
  domain: readonly [number, number],
): Plot {
  const inset = 8;
  const span = frame.right - frame.left - 2 * inset;
  const [lo, hi] = domain;
  return {
    x: (index) =>
      frame.left +
      inset +
      (count <= 1 ? span / 2 : (span * index) / (count - 1)),
    y: (value) =>
      frame.bottom - ((value - lo) / (hi - lo)) * (frame.bottom - frame.top),
  };
}

const MAIN = { width: 880, height: 340 };

function accuracyChart(history: readonly HistoryEntry[], theme: Theme): string {
  const palette = PALETTES[theme];
  const sets = seriesOf(history);
  const frame: Frame = {
    left: 48,
    right: MAIN.width - 72,
    top: 76,
    bottom: MAIN.height - 34,
  };
  const values = history.flatMap((entry) => [
    entry.gated.accuracy,
    entry.spread?.gated.accuracy?.[0] ?? null,
  ]);
  const lowest = Math.min(...values.filter((v): v is number => v !== null), 1);
  // A floor under the data, in tens: the changes that matter are a few points.
  const lo = Math.max(0, Math.floor(lowest * 10 - 0.5) / 10);
  const domain = [lo, 1] as const;
  const at = plot(frame, history.length, domain);
  const parts: string[] = [];

  parts.push(
    text(0, 18, "Accuracy on the gated cases, per history entry", {
      fill: palette.text,
      size: 15,
      weight: 600,
    }),
    text(
      0,
      38,
      "Each point is one measurement. A band is the min–max across a set's runs.",
      {
        fill: palette.muted,
        size: 12,
      },
    ),
    ...legend(sets, palette, 0, 60),
    ...yAxis(
      frame,
      at,
      ticks(domain, 0.1),
      palette,
      (v) => `${String(Math.round(v * 100))} %`,
    ),
    ...xAxis(frame, at, history, palette),
  );

  const ends: EndLabel[] = [];
  sets.forEach((set, index) => {
    const color = palette.series[index % palette.series.length] ?? palette.text;
    const indexed = history
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => sameSet(entry, set));
    parts.push(
      ...band(indexed, at, color),
      line(indexed, at, (entry) => entry.gated.accuracy, color),
      ...dots(indexed, at, (entry) => entry.gated.accuracy, color),
    );
    const last = indexed.findLast(({ entry }) => entry.gated.accuracy !== null);
    if (last !== undefined && last.entry.gated.accuracy !== null) {
      ends.push({
        x: at.x(last.i) + 8,
        y: at.y(last.entry.gated.accuracy),
        label: percent(last.entry.gated.accuracy),
        color,
      });
    }
  });
  parts.push(...endLabels(ends, frame));

  return svg(
    MAIN,
    `Gated accuracy per eval history entry, for ${sets.map(setName).join(" and ")}`,
    parts,
  );
}

const RATES = { width: 880, height: 270 };

interface Panel {
  title: string;
  note: string;
  value: (entry: HistoryEntry) => number | null;
  dashed?: (entry: HistoryEntry) => number | null;
  domain: (history: readonly HistoryEntry[]) => readonly [number, number];
  step: number;
  format: (value: number) => string;
  end: (value: number) => string;
}

const asPercent = (v: number) => `${String(Math.round(v * 100))} %`;

const PANELS: readonly Panel[] = [
  {
    title: "Approved fraud",
    note: "dashed: auto-approved, the CI gate",
    value: (entry) => entry.gated.approvedFraudRate,
    dashed: (entry) => entry.gated.autoApprovedFraudRate,
    domain: (history) => [
      0,
      roundUp(
        maxOf(history, (e) => e.gated.approvedFraudRate),
        0.1,
        0.2,
      ),
    ],
    step: 0.1,
    format: asPercent,
    end: (v) => percent(v),
  },
  {
    title: "Escalated to the admin",
    note: "share of cases a human reviews",
    value: (entry) => entry.gated.escalationRate,
    domain: () => [0, 1],
    step: 0.25,
    format: asPercent,
    end: (v) => percent(v),
  },
  {
    title: "Gated cases in the dataset",
    note: "a moving denominator",
    value: (entry) => entry.gated.cases,
    domain: (history) => [
      0,
      roundUp(
        maxOf(history, (e) => e.gated.cases),
        10,
        10,
      ),
    ],
    step: 10,
    format: (v) => String(v),
    end: (v) => String(v),
  },
];

function ratesChart(history: readonly HistoryEntry[], theme: Theme): string {
  const palette = PALETTES[theme];
  const sets = seriesOf(history);
  const gap = 28;
  const width = (RATES.width - gap * (PANELS.length - 1)) / PANELS.length;
  const parts: string[] = [...legend(sets, palette, 0, 14)];

  PANELS.forEach((panel, p) => {
    const x0 = p * (width + gap);
    const frame: Frame = {
      left: x0 + 36,
      right: x0 + width - 44,
      top: 74,
      bottom: RATES.height - 30,
    };
    const domain = panel.domain(history);
    const at = plot(frame, history.length, domain);
    parts.push(
      text(x0, 44, panel.title, { fill: palette.text, size: 13, weight: 600 }),
      text(x0, 60, panel.note, { fill: palette.muted, size: 11 }),
      ...yAxis(frame, at, ticks(domain, panel.step), palette, panel.format),
      ...xEnds(frame, at, history, palette),
    );
    const ends: EndLabel[] = [];
    sets.forEach((set, index) => {
      const color =
        palette.series[index % palette.series.length] ?? palette.text;
      const indexed = history
        .map((entry, i) => ({ entry, i }))
        .filter(({ entry }) => sameSet(entry, set));
      if (panel.dashed !== undefined) {
        parts.push(
          line(indexed, at, panel.dashed, color, { dashed: true, width: 1.5 }),
        );
      }
      parts.push(line(indexed, at, panel.value, color));
      const last = indexed.findLast(({ entry }) => panel.value(entry) !== null);
      const value = last === undefined ? null : panel.value(last.entry);
      if (last !== undefined && value !== null) {
        ends.push({
          x: at.x(last.i) + 6,
          y: at.y(value),
          label: panel.end(value),
          color,
        });
      }
    });
    parts.push(...endLabels(ends, frame, 10.5));
  });

  return svg(
    RATES,
    "Approved fraud, escalation and gated cases per eval history entry",
    parts,
  );
}

function legend(
  sets: readonly SetKey[],
  palette: Palette,
  x: number,
  y: number,
): string[] {
  const parts: string[] = [];
  let at = x;
  sets.forEach((set, index) => {
    const color = palette.series[index % palette.series.length] ?? palette.text;
    const name = setName(set);
    parts.push(
      `<rect x="${n(at)}" y="${n(y - 9)}" width="10" height="10" rx="2" fill="${color}"/>`,
      text(at + 16, y, name, { fill: palette.text, size: 12 }),
    );
    at += 16 + estimateWidth(name, 12) + 24;
  });
  return parts;
}

function yAxis(
  frame: Frame,
  at: Plot,
  values: readonly number[],
  palette: Palette,
  format: (value: number) => string,
): string[] {
  return values.flatMap((value) => [
    `<line x1="${n(frame.left)}" x2="${n(frame.right)}" y1="${n(at.y(value))}" y2="${n(at.y(value))}" stroke="${palette.grid}" stroke-width="1"/>`,
    text(frame.left - 6, at.y(value) + 4, format(value), {
      fill: palette.muted,
      size: 11,
      anchor: "end",
    }),
  ]);
}

/** Entry ids along the bottom, as many as fit without touching. */
function xAxis(
  frame: Frame,
  at: Plot,
  history: readonly HistoryEntry[],
  palette: Palette,
): string[] {
  const parts = [axisLine(frame, palette)];
  const room = (frame.right - frame.left) / Math.max(history.length, 1);
  const step = Math.max(1, Math.ceil(40 / room));
  const last = history.length - 1;
  history.forEach((entry, i) => {
    const shown = i === last || (i % step === 0 && last - i >= step);
    if (!shown) return;
    parts.push(
      text(at.x(i), frame.bottom + 18, entry.id, {
        fill: palette.muted,
        size: 11,
        anchor: "middle",
      }),
    );
  });
  return parts;
}

/** The first and last entry ids: a small panel has room for no more. */
function xEnds(
  frame: Frame,
  at: Plot,
  history: readonly HistoryEntry[],
  palette: Palette,
): string[] {
  const first = history[0];
  const last = history.at(-1);
  const parts = [axisLine(frame, palette)];
  if (first !== undefined) {
    parts.push(
      text(at.x(0), frame.bottom + 16, first.id, {
        fill: palette.muted,
        size: 10.5,
        anchor: "start",
      }),
    );
  }
  if (last !== undefined && history.length > 1) {
    parts.push(
      text(at.x(history.length - 1), frame.bottom + 16, last.id, {
        fill: palette.muted,
        size: 10.5,
        anchor: "end",
      }),
    );
  }
  return parts;
}

function axisLine(frame: Frame, palette: Palette): string {
  return `<line x1="${n(frame.left)}" x2="${n(frame.right)}" y1="${n(frame.bottom)}" y2="${n(frame.bottom)}" stroke="${palette.axis}" stroke-width="1"/>`;
}

interface Indexed {
  entry: HistoryEntry;
  /** The entry's index in the whole history: its place on the x axis. */
  i: number;
}

/** A line through a set's entries; a missing value breaks it. */
function line(
  points: readonly Indexed[],
  at: Plot,
  value: (entry: HistoryEntry) => number | null,
  color: string,
  style: { dashed?: boolean; width?: number } = {},
): string {
  let d = "";
  let open = false;
  for (const { entry, i } of points) {
    const v = value(entry);
    if (v === null) {
      open = false;
      continue;
    }
    d += `${open ? "L" : "M"}${n(at.x(i))} ${n(at.y(v))}`;
    open = true;
  }
  const dash = style.dashed === true ? ` stroke-dasharray="5 4"` : "";
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${String(style.width ?? 2)}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
}

function dots(
  points: readonly Indexed[],
  at: Plot,
  value: (entry: HistoryEntry) => number | null,
  color: string,
): string[] {
  return points.flatMap(({ entry, i }) => {
    const v = value(entry);
    return v === null
      ? []
      : [
          `<circle cx="${n(at.x(i))}" cy="${n(at.y(v))}" r="3.5" fill="${color}"/>`,
        ];
  });
}

/** The min–max of accuracy across runs, over each stretch of repeated entries. */
function band(points: readonly Indexed[], at: Plot, color: string): string[] {
  const stretches: Indexed[][] = [];
  let current: Indexed[] = [];
  for (const point of points) {
    if (point.entry.spread?.gated.accuracy == null) {
      if (current.length > 0) stretches.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 0) stretches.push(current);
  return stretches.map((stretch) => {
    const range = (p: Indexed) => p.entry.spread?.gated.accuracy ?? [0, 0];
    const top = stretch.map((p) => `${n(at.x(p.i))} ${n(at.y(range(p)[1]))}`);
    const bottom = [...stretch]
      .reverse()
      .map((p) => `${n(at.x(p.i))} ${n(at.y(range(p)[0]))}`);
    // A single entry still shows its range, as a short bar.
    const shape =
      stretch.length === 1
        ? `M${n(at.x(stretch[0]?.i ?? 0) - 3)} ${top[0]?.split(" ")[1] ?? "0"}h6V${bottom[0]?.split(" ")[1] ?? "0"}h-6Z`
        : `M${top.join("L")}L${bottom.join("L")}Z`;
    return `<path d="${shape}" fill="${color}" fill-opacity="0.16" stroke="none"/>`;
  });
}

interface EndLabel {
  x: number;
  y: number;
  label: string;
  color: string;
}

/** Each series' latest value at its end, pushed apart so none overlap. */
function endLabels(labels: EndLabel[], frame: Frame, size = 12): string[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  const gap = size + 3;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const label = sorted[i];
    if (prev !== undefined && label !== undefined && label.y - prev.y < gap) {
      label.y = prev.y + gap;
    }
  }
  const overflow = (sorted.at(-1)?.y ?? 0) - frame.bottom;
  return sorted.map((label) =>
    text(label.x, label.y - Math.max(0, overflow) + size / 3, label.label, {
      fill: label.color,
      size,
      weight: 600,
    }),
  );
}

function svg(
  size: { width: number; height: number },
  label: string,
  parts: readonly string[],
): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size.width)}" height="${String(size.height)}" viewBox="0 0 ${String(size.width)} ${String(size.height)}" role="img" aria-label="${escape(label)}" font-family="${escape(FONT)}">`,
    `<title>${escape(label)}</title>`,
    ...parts,
    "</svg>",
    "",
  ].join("\n");
}

function text(
  x: number,
  y: number,
  content: string,
  style: {
    fill: string;
    size: number;
    weight?: number;
    anchor?: "start" | "middle" | "end";
  },
): string {
  const weight =
    style.weight === undefined ? "" : ` font-weight="${String(style.weight)}"`;
  const anchor =
    style.anchor === undefined || style.anchor === "start"
      ? ""
      : ` text-anchor="${style.anchor}"`;
  return `<text x="${n(x)}" y="${n(y)}" font-size="${String(style.size)}" fill="${style.fill}"${weight}${anchor}>${escape(content)}</text>`;
}

function ticks(domain: readonly [number, number], step: number): number[] {
  const [lo, hi] = domain;
  const values: number[] = [];
  // Counted in steps, not summed, so no float drift reaches a label.
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9; k++) {
    values.push(Number((k * step).toFixed(6)));
  }
  return values;
}

function maxOf(
  history: readonly HistoryEntry[],
  value: (entry: HistoryEntry) => number | null,
): number {
  return Math.max(
    0,
    ...history.map(value).filter((v): v is number => v !== null),
  );
}

function roundUp(value: number, step: number, least: number): number {
  return Math.max(least, Math.ceil(value / step - 1e-9) * step);
}

/** About how wide a system sans-serif draws this text; no font is measured. */
function estimateWidth(content: string, size: number): number {
  return content.length * size * 0.56;
}

/** Coordinates to one decimal: enough for a screen, stable in a diff. */
function n(value: number): string {
  return String(Number(value.toFixed(1)));
}

function escape(content: string): string {
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
