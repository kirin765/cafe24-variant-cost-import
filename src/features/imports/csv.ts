import { CSV_LIMITS, issue, type CsvRow, type ImportIssue } from "./model";

export interface ParsedCsvRecord {
  values: string[];
  line: number;
}

export interface SupplyCsvParseResult {
  rows: CsvRow[];
  fileIssues: ImportIssue[];
}

const EXPECTED_HEADER = ["variant_code", "supply_price"] as const;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsvRecords(input: string): ParsedCsvRecord[] {
  const text = stripBom(input);
  const records: ParsedCsvRecord[] = [];
  let values: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    values.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push({ values, line: recordLine });
    values = [];
    recordLine = line;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else if (char === "\r" && text[index + 1] === "\n") {
        field += "\r\n";
        index += 1;
        line += 1;
      } else if (char === "\n" || char === "\r") {
        field += char;
        line += 1;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length === 0) {
        inQuotes = true;
      } else {
        field += char;
      }
      continue;
    }

    if (char === ",") {
      endField();
      continue;
    }

    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }

    field += char;
  }

  if (field.length > 0 || values.length > 0) endRecord();
  return records;
}

function isBlankRecord(record: ParsedCsvRecord): boolean {
  return record.values.length === 1 && record.values[0] === "";
}

export function parseSupplyPriceCsv(
  text: string,
  limits: { maxBytes: number; maxRows: number } = CSV_LIMITS,
): SupplyCsvParseResult {
  const fileIssues: ImportIssue[] = [];
  const bytes = byteLength(text);
  if (bytes > limits.maxBytes) {
    fileIssues.push(
      issue("file_too_large", "error", `파일이 ${limits.maxBytes}바이트를 넘습니다 (${bytes}바이트).`),
    );
    return { rows: [], fileIssues };
  }

  const records = parseCsvRecords(text).filter((record) => !isBlankRecord(record));
  if (records.length === 0) {
    fileIssues.push(issue("file_header", "error", "CSV 헤더 행을 찾지 못했습니다."));
    return { rows: [], fileIssues };
  }

  const header = records[0].values.map((value) => value.trim().toLowerCase());
  const headerMatches =
    header.length === EXPECTED_HEADER.length &&
    EXPECTED_HEADER.every((name, index) => header[index] === name);
  if (!headerMatches) {
    fileIssues.push(
      issue(
        "file_header",
        "error",
        `헤더는 ${EXPECTED_HEADER.join(",")} 여야 합니다. 받은 값: ${records[0].values
          .map((value) => JSON.stringify(value))
          .join(",")}`,
      ),
    );
    return { rows: [], fileIssues };
  }

  const dataRecords = records.slice(1);
  const overflow = dataRecords.length > limits.maxRows;
  if (overflow) {
    fileIssues.push(
      issue(
        "file_too_many_rows",
        "error",
        `행이 ${limits.maxRows}개를 넘습니다 (${dataRecords.length}행). 앞 ${limits.maxRows}행만 표시합니다.`,
      ),
    );
  }

  const rows: CsvRow[] = dataRecords.slice(0, limits.maxRows).map((record) => ({
    line: record.line,
    variantCode: record.values[0] ?? "",
    rawSupplyPrice: record.values[1] ?? "",
    fieldCount: record.values.length,
  }));

  return { rows, fileIssues };
}
