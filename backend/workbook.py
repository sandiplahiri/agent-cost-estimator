from io import BytesIO
from zipfile import BadZipFile, ZipFile

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.workbook.properties import CalcProperties
from pydantic import ValidationError

from .engine import PLANNING_DAYS_PER_MONTH, calculate
from .models import AgentRow, Estimate

OVERRIDE_COLUMNS = [
    "model_id",
    "calls",
    "input_tokens",
    "output_tokens",
    "retry_rate",
    "cache_fraction",
    "cache_write_fraction",
]
VOLUME_COLUMNS = [
    "volume_source",
    "users_per_day",
    "invocations_per_user_per_agent_per_day",
]
IMPORT_COLUMNS = [
    "name",
    "complexity",
    "count",
    "invocations",
    *OVERRIDE_COLUMNS,
    *VOLUME_COLUMNS,
]


def literal(sheet, values):
    sheet.append(values)
    for cell in sheet[sheet.max_row]:
        if isinstance(cell.value, str):
            cell.data_type = "s"


def finish(workbook):
    for sheet in workbook:
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for cell in sheet[1]:
            cell.font = Font(color="FFFFFF", bold=True)
            cell.fill = PatternFill("solid", fgColor="153C39")
            cell.alignment = Alignment(wrap_text=True)
        sheet.row_dimensions[1].height = 32
        for column in sheet.columns:
            sheet.column_dimensions[column[0].column_letter].width = min(
                48, max(16, len(str(column[0].value or "")) + 3)
            )
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                if isinstance(cell.value, (int, float)) or cell.data_type == "f":
                    cell.number_format = "#,##0.000000;[Red]-#,##0.000000"
    workbook.calculation = CalcProperties(calcId=191029, fullCalcOnLoad=True)
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def import_template():
    wb = Workbook()
    ws = wb.active
    ws.title = "Agents"
    literal(ws, IMPORT_COLUMNS)
    literal(ws, ["Document classification", "simple", 1, 0, *([""] * 7), "daily_users", 1, 1])
    notes = wb.create_sheet("Instructions")
    literal(notes, ["Field", "Meaning"])
    for key, value in [
        (
            "Required",
            "New rows: name, complexity, count, volume_source=daily_users, users_per_day, and invocations_per_user_per_agent_per_day. Zero is valid; blanks are missing.",
        ),
        ("model_id", "Exact catalog or custom model ID. Blank inherits the profile model."),
        (
            "Units",
            "users per agent/day; invocations per user per agent/day; calls per invocation; tokens per call; rates are fractions, e.g. 0.02.",
        ),
        (
            "Daily volume",
            "Monthly invocations per agent = users_per_day × invocations_per_user_per_agent_per_day × 30 days. The invocations column is a legacy manual fallback and is ignored for daily rows.",
        ),
        (
            "Legacy import",
            "Old manual rows with invocations are accepted for compatibility and labeled in the app; enter both daily inputs to convert them.",
        ),
        ("Overrides", "Blank execution cells inherit the profile. Zero is an explicit override."),
        (
            "Ownership",
            "Each row is a disjoint group. This import replaces the current agent list after preview.",
        ),
        ("Safety", "Values only: formulas, macros and external links are not supported. Maximum 1,000 rows."),
    ]:
        literal(notes, [key, value])
    return finish(wb)


def read_import(data: bytes):
    errors, agents = [], []
    if len(data) > 5_000_000:
        raise ValueError("Spreadsheet must be smaller than 5 MB.")
    try:
        with ZipFile(BytesIO(data)) as archive:
            if sum(f.file_size for f in archive.infolist()) > 30_000_000:
                raise ValueError("Spreadsheet expands beyond the 30 MB limit.")
            if any(
                "vbaproject" in f.filename.lower() or "externallinks/" in f.filename.lower()
                for f in archive.infolist()
            ):
                raise ValueError("Macros and external workbook links are not accepted.")
        wb = load_workbook(BytesIO(data), read_only=True, data_only=False, keep_links=False)
    except (BadZipFile, KeyError, OSError) as exc:
        raise ValueError("Upload a valid .xlsx workbook.") from exc
    try:
        ws = wb["Agents"] if "Agents" in wb.sheetnames else wb.active
        if ws.max_row > 1001 or ws.max_column > 30:
            raise ValueError("Use at most 1,000 agent rows and 30 columns.")
        headers = [str(c.value or "").strip() for c in next(ws.iter_rows())]
        if len(set(headers)) != len(headers) or set(headers) - set(IMPORT_COLUMNS):
            raise ValueError("Use unique column names from the provided import template.")
        if not {"name", "complexity", "count"}.issubset(headers):
            raise ValueError("Required columns: name, complexity, count.")
        for index, cells in enumerate(ws.iter_rows(min_row=2), 2):
            if all(c.value is None for c in cells):
                continue
            if any(c.data_type == "f" for c in cells):
                errors.append(f"Row {index}: formulas are not allowed; paste values instead.")
                continue
            values = {key: c.value for key, c in zip(headers, cells) if c.value is not None and c.value != ""}
            missing = {"name", "complexity", "count"} - values.keys()
            source = values.get("volume_source", "manual")
            if source == "daily_users":
                missing |= {"users_per_day", "invocations_per_user_per_agent_per_day"} - values.keys()
            elif "invocations" not in values:
                missing.add("invocations")
            if missing:
                errors.append(f"Row {index}: required values missing: {', '.join(sorted(missing))}.")
                continue
            if source == "daily_users" and "invocations" not in values:
                values["invocations"] = 0
            overrides = {k: values.pop(k) for k in list(values) if k in OVERRIDE_COLUMNS}
            try:
                agents.append(AgentRow(**values, overrides=overrides).model_dump(mode="json"))
            except ValidationError as exc:
                errors.extend(
                    f"Row {index}, {'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()
                )
        if not agents and not errors:
            errors.append("No agent rows found.")
    finally:
        wb.close()
    return {"agents": agents if not errors else [], "errors": errors}


def export_estimate(estimate: Estimate):
    result = calculate(estimate)
    wb = Workbook()
    summary = wb.active
    summary.title = "Summary"
    literal(
        summary,
        [
            "Scenario",
            "LLM monthly USD",
            "Additional monthly USD",
            "Recurring monthly USD",
            "One-time USD",
            "First month USD",
            "First year USD",
            "Status",
        ],
    )
    calc = wb.create_sheet("Calculations")
    columns = [
        "Scenario",
        "Agent/group",
        "Step",
        "Model",
        "Count",
        "Total monthly invocations per agent",
        "Calls/invocation",
        "Extra attempt rate",
        "Input/call",
        "Output/call",
        "Cache read fraction",
        "Cache write fraction",
        "Input USD/M",
        "Output USD/M",
        "Cache read USD/M",
        "Cache write USD/M",
        "Monthly calls",
        "Input tokens/month",
        "Output tokens/month",
        "Input USD",
        "Output USD",
        "Cache read USD",
        "Cache write USD",
        "LLM monthly USD",
        "Status",
        "Volume source",
        "Users/day/agent",
        "Invocations/user/agent/day",
        "Planning days/month",
        "Manual invocations/agent/month",
        "Scenario volume factor",
        "Complexity",
        "Uncached input tokens/month",
        "Cached read tokens/month",
        "Cache write tokens/month",
    ]
    literal(calc, columns)
    for s in result["scenarios"]:
        start = calc.max_row + 1
        for line in s["lines"]:
            rates = line["rates"]
            literal(
                calc,
                [
                    s["name"],
                    line["name"],
                    line["step"],
                    line["model_id"],
                    line["count"],
                    None,
                    *[
                        float(line[k])
                        for k in (
                            "calls_per_invocation",
                            "retry_rate",
                            "input_per_call",
                            "output_per_call",
                            "cache_fraction",
                            "cache_write_fraction",
                        )
                    ],
                    *[
                        float(rates[k]) if rates[k] is not None else None
                        for k in ("input", "output", "cache_read", "cache_write")
                    ],
                    *[None] * 8,
                    "; ".join(line["issues"]) or "Complete",
                    line["volume_source"],
                    float(line["users_per_day"]) if line["users_per_day"] is not None else None,
                    (
                        float(line["invocations_per_user_per_agent_per_day"])
                        if line["invocations_per_user_per_agent_per_day"] is not None
                        else None
                    ),
                    float(line["days_per_month"]),
                    float(line["manual_invocations"]),
                    float(line["volume_factor"]),
                    line["complexity"],
                    None,
                    None,
                    None,
                ],
            )
            r = calc.max_row
            formulas = {
                "F": f'IF(Z{r}="daily_users",AA{r}*AB{r}*AC{r},AD{r})*AE{r}',
                "Q": f"E{r}*F{r}*G{r}*(1+H{r})",
                "R": f"Q{r}*I{r}",
                "S": f"Q{r}*J{r}",
                "AG": f"R{r}*(1-K{r}-L{r})",
                "AH": f"R{r}*K{r}",
                "AI": f"R{r}*L{r}",
            }
            if not line["issues"]:
                formulas |= {
                    "T": f"R{r}*(1-K{r}-L{r})*M{r}/1000000",
                    "U": f"S{r}*N{r}/1000000",
                    "V": f"R{r}*K{r}*O{r}/1000000",
                    "W": f"R{r}*L{r}*P{r}/1000000",
                    "X": f"SUM(T{r}:W{r})",
                }
            for col, formula in formulas.items():
                calc[f"{col}{r}"] = "=" + formula
        end = calc.max_row
        literal(
            summary,
            [
                s["name"],
                None,
                float(result["recurring"]),
                None,
                float(result["one_time"]),
                None,
                None,
                "Complete" if s["complete"] else "INCOMPLETE — known costs only",
            ],
        )
        r = summary.max_row
        summary[f"B{r}"] = f"=SUM(Calculations!X{start}:X{end})" if end >= start else "=0"
        summary[f"D{r}"] = f"=B{r}+C{r}"
        summary[f"F{r}"] = f"=D{r}+E{r}"
        summary[f"G{r}"] = f"=D{r}*12+E{r}"

    agents = wb.create_sheet("Agents")
    literal(agents, IMPORT_COLUMNS)
    for row in estimate.agents:
        literal(
            agents,
            [
                row.name,
                row.complexity,
                row.count,
                float(row.invocations),
                *[
                    str(getattr(row.overrides, k)) if getattr(row.overrides, k) is not None else ""
                    for k in OVERRIDE_COLUMNS
                ],
                row.volume_source,
                float(row.users_per_day) if row.users_per_day is not None else None,
                (
                    float(row.invocations_per_user_per_agent_per_day)
                    if row.invocations_per_user_per_agent_per_day is not None
                    else None
                ),
            ],
        )
    volume = wb.create_sheet("Volume")
    literal(
        volume,
        [
            "Agent/group",
            "Complexity",
            "Agent count",
            "Volume source",
            "Users per agent per day",
            "Invocations per user per agent per day",
            "Planning days per month",
            "Legacy manual invocations per agent per month",
            "Total monthly invocations per agent",
            "Total monthly invocations all agents",
        ],
    )
    for row in estimate.agents:
        literal(
            volume,
            [
                row.name,
                row.complexity,
                row.count,
                row.volume_source,
                float(row.users_per_day) if row.users_per_day is not None else None,
                (
                    float(row.invocations_per_user_per_agent_per_day)
                    if row.invocations_per_user_per_agent_per_day is not None
                    else None
                ),
                float(PLANNING_DAYS_PER_MONTH),
                float(row.invocations),
                None,
                None,
            ],
        )
        r = volume.max_row
        volume[f"I{r}"] = f'=IF(D{r}="daily_users",E{r}*F{r}*G{r},H{r})'
        volume[f"J{r}"] = f"=C{r}*I{r}"
    categories = wb.create_sheet("Category totals")
    literal(categories, ["Complexity", "Total monthly invocations all agents"])
    last_volume_row = volume.max_row
    for complexity in ("simple", "medium", "high"):
        literal(categories, [complexity, None])
        r = categories.max_row
        categories[f"B{r}"] = (
            f"=SUMIF(Volume!B2:B{last_volume_row},A{r},Volume!J2:J{last_volume_row})"
            if last_volume_row >= 2
            else "=0"
        )
    category_usage = wb.create_sheet("Category usage")
    literal(
        category_usage,
        [
            "Complexity",
            "Input tokens/month",
            "Output tokens/month",
            "Total tokens/month",
            "Average tokens/day",
            "Planning days/month",
        ],
    )
    last_calc_row = calc.max_row
    for complexity in ("simple", "medium", "high"):
        literal(category_usage, [complexity, None, None, None, None, float(PLANNING_DAYS_PER_MONTH)])
        r = category_usage.max_row
        for col, token_col in (("B", "R"), ("C", "S")):
            category_usage[f"{col}{r}"] = (
                f"=SUMIFS(Calculations!{token_col}2:{token_col}{last_calc_row},"
                f'Calculations!A2:A{last_calc_row},"Expected",'
                f"Calculations!AF2:AF{last_calc_row},A{r})"
                if last_calc_row >= 2
                else "=0"
            )
        category_usage[f"D{r}"] = f"=B{r}+C{r}"
        category_usage[f"E{r}"] = f"=D{r}/F{r}"
    category_costs = wb.create_sheet("Category costs")
    literal(
        category_costs,
        [
            "Complexity",
            "Token type",
            "Tokens/month",
            "Known cost USD/month",
            "Blended USD/1M tokens",
            "Status",
        ],
    )
    for complexity in ("simple", "medium", "high"):
        first = category_costs.max_row + 1
        status = (
            "Complete"
            if result["category_costs"][complexity]["complete"]
            else "INCOMPLETE — known costs only"
        )
        for token_type, token_col, cost_col in (
            ("Uncached input", "AG", "T"),
            ("Cached input read", "AH", "V"),
            ("Input cache write", "AI", "W"),
            ("Output incl. reasoning", "S", "U"),
        ):
            literal(category_costs, [complexity, token_type, None, None, None, status])
            r = category_costs.max_row
            for column, source in (("C", token_col), ("D", cost_col)):
                category_costs[f"{column}{r}"] = (
                    f"=SUMIFS(Calculations!{source}2:{source}{last_calc_row},"
                    f'Calculations!A2:A{last_calc_row},"Expected",'
                    f"Calculations!AF2:AF{last_calc_row},A{r})"
                    if last_calc_row >= 2
                    else "=0"
                )
            if status == "Complete":
                category_costs[f"E{r}"] = f'=IF(C{r}=0,"",D{r}*1000000/C{r})'
        last = category_costs.max_row
        literal(category_costs, [complexity, "Total", None, None, None, status])
        r = category_costs.max_row
        category_costs[f"C{r}"] = f"=SUM(C{first}:C{last})"
        category_costs[f"D{r}"] = f"=SUM(D{first}:D{last})"
    for title, records in [
        ("Profiles", [dict(complexity=k, **v.model_dump(mode="json")) for k, v in estimate.profiles.items()]),
        ("Scenarios", [s.model_dump(mode="json") for s in estimate.scenarios]),
        ("Additional costs", [c.model_dump(mode="json") for c in estimate.additional_costs]),
    ]:
        sheet = wb.create_sheet(title)
        if records:
            keys = list(records[0])
            literal(sheet, keys)
            for record in records:
                literal(sheet, [record[k] for k in keys])
        else:
            literal(sheet, ["No items"])
    pricing = wb.create_sheet("Pricing")
    literal(
        pricing,
        [
            "Model ID",
            "Provider",
            "Input USD/M",
            "Output USD/M",
            "Cache read USD/M",
            "Cache write USD/M",
            "Source",
            "Retrieved at",
            "Custom",
            "Tier details",
            "Unsupported",
        ],
    )
    for p in estimate.prices.values():
        literal(
            pricing,
            [
                p.id,
                p.provider,
                *[
                    float(getattr(p, k)) if getattr(p, k) is not None else None
                    for k in ("input", "output", "cache_read", "cache_write")
                ],
                p.source,
                p.retrieved_at,
                p.custom,
                "; ".join(t.model_dump_json() for t in p.tiers),
                ", ".join(p.unsupported),
            ],
        )
    notes = wb.create_sheet("Read me")
    literal(notes, ["Item", "Detail"])
    for key, value in [
        ("Estimate", estimate.name),
        ("Notes", estimate.notes),
        ("Currency", "USD"),
        (
            "Calculation editing",
            "Edit numeric inputs in Calculations to recalculate costs. Column F derives scenario monthly volume from columns Z–AE; daily mode uses a 30-day planning month. Profiles, Scenarios, Agents and Pricing document the snapshot; editing those sheets does not propagate to Calculations.",
        ),
        (
            "Volume and category totals",
            "Volume derives baseline monthly invocations per agent and all agents from the exported inventory. Category totals sums the Volume sheet by complexity. These totals exclude scenario volume multipliers; Calculations contains scenario-effective volumes.",
        ),
        (
            "Category token usage",
            "Category usage sums Expected-scenario input and output tokens from Calculations, including normal calls and extra attempts. Cached input is part of input usage, not an extra category; billable reasoning is included in output. Average daily tokens divide monthly totals by 30 planning days.",
        ),
        (
            "Category token costs",
            "Category costs splits Expected-scenario tokens into uncached input, cached reads, cache writes and output. Known costs sum the corresponding Calculations formulas. Blended USD/1M is derived from each token-type subtotal when pricing is complete; inspect Calculations for each model's selected rate. Incomplete rows omit unpriced agent lines from costs while retaining their token counts. Re-export after resolving pricing or limits.",
        ),
        (
            "Tier rates",
            "Rates in Calculations are selected using the exported per-call input size. After crossing a tier threshold, update the applicable rates from Pricing or re-export from the app.",
        ),
        (
            "Partial totals",
            "Incomplete rows have blank costs; summaries are known subtotals, not full budgets.",
        ),
        (
            "Annualization",
            "First year = 12 identical recurring months + one-time items. Additional monthly/one-time values in Summary are editable frozen inputs.",
        ),
        (
            "Scope",
            "Text tokens, including total billable reasoning in output. Cache writes use supplied rates. Tools, cache storage, multimodal charges require additional items/custom rates.",
        ),
        (
            "Scenarios",
            "Planning assumptions, not statistical confidence intervals. Execution fields in Calculations are scenario-effective values.",
        ),
        (
            "Detailed workflows",
            "Each step appears in Calculations and replaces the aggregate. The Agents sheet is an aggregate import template, not a lossless backup of detailed steps.",
        ),
        ("Version", f"Schema {estimate.schema_version}; defaults {estimate.defaults_version}"),
    ]:
        literal(notes, [key, value])
    return finish(wb)
