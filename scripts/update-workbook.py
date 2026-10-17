"""Refill the authored Excel template in GitHub Actions, where Artifact Tool is unavailable.

The local deliverable/template is authored and visually checked with Artifact Tool.
This unattended updater preserves its layout and uses the same normalized table
model as the original authoring run. It requires no Mac or private API credential.
"""
import json
import sys
from copy import copy
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from openpyxl import load_workbook
from openpyxl.styles import Font, Alignment
from openpyxl.worksheet.table import TableColumn
from openpyxl.worksheet.filters import AutoFilter
from openpyxl.utils import get_column_letter
from openpyxl.workbook.properties import CalcProperties

ROOT = Path(__file__).resolve().parent.parent
FORMATS = {"number": "#,##0.##", "currency": '"$"#,##0.00', "percent": "0.0%", "date": "mm/dd/yy", "datetime": "mm/dd/yy hh:mm"}


def is_url(value):
    if not isinstance(value, str):
        return False
    url = urlsplit(value)
    return url.scheme in ("http", "https") and bool(url.netloc) and not url.username and not url.password


def typed(value, kind):
    if value is None:
        return None
    if kind in ("date", "datetime") and isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            # Workbook timestamps are explicitly labeled UTC. Excel has no timezone type.
            return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
        except ValueError:
            return value
    return value


def assign(cell, value, kind):
    cell.value = typed(value, kind)
    # Publisher text cannot turn into an executable spreadsheet formula.
    if isinstance(cell.value, str):
        cell.data_type = "s"
    cell.hyperlink = value if kind == "url" and is_url(value) else None
    if kind == "url" and cell.hyperlink:
        font = copy(cell.font)
        font.color = "0563C1"
        font.underline = "single"
        cell.font = font
    cell.number_format = ("#,##0" if isinstance(value, (int, float)) and value == int(value) else "#,##0.0000") if kind == "number" else FORMATS.get(kind, "@" if kind in ("text", "url") else "General")


def main():
    model_path = Path(sys.argv[1])
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs/downloads/High-Point-Property-Research.xlsx"
    model = json.loads(model_path.read_text())
    workbook = load_workbook(ROOT / "config/workbook-template.xlsx")
    for spec in model["tables"]:
        sheet = workbook[spec["sheet"]]
        header = spec["headerRow"]
        existing = sheet.tables[spec["name"]]
        old_count = len(existing.tableColumns)
        styles = [copy(sheet.cell(header + 1, column)._style) for column in range(1, max(old_count, len(spec["columns"])) + 1)]
        header_style = copy(sheet.cell(header, 1)._style)
        if sheet.max_row > header:
            sheet.delete_rows(header + 1, sheet.max_row - header)
        if sheet.max_column > len(spec["columns"]):
            sheet.delete_cols(len(spec["columns"]) + 1, sheet.max_column - len(spec["columns"]))
        for index, column in enumerate(spec["columns"], start=1):
            target = sheet.cell(header, index, column["label"])
            target._style = header_style
            target.alignment = Alignment(wrap_text=True, vertical="center")
            sheet.column_dimensions[get_column_letter(index)].width = column.get("width", 24)
        for row_number, row in enumerate(spec["rows"], start=header + 1):
            for index, (value, column) in enumerate(zip(row, spec["columns"]), start=1):
                target = sheet.cell(row_number, index)
                if index <= len(styles):
                    target._style = styles[index - 1]
                assign(target, value, column["type"])
        last = max(header + 1, header + len(spec["rows"]))
        existing.ref = f'A{header}:{get_column_letter(len(spec["columns"]))}{last}'
        existing.tableColumns = [TableColumn(id=index, name=column["label"]) for index, column in enumerate(spec["columns"], start=1)]
        existing.autoFilter = AutoFilter(ref=existing.ref)
        sheet.freeze_panes = "D6" if spec["sheet"] == "Properties" else "C6"
        sheet.sheet_view.showGridLines = False
        # Reconcile every exported row and keep all source identifiers as text.
        if len(spec["rows"]) != last - header:
            if spec["rows"]:
                raise ValueError("Workbook table row mismatch")
    overview = workbook["Overview"]
    snapshot = model["snapshot"]
    for address, key, kind in [("B5", "generatedAt", "datetime"), ("B6", "lastRunStatus", "text"), ("B7", "finishedAt", "datetime"), ("B8", "schedule", "text"), ("B11", "properties", "number"), ("B12", "records", "number"), ("B13", "sources", "number"), ("B14", "sourceErrors", "number"), ("B15", "directPhotos", "number"), ("B18", "latestDownload", "url"), ("B19", "dashboard", "url"), ("B20", "recordsUrl", "url")]:
        assign(overview[address], snapshot.get(key), kind)
    workbook.calculation = CalcProperties(calcId=191029, fullCalcOnLoad=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.xlsx")
    workbook.save(temporary)
    temporary.replace(output)
    checked = load_workbook(output, read_only=False, data_only=False)
    for spec in model["tables"]:
        sheet = checked[spec["sheet"]]
        if spec["rows"] and sheet.max_row != spec["headerRow"] + len(spec["rows"]):
            raise ValueError("Saved workbook row count failed verification")
        if len(sheet.tables[spec["name"]].tableColumns) != len(spec["columns"]):
            raise ValueError("Saved workbook column count failed verification")
    print(json.dumps({"file": str(output), "bytes": output.stat().st_size, "tables": [{"name": spec["name"], "rows": len(spec["rows"])} for spec in model["tables"]]}))


if __name__ == "__main__":
    main()
