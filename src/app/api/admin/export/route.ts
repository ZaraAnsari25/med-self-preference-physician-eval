import { NextResponse } from "next/server";
import { buildExport, EXPORT_DATASETS, toCsv, type ExportDataset } from "@/server/exports";
import { apiError, HttpError, requireApiUser } from "@/server/http";

export async function GET(req: Request) {
  try {
    const { db } = await requireApiUser(req, "admin");
    const url = new URL(req.url);
    const dataset = url.searchParams.get("dataset") as ExportDataset;
    const format = url.searchParams.get("format") ?? "csv";
    if (!EXPORT_DATASETS.includes(dataset)) throw new HttpError(400, "Unknown dataset");
    if (format !== "csv" && format !== "json") throw new HttpError(400, "Unknown format");
    const rows = await buildExport(db, dataset);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `physician-eval_${dataset}_${stamp}.${format}`;
    const body =
      format === "csv"
        ? toCsv(rows)
        : JSON.stringify({ dataset, exported_at: new Date().toISOString(), row_count: rows.length, rows }, null, 1);
    return new NextResponse(body, {
      headers: {
        "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
