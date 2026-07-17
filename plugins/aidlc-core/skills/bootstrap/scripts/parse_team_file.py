#!/usr/bin/env python3
"""
Team File Parser for Azure DevOps Planner
Reads a CSV or Excel file with team member information and outputs structured JSON.

Usage:
    python3 parse_team_file.py /path/to/team_file.csv
    python3 parse_team_file.py /path/to/team_file.xlsx

Expected columns (case-insensitive, flexible naming):
    Name          → name, full name, member name, team member, person
    Email         → email, email address, mail, e-mail
    Team          → team, team name, department, group, squad
    Role          → role, title, position, job title, responsibility
    Contribution  → contribution, contribution %, allocation, allocation %, capacity, availability, time %
    Involvement   → involvement, involvement type, engagement, engagement type, commitment, project type

Output: JSON array printed to stdout
"""

import sys
import os
import json
import csv
import re


# Column name variants (lowercase) mapped to standard field names
COLUMN_ALIASES = {
    # Name
    "name": "name",
    "full name": "name",
    "fullname": "name",
    "member name": "name",
    "member": "name",
    "team member": "name",
    "person": "name",
    "employee": "name",
    "employee name": "name",
    # Email
    "email": "email",
    "email address": "email",
    "e-mail": "email",
    "mail": "email",
    "email id": "email",
    # Team
    "team": "team",
    "team name": "team",
    "department": "team",
    "group": "team",
    "squad": "team",
    "unit": "team",
    # Role
    "role": "role",
    "title": "role",
    "position": "role",
    "job title": "role",
    "responsibility": "role",
    "designation": "role",
    "job role": "role",
    # Contribution %
    "contribution": "contribution",
    "contribution %": "contribution",
    "contribution%": "contribution",
    "allocation": "contribution",
    "allocation %": "contribution",
    "allocation%": "contribution",
    "capacity": "contribution",
    "capacity %": "contribution",
    "availability": "contribution",
    "availability %": "contribution",
    "time": "contribution",
    "time %": "contribution",
    "time%": "contribution",
    "percentage": "contribution",
    "percent": "contribution",
    "fte": "contribution",
    # Involvement type
    "involvement": "involvement",
    "involvement type": "involvement",
    "engagement": "involvement",
    "engagement type": "involvement",
    "commitment": "involvement",
    "project type": "involvement",
    "project role": "involvement",
    "assignment type": "involvement",
    "work type": "involvement",
    "dedication": "involvement",
}

# Normalize involvement type values to standard names
INVOLVEMENT_ALIASES = {
    "primary": "primary",
    "full": "primary",
    "full-time": "primary",
    "fulltime": "primary",
    "full time": "primary",
    "main": "primary",
    "dedicated": "primary",
    "core": "primary",
    "100": "primary",
    "secondary": "secondary",
    "part-time": "secondary",
    "parttime": "secondary",
    "part time": "secondary",
    "partial": "secondary",
    "split": "secondary",
    "shared": "secondary",
    "guidance": "guidance",
    "advisory": "guidance",
    "advisor": "guidance",
    "consultant": "guidance",
    "consulting": "guidance",
    "mentor": "guidance",
    "oversight": "guidance",
    "reviewer": "guidance",
    "review": "guidance",
    "guide": "guidance",
    "support": "guidance",
    "sme": "guidance",
}


def normalize_header(header):
    """Map a column header to a standard field name."""
    cleaned = re.sub(r"[^\w\s%]", "", header.strip().lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return COLUMN_ALIASES.get(cleaned)


def parse_contribution(value):
    """Parse contribution percentage from various formats (e.g., '50%', '50', '0.5')."""
    if not value:
        return None
    value = str(value).strip().replace("%", "")
    try:
        num = float(value)
        # If the number is between 0 and 1, treat as fraction (e.g., 0.5 = 50%)
        if 0 < num <= 1:
            return int(num * 100)
        # If between 1 and 100, treat as percentage
        elif 1 < num <= 100:
            return int(num)
        else:
            return None
    except ValueError:
        return None


def parse_involvement(value):
    """Parse involvement type from various formats."""
    if not value:
        return None
    cleaned = str(value).strip().lower()
    return INVOLVEMENT_ALIASES.get(cleaned, cleaned)


def read_csv(filepath):
    """Read team data from a CSV or TSV file."""
    # Detect delimiter
    with open(filepath, "r", encoding="utf-8-sig") as f:
        sample = f.read(2048)
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")

    rows = []
    with open(filepath, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, dialect=dialect)
        header_map = {}
        for orig_col in reader.fieldnames:
            std_name = normalize_header(orig_col)
            if std_name:
                header_map[orig_col] = std_name

        if not header_map:
            print(
                "ERROR: Could not identify required columns (Name, Email, Team, Role).",
                file=sys.stderr,
            )
            print(f"Found columns: {reader.fieldnames}", file=sys.stderr)
            sys.exit(1)

        for row in reader:
            mapped = {}
            for orig_col, std_name in header_map.items():
                val = row.get(orig_col, "").strip()
                if val:
                    mapped[std_name] = val
            if mapped.get("name"):  # At minimum, a name is required
                rows.append(mapped)

    return rows, set(header_map.values())


def read_excel(filepath):
    """Read team data from an Excel file (.xlsx, .xls)."""
    try:
        import openpyxl
    except ImportError:
        print("Installing openpyxl...", file=sys.stderr)
        os.system(f"{sys.executable} -m pip install openpyxl --break-system-packages -q")
        import openpyxl

    wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
    ws = wb.active

    all_rows = list(ws.iter_rows(values_only=True))
    if not all_rows:
        print("ERROR: Excel file is empty.", file=sys.stderr)
        sys.exit(1)

    # First row is header
    raw_headers = [str(h).strip() if h else "" for h in all_rows[0]]
    header_map = {}
    for i, h in enumerate(raw_headers):
        std_name = normalize_header(h)
        if std_name:
            header_map[i] = std_name

    if not header_map:
        print(
            "ERROR: Could not identify required columns (Name, Email, Team, Role).",
            file=sys.stderr,
        )
        print(f"Found columns: {raw_headers}", file=sys.stderr)
        sys.exit(1)

    rows = []
    for row_data in all_rows[1:]:
        mapped = {}
        for col_idx, std_name in header_map.items():
            val = str(row_data[col_idx]).strip() if col_idx < len(row_data) and row_data[col_idx] else ""
            if val and val.lower() != "none":
                mapped[std_name] = val
        if mapped.get("name"):
            rows.append(mapped)

    wb.close()
    return rows, set(header_map.values())


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 parse_team_file.py <team_file>")
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.exists(filepath):
        print(f"ERROR: File not found: {filepath}", file=sys.stderr)
        sys.exit(1)

    ext = os.path.splitext(filepath)[1].lower()

    if ext in (".csv", ".tsv", ".txt"):
        rows, found_fields = read_csv(filepath)
    elif ext in (".xlsx", ".xls"):
        rows, found_fields = read_excel(filepath)
    else:
        print(f"ERROR: Unsupported file type '{ext}'. Use .csv, .tsv, .xlsx, or .xls", file=sys.stderr)
        sys.exit(1)

    # Ensure all standard fields exist (fill missing with defaults)
    standard_fields = {"name", "email", "team", "role", "contribution", "involvement"}
    missing_fields = standard_fields - found_fields

    if missing_fields:
        print(
            f"WARNING: Missing columns: {', '.join(missing_fields)}. "
            f"These fields will use default values in the output.",
            file=sys.stderr,
        )

    # Normalize output: ensure all 6 fields present in every row
    output = []
    for row in rows:
        contribution = parse_contribution(row.get("contribution", ""))
        involvement = parse_involvement(row.get("involvement", ""))

        output.append(
            {
                "name": row.get("name", ""),
                "email": row.get("email", ""),
                "team": row.get("team", ""),
                "role": row.get("role", ""),
                "contribution": contribution if contribution is not None else 100,
                "involvement": involvement if involvement is not None else "primary",
            }
        )

    print(json.dumps(output, indent=2))
    print(f"\nParsed {len(output)} team members from {os.path.basename(filepath)}", file=sys.stderr)

    if "email" in missing_fields:
        print(
            "\n⚠️  No email column found. Email addresses are required for "
            "Azure DevOps work item assignment. Please provide emails.",
            file=sys.stderr,
        )

    if "contribution" in missing_fields:
        print(
            "\n⚠️  No contribution/allocation column found. Defaulting all members to 100%. "
            "Consider adding a 'Contribution %' column for accurate capacity planning.",
            file=sys.stderr,
        )

    if "involvement" in missing_fields:
        print(
            "\n⚠️  No involvement type column found. Defaulting all members to 'primary'. "
            "Consider adding an 'Involvement' column (primary/secondary/guidance) for better task assignment.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
