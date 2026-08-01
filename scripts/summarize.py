#!/usr/bin/env python3
"""
Reads ci-health-audit JSON (projects array + top-level mean score) from the
CIHA_JSON_OUT environment variable and writes a GitHub job-summary markdown
table to stdout. Called by the action.yml composite action step.
"""
import json
import os
import sys

raw    = os.environ.get("CIHA_JSON_OUT", "")
mode   = os.environ.get("CIHA_MODE", "scan")
config = os.environ.get("CIHA_CONFIG", "")

try:
    d = json.loads(raw)
except Exception:
    d = {}

mean     = d.get("score", "")
projects = d.get("projects") or []

lines = []
lines.append("## ci-health-audit — " + mode + " results")
lines.append("")
lines.append(
    "**Mean score:** " + str(mean)
    + "  |  **Config:** `" + config + "`"
    + "  |  **Mode:** " + mode
)
lines.append("")

has_gate = any(p.get("gate") for p in projects)
if has_gate:
    lines.append(
        "| Project | Score | locPerModule | depDepth"
        " | circularDeps | complexity | fanInOut | Gate | Floor |"
    )
    lines.append(
        "|---------|------:|-------------:|---------:"
        "|-------------:|-----------:|---------:|------|------:|"
    )
else:
    lines.append(
        "| Project | Score | locPerModule | depDepth"
        " | circularDeps | complexity | fanInOut |"
    )
    lines.append(
        "|---------|------:|-------------:|---------:"
        "|-------------:|-----------:|---------:|"
    )

for p in projects:
    name  = str(p.get("name", "")).replace("|", "&#124;")
    score = p.get("score", "")
    bd    = p.get("breakdown") or {}
    gate  = p.get("gate")
    lpm   = bd.get("locPerModule", "")
    dd    = bd.get("depDepth", "")
    cd    = bd.get("circularDeps", "")
    cx    = bd.get("complexity", "")
    fi    = bd.get("fanInOut", "")

    if has_gate:
        if gate:
            decision = gate.get("decision", "")
            floor_v  = gate.get("floor", "")
            gate_col = ("pass" if decision == "pass" else "FAIL") if decision else ""
        else:
            gate_col = ""
            floor_v  = ""
        lines.append(
            "| " + name + " | " + str(score)
            + " | " + str(lpm)
            + " | " + str(dd)
            + " | " + str(cd)
            + " | " + str(cx)
            + " | " + str(fi)
            + " | " + gate_col
            + " | " + str(floor_v) + " |"
        )
    else:
        lines.append(
            "| " + name + " | " + str(score)
            + " | " + str(lpm)
            + " | " + str(dd)
            + " | " + str(cd)
            + " | " + str(cx)
            + " | " + str(fi) + " |"
        )

if not projects:
    lines.append("*(no project data)*")

lines.append("")
lines.append("<details><summary>Full JSON output</summary>")
lines.append("")
lines.append("```json")
lines.append(raw)
lines.append("```")
lines.append("")
lines.append("</details>")

print("\n".join(lines))
