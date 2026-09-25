#!/usr/bin/env bun
/**
 * Compare NLL count Excel/CSV/TSV rows to
 * GET /api/stores/{storeNumber}/customers/{type}/count
 *
 * Run from projects/bbi-sst so exceljs resolves, or this file will load
 * exceljs from that package's node_modules.
 */

import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SST_ROOT = resolve(SCRIPT_DIR, "../../../../projects/bbi-sst");
const TYPES = ["new", "late", "lapsed"] as const;
type CustomerType = (typeof TYPES)[number];

type FileStoreRow = {
  franchisee: string;
  storeNumber: string;
  newCount: number;
  lateCount: number;
  lapsedCount: number;
  processing?: { new: number; late: number; lapsed: number };
};

type CountResponse = {
  storeNumber?: string;
  type?: string;
  windowStart?: string;
  windowEnd?: string;
  count?: number;
  error?: string;
};

type CellJob = {
  storeNumber: string;
  type: CustomerType;
  fileCount: number;
  note: string;
};

type CellResult = CellJob & {
  apiCount: number | null;
  error?: string;
};

function printHelp(): void {
  console.log(`Compare a PHP/SST NLL counts file to bbi-sst count endpoints.

Usage:
  bun compare-nll-counts.ts --file <path> --base-url <url> [options]

Options:
  --file <path>           .xlsx / .csv / .tsv counts report
  --base-url <url>        bbi-sst API origin (no trailing slash)
  --start <YYYY-MM-DD>    window start (date-only → 00:00:00)
  --end <YYYY-MM-DD>      window end (date-only → 23:59:59)
  --api-key <key>         ops key (else OPS_API_KEY / E2E_OPS_KEY / ops-api-key.ts)
  --stores <a,b,c>        only these store numbers
  --types <new,late,lapsed>
  --concurrency <n>       max in-flight HTTP calls (default 6)
  --include-external      also call the API for non-numeric stores
  --dry-run               parse the file and print stores; do not call the API
  --json-out <path>       write full results JSON
  --help
`);
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parseTypes(raw: string | undefined): CustomerType[] {
  if (!raw) return [...TYPES];
  const wanted = raw.split(",").map((s) => s.trim().toLowerCase());
  const out: CustomerType[] = [];
  for (const t of wanted) {
    if (!TYPES.includes(t as CustomerType)) {
      throw new Error(`Unknown type "${t}". Use new, late, lapsed.`);
    }
    out.push(t as CustomerType);
  }
  return out;
}

function parseStoreFilter(raw: string | undefined): Set<string> | undefined {
  if (!raw) return undefined;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function isNumericStore(storeNumber: string): boolean {
  return /^\d+$/.test(storeNumber);
}

function toCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (trimmed === "") return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeStore(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(Math.trunc(value));
  }
  return String(value).trim().replace(/\.0$/, "");
}

function headerKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[#]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type ColMap = {
  franchisee?: number;
  store?: number;
  new?: number;
  late?: number;
  lapsed?: number;
  processing?: number;
};

function mapHeader(cells: unknown[]): ColMap | null {
  const keys = cells.map(headerKey);
  const find = (...aliases: string[]): number | undefined => {
    for (const alias of aliases) {
      const idx = keys.indexOf(alias);
      if (idx >= 0) return idx;
    }
    return undefined;
  };
  const store = find("store", "store number");
  const newCol = find("new count", "new");
  if (store == null || newCol == null) return null;
  return {
    franchisee: find("franchisee name", "franchisee"),
    store,
    new: newCol,
    late: find("late count", "late"),
    lapsed: find("lapsed count", "lapsed"),
    processing: find("new late lapsed"),
  };
}

function parseProcessing(raw: unknown): FileStoreRow["processing"] {
  const text = String(raw ?? "").trim();
  const m = /^(\d)\s*\/\s*(\d)\s*\/\s*(\d)$/.exec(text);
  if (!m) return undefined;
  return {
    new: Number(m[1]),
    late: Number(m[2]),
    lapsed: Number(m[3]),
  };
}

function isSkipRow(franchisee: string, storeNumber: string): boolean {
  if (!storeNumber) return true;
  const name = franchisee.trim().toLowerCase();
  if (name === "grand total") return true;
  if (name.endsWith(" counts")) return true;
  return false;
}

function rowFromCells(cells: unknown[], cols: ColMap): FileStoreRow | null {
  const storeNumber = normalizeStore(cells[cols.store ?? 1]);
  const franchisee = String(cells[cols.franchisee ?? 0] ?? "").trim();
  if (isSkipRow(franchisee, storeNumber)) return null;
  return {
    franchisee,
    storeNumber,
    newCount: toCount(cells[cols.new ?? 2]),
    lateCount: toCount(cells[cols.late ?? 3]),
    lapsedCount: toCount(cells[cols.lapsed ?? 4]),
    processing: parseProcessing(cells[cols.processing ?? 6]),
  };
}

function detectDelim(line: string): "," | "\t" {
  const tabs = (line.match(/\t/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  return tabs >= commas ? "\t" : ",";
}

function splitDelimited(line: string, delim: "," | "\t"): string[] {
  if (delim === "\t") {
    return line.split("\t").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
  }
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseDelimited(text: string): {
  rows: FileStoreRow[];
  title?: string;
} {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [] };
  const delim = detectDelim(lines[0]!);
  let cols: ColMap | null = null;
  let title: string | undefined;
  const rows: FileStoreRow[] = [];
  for (const line of lines) {
    const cells = splitDelimited(line, delim);
    if (!cols) {
      const mapped = mapHeader(cells);
      if (mapped) {
        cols = mapped;
        continue;
      }
      if (!title) title = cells[0]?.trim() || undefined;
      continue;
    }
    const row = rowFromCells(cells, cols);
    if (row) rows.push(row);
  }
  if (!cols) {
    throw new Error("Could not find a header row with Store # and New Count");
  }
  return { rows, title };
}

type ExcelJSWorkbook = {
  xlsx: { readFile: (path: string) => Promise<unknown> };
  worksheets: Array<{
    eachRow: (
      opts: { includeEmpty: boolean },
      cb: (row: { values: unknown }, rowNumber: number) => void,
    ) => void;
  }>;
};

async function loadExcelJS(): Promise<{ Workbook: new () => ExcelJSWorkbook }> {
  try {
    return (await import("exceljs")) as unknown as {
      Workbook: new () => ExcelJSWorkbook;
    };
  } catch {
    const require = createRequire(join(SST_ROOT, "package.json"));
    return require("exceljs") as { Workbook: new () => ExcelJSWorkbook };
  }
}

async function parseXlsx(filePath: string): Promise<{
  rows: FileStoreRow[];
  title?: string;
}> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("Workbook has no sheets");

  let cols: ColMap | null = null;
  let title: string | undefined;
  const rows: FileStoreRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    if (!cols) {
      const mapped = mapHeader(values);
      if (mapped) {
        cols = mapped;
        return;
      }
      if (!title) {
        const first = values.find((v) => String(v ?? "").trim() !== "");
        if (first != null) title = String(first).trim();
      }
      return;
    }
    const parsed = rowFromCells(values, cols);
    if (parsed) rows.push(parsed);
  });

  if (!cols) {
    throw new Error("Could not find a header row with Store # and New Count");
  }
  return { rows, title };
}

function usOrIsoToIso(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!us) return undefined;
  return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
}

function parseTitleWindow(
  title: string | undefined,
): { start: string; end: string } | undefined {
  if (!title) return undefined;
  const range = /—\s*(.+?)\s+to\s+(.+?)\s*$/i.exec(title);
  if (!range) return undefined;
  const start = usOrIsoToIso(range[1]!);
  const end = usOrIsoToIso(range[2]!);
  if (!start || !end) return undefined;
  return { start, end };
}

function etYmd(d: Date): { y: number; m: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

function addDaysIso(y: number, m: number, day: number, delta: number): string {
  const utc = Date.UTC(y, m - 1, day + delta);
  const d = new Date(utc);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Last completed Sunday–Saturday week in America/New_York. */
function lastCompletedEtWeek(now = new Date()): { start: string; end: string } {
  const et = etYmd(now);
  const lastSunday = addDaysIso(et.y, et.m, et.day, -et.weekday - 7);
  const [sy, sm, sd] = lastSunday.split("-").map(Number);
  const end = addDaysIso(sy!, sm!, sd!, 6);
  return { start: lastSunday, end };
}

function readFallbackApiKey(): string | undefined {
  const fromEnv =
    process.env.OPS_API_KEY ??
    process.env.E2E_OPS_KEY ??
    process.env.BBI_SST_OPS_KEY;
  if (fromEnv?.trim()) return fromEnv.trim();
  try {
    const text = require("node:fs").readFileSync(
      join(SST_ROOT, "src/http/lib/ops-api-key.ts"),
      "utf8",
    ) as string;
    const m = /BBI_OPS_API_KEY\s*=\s*"([^"]+)"/.exec(text);
    return m?.[1];
  } catch {
    return undefined;
  }
}

async function parseFile(filePath: string): Promise<{
  rows: FileStoreRow[];
  title?: string;
}> {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".xlsx" || ext === ".xlsm") return parseXlsx(filePath);
  const text = await Bun.file(filePath).text();
  return parseDelimited(text);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

async function fetchCount(opts: {
  baseUrl: string;
  apiKey: string;
  storeNumber: string;
  type: CustomerType;
  start: string;
  end: string;
}): Promise<{ count: number; windowStart?: string; windowEnd?: string }> {
  const url = new URL(
    `${opts.baseUrl}/api/stores/${encodeURIComponent(opts.storeNumber)}/customers/${opts.type}/count`,
  );
  url.searchParams.set("startDate", opts.start);
  url.searchParams.set("endDate", opts.end);
  const res = await fetch(url, {
    headers: { "x-api-key": opts.apiKey },
  });
  const body = (await res.json().catch(() => ({}))) as CountResponse;
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${body.error ?? JSON.stringify(body).slice(0, 200)}`,
    );
  }
  if (typeof body.count !== "number") {
    throw new Error(`Missing count in response: ${JSON.stringify(body)}`);
  }
  return {
    count: body.count,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
  };
}

function likelyNote(
  type: CustomerType,
  fileCount: number,
  apiCount: number | null,
  processing: FileStoreRow["processing"],
  extra: string,
): string {
  const bits: string[] = [];
  if (extra) bits.push(extra);
  if (apiCount == null) return bits.join("; ") || "";
  if (type === "new" && fileCount === apiCount + 1) bits.push("likely PHP seed +1");
  if (processing && processing[type] === 0 && fileCount === 0 && apiCount > 0) {
    bits.push("campaign off in file");
  }
  if (fileCount < apiCount && !(type === "new" && fileCount === apiCount + 1)) {
    if (!bits.some((b) => b.includes("campaign off"))) {
      bits.push("file < API (limit / seed-excluded SST / blacklist)");
    }
  }
  return bits.join("; ");
}

function pad(value: unknown): string {
  return String(value ?? "");
}

async function ping(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/ping`);
  if (!res.ok) {
    throw new Error(`GET ${baseUrl}/api/ping failed: HTTP ${res.status}`);
  }
}

async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const filePath = argValue("--file");
  const baseUrl = (
    argValue("--base-url") ??
    process.env.BBI_SST_API_URL ??
    process.env.E2E_API_URL ??
    ""
  ).replace(/\/+$/, "");
  const apiKey = argValue("--api-key") ?? readFallbackApiKey();
  const types = parseTypes(argValue("--types"));
  const storeFilter = parseStoreFilter(argValue("--stores"));
  const concurrency = Number(argValue("--concurrency") ?? "6") || 6;
  const includeExternal = hasFlag("--include-external");
  const dryRun = hasFlag("--dry-run");
  const jsonOut = argValue("--json-out");

  if (!filePath) throw new Error("--file is required");
  if (!dryRun && !baseUrl) {
    throw new Error(
      "--base-url (or BBI_SST_API_URL / E2E_API_URL) is required",
    );
  }
  if (!dryRun && !apiKey) {
    throw new Error(
      "Pass --api-key or set OPS_API_KEY / E2E_OPS_KEY (local fallback: bbi-sst ops-api-key.ts)",
    );
  }

  const absFile = resolve(filePath);
  const parsed = await parseFile(absFile);
  const titleWindow = parseTitleWindow(parsed.title);
  const week = lastCompletedEtWeek();
  const start =
    argValue("--start") ??
    titleWindow?.start ??
    week.start;
  const end = argValue("--end") ?? titleWindow?.end ?? week.end;
  const windowSource =
    argValue("--start") || argValue("--end")
      ? "cli"
      : titleWindow
        ? "file title"
        : "last completed ET week";

  console.log(`File: ${basename(absFile)} (${parsed.rows.length} store rows)`);
  if (parsed.title) console.log(`Title: ${parsed.title}`);
  if (!dryRun) console.log(`API: ${baseUrl}`);
  console.log(`Window: ${start} → ${end} (${windowSource})`);
  console.log(`Types: ${types.join(", ")}`);

  if (dryRun) {
    console.log("");
    console.log("| Franchisee | Store | New | Late | Lapsed |");
    console.log("| --- | --- | ---: | ---: | ---: |");
    for (const row of parsed.rows) {
      if (storeFilter && !storeFilter.has(row.storeNumber)) continue;
      console.log(
        `| ${row.franchisee} | ${row.storeNumber} | ${row.newCount} | ${row.lateCount} | ${row.lapsedCount} |`,
      );
    }
    return;
  }

  if (!apiKey) {
    throw new Error("ops API key is required");
  }

  await ping(baseUrl);
  console.log("Ping: ok");

  const selected = parsed.rows.filter((row) => {
    if (storeFilter && !storeFilter.has(row.storeNumber)) return false;
    return true;
  });

  const skippedExternal: string[] = [];
  const jobs: CellJob[] = [];
  for (const row of selected) {
    if (!isNumericStore(row.storeNumber) && !includeExternal) {
      skippedExternal.push(row.storeNumber);
      continue;
    }
    for (const type of types) {
      const extra = !isNumericStore(row.storeNumber)
        ? "external store"
        : "";
      const fileCount =
        type === "new"
          ? row.newCount
          : type === "late"
            ? row.lateCount
            : row.lapsedCount;
      jobs.push({
        storeNumber: row.storeNumber,
        type,
        fileCount,
        note: extra,
      });
    }
  }

  if (skippedExternal.length > 0) {
    console.log(
      `Skipped ${skippedExternal.length} non-numeric store(s): ${skippedExternal.slice(0, 12).join(", ")}${skippedExternal.length > 12 ? "…" : ""}`,
    );
  }

  const byStore = new Map(selected.map((r) => [r.storeNumber, r]));
  let resolvedWindow: { start?: string; end?: string } = {};

  const results = await mapPool(jobs, concurrency, async (job) => {
    try {
      const fetched = await fetchCount({
        baseUrl,
        apiKey,
        storeNumber: job.storeNumber,
        type: job.type,
        start,
        end,
      });
      if (fetched.windowStart) resolvedWindow.start = fetched.windowStart;
      if (fetched.windowEnd) resolvedWindow.end = fetched.windowEnd;
      const proc = byStore.get(job.storeNumber)?.processing;
      return {
        ...job,
        apiCount: fetched.count,
        error: undefined,
        note: likelyNote(job.type, job.fileCount, fetched.count, proc, job.note),
      } satisfies CellResult;
    } catch (err) {
      return {
        ...job,
        apiCount: null,
        error: err instanceof Error ? err.message : String(err),
        note: job.note,
      } satisfies CellResult;
    }
  });

  if (resolvedWindow.start || resolvedWindow.end) {
    console.log(
      `Endpoint window: ${resolvedWindow.start ?? "?"} → ${resolvedWindow.end ?? "?"}`,
    );
  }

  const mismatches = results.filter(
    (r) => r.error || r.apiCount !== r.fileCount,
  );
  const errors = results.filter((r) => r.error);
  const comparedStores = new Set(results.map((r) => r.storeNumber));
  const matchedStores = [...comparedStores].filter((store) =>
    results
      .filter((r) => r.storeNumber === store)
      .every((r) => !r.error && r.apiCount === r.fileCount),
  );

  console.log("");
  console.log(
    `${matchedStores.length}/${comparedStores.size} stores match all requested types. ${mismatches.length} cell mismatch(es), ${errors.length} error(s).`,
  );

  if (mismatches.length > 0) {
    console.log("");
    console.log("| Store | Type | File | API | Δ | Note |");
    console.log("| --- | --- | ---: | ---: | ---: | --- |");
    for (const r of mismatches) {
      const delta =
        r.apiCount == null ? "" : String(r.apiCount - r.fileCount);
      const api = r.apiCount == null ? "err" : String(r.apiCount);
      const note = r.error ? r.error : r.note;
      console.log(
        `| ${pad(r.storeNumber)} | ${r.type} | ${r.fileCount} | ${api} | ${delta} | ${note} |`,
      );
    }
  }

  console.log("");
  for (const type of types) {
    const cells = results.filter((r) => r.type === type && r.apiCount != null);
    const fileSum = cells.reduce((acc, r) => acc + r.fileCount, 0);
    const apiSum = cells.reduce((acc, r) => acc + (r.apiCount ?? 0), 0);
    console.log(`${type}: file ${fileSum} vs API ${apiSum} (Δ ${apiSum - fileSum})`);
  }

  if (jsonOut) {
    await Bun.write(
      jsonOut,
      JSON.stringify(
        {
          file: absFile,
          baseUrl,
          start,
          end,
          windowSource,
          endpointWindow: resolvedWindow,
          storeCount: comparedStores.size,
          matchedStores: matchedStores.length,
          skippedExternal,
          results,
        },
        null,
        2,
      ),
    );
    console.log(`Wrote ${jsonOut}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
