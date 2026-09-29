#!/usr/bin/env python3
"""
Check how MonitorMail reads an attendance PDF, using the same parser as the server.

Usage:
    python test_pdf_parsing.py <path_to_pdf>
"""

import sys

from app import parse_attendance_pdf, ATTENDANCE_THRESHOLD


def main(pdf_path):
    students = parse_attendance_pdf(pdf_path)
    total_records = sum(len(s['subjects']) for s in students.values())
    print(f"\n📄 {pdf_path}")
    print(f"✅ {len(students)} students, {total_records} subject records\n")

    low = {reg: s for reg, s in students.items() if any(x['Percentage'] < ATTENDANCE_THRESHOLD for x in s['subjects'])}
    print(f"🔴 {len(low)} students below {ATTENDANCE_THRESHOLD}% in at least one subject:\n")
    for reg_no in sorted(low):
        record = low[reg_no]
        subjects = ', '.join(f"{x['Subject']} {x['Percentage']:.2f}%" for x in record['subjects'] if x['Percentage'] < ATTENDANCE_THRESHOLD)
        print(f"  {reg_no}  {record['name'] or '(name not in PDF)':<30} {subjects}")

    if not students:
        print("⚠️  No students found - is this the 'Consolidated Academic Status' report?")
        return 1
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
