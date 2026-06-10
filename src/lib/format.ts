import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

let uidCounter = 0;
export function uid(prefix = "id"): string {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function fmtNum(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1_000_000_000) return `${(x / 1_000_000_000).toFixed(digits)}B`;
  if (abs >= 1_000_000) return `${(x / 1_000_000).toFixed(digits)}M`;
  if (abs >= 10_000) return `${(x / 1_000).toFixed(digits)}K`;
  if (abs >= 100) return x.toFixed(0);
  if (Number.isInteger(x)) return x.toString();
  return x.toFixed(digits);
}

export function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${x.toFixed(digits)}%`;
}

export function fmtSigned(x: number | null | undefined, digits = 1, suffix = "%"): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(digits)}${suffix}`;
}

export function fmtMbps(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  if (Math.abs(x) >= 1000) return `${(x / 1000).toFixed(2)} Gbps`;
  return `${x.toFixed(0)} Mbps`;
}

export function fmtKpiValue(value: number, unit: string): string {
  switch (unit) {
    case "%":
      // availability-class values need 2 decimals to stay meaningful
      return value >= 99 && value < 100 ? fmtPct(value, 2) : fmtPct(value);
    case "score":
      return value.toFixed(1);
    case "count":
      return fmtNum(value, 0);
    case "Mbps":
      return fmtMbps(value);
    case "Gbps":
      return `${value.toFixed(2)} Gbps`;
    case "days":
      return `${Math.round(value)} d`;
    case "ms":
      return `${value.toFixed(1)} ms`;
    case "pct/wk":
      return fmtSigned(value, 1, "%/wk");
    default:
      return fmtNum(value);
  }
}

export function fmtDate(t: number | null | undefined): string {
  if (!t) return "—";
  return dayjs(t).format("DD MMM YYYY");
}

export function fmtDateTime(t: number | null | undefined): string {
  if (!t) return "—";
  return dayjs(t).format("DD MMM HH:mm");
}

export function fmtTimeAgo(t: number): string {
  return dayjs(t).fromNow();
}

export function fmtBytes(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function dayKey(t: number): string {
  return dayjs(t).format("YYYY-MM-DD");
}

export function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
