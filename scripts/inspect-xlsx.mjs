import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const path = process.argv[2];
const wb = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
console.log("SHEETS:", wb.SheetNames.join(" | "));
for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  console.log(`\n=== SHEET: ${name} (ref ${sheet["!ref"]}) ===`);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  console.log("rowCount:", rows.length);
  if (rows.length > 0) {
    console.log("COLUMNS:", JSON.stringify(Object.keys(rows[0])));
    for (const r of rows.slice(0, 15)) console.log(JSON.stringify(r));
  }
  // also raw matrix view of the first 4 rows to spot title/merged headers
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  console.log("RAW first 3 rows:", JSON.stringify(matrix.slice(0, 3)));
}
