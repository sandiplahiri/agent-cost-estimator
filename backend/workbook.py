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
    "agent_id",
    "business_use_case_description",
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
    literal(
        ws,
        [
            "Document classification",
            "simple",
            1,
            0,
            *([""] * 7),
            "daily_users",
            1,
            1,
            "",
            "Classifies incoming documents",
        ],
    )
    notes = wb.create_sheet("Instructions")
    literal(notes, ["Field", "Meaning"])
    for key, value in [
        (
            "Required",
            "New rows: name, complexity, count, volume_source=daily_users, users_per_day, and invocations_per_user_per_agent_per_day. Zero is valid; blanks are missing. Supply business_use_case_description when known; blanks are labeled pending definition.",
        ),
        (
            "Agent identity",
            "A count-one row may provide agent_id; otherwise a unique ID is generated. Counted groups generate one named, identified member per agent. Edit individual identities in the app. A missing description is labeled pending definition.",
        ),
        ("model_id", "Exact catalog or custom model ID for this agent. Blank leaves pricing incomplete."),
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
            "Each row is a disjoint direct-volume group. This import replaces the current agent list and its links after preview. Derived links must be rebuilt in the app.",
        ),
        (
            "Complexity",
            "Use simple, medium, high, or a custom complexity category already attached to the current estimate. Categories classify token consumption, not business use cases.",
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
            if source == "derived":
                errors.append(
                    f"Row {index}, volume_source: derived agent links cannot be imported from Agents. Import direct-volume rows, then add links in the app."
                )
                continue
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
            agent_id = values.pop("agent_id", None)
            business_description = values.pop("business_use_case_description", None)
            if agent_id and values.get("count") != 1:
                errors.append(f"Row {index}, agent_id: provide an ID only when count is 1.")
                continue
            if business_description:
                values["use_case_description"] = business_description
            if agent_id:
                values["members"] = [
                    {
                        "id": str(agent_id),
                        "name": str(values["name"]),
                        "business_use_case_description": business_description
                        or "Business use case pending description",
                    }
                ]
            try:
                agents.append(AgentRow(**values, overrides=overrides).model_dump(mode="json"))
            except ValidationError as exc:
                errors.extend(
                    f"Row {index}, {'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()
                )
        if not agents and not errors:
            errors.append("No agent rows found.")
        member_ids = [member["id"] for row in agents for member in row["members"]]
        member_names = [member["name"].strip().casefold() for row in agents for member in row["members"]]
        if len(member_ids) != len(set(member_ids)):
            errors.append("Agent IDs must be unique across imported rows.")
        if len(member_names) != len(set(member_names)):
            errors.append("Agent names must be unique across imported rows.")
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
            "Tool monthly USD",
            "Harness monthly USD",
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
        "Raw calls/occurrence after scenario",
        "Step x model probability",
        "Step ID",
        "Model role",
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
                    float(line["raw_calls_per_invocation"]),
                    float(line["execution_probability"]),
                    line["step_id"],
                    line["role"],
                ],
            )
            r = calc.max_row
            formulas = {
                "G": f"AJ{r}*AK{r}",
                "Q": f"E{r}*F{r}*G{r}*(1+H{r})",
                "R": f"Q{r}*I{r}",
                "S": f"Q{r}*J{r}",
                "AG": f"R{r}*(1-K{r}-L{r})",
                "AH": f"R{r}*K{r}",
                "AI": f"R{r}*L{r}",
            }
            if line["volume_source"] == "derived":
                # Graph propagation is calculated in the app; its effective result is frozen here.
                calc[f"F{r}"] = float(line["invocations"])
            else:
                formulas["F"] = f'IF(Z{r}="daily_users",AA{r}*AB{r}*AC{r},AD{r})*AE{r}'
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
                None,
                None,
            ],
        )
        r = summary.max_row
        summary[f"B{r}"] = f"=SUM(Calculations!X{start}:X{end})" if end >= start else "=0"
        summary[f"D{r}"] = f"=B{r}+C{r}+I{r}+J{r}"
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
                row.members[0].id if row.count == 1 else "",
                row.members[0].business_use_case_description if row.count == 1 else "",
            ],
        )
    identities = wb.create_sheet("Agent identities")
    literal(identities, ["Group ID", "Group name", "Agent ID", "Agent name", "Business use case description"])
    for row in estimate.agents:
        for member in row.members:
            literal(
                identities, [row.id, row.name, member.id, member.name, member.business_use_case_description]
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
            "Agent row ID",
            "Previous direct volume source",
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
                row.id,
                row.prior_volume_source,
            ],
        )
        r = volume.max_row
        if row.volume_source == "derived":
            volume[f"I{r}"] = float(result["base_volumes"][row.id]["per_agent"])
        else:
            volume[f"I{r}"] = f'=IF(D{r}="daily_users",E{r}*F{r}*G{r},H{r})'
        volume[f"J{r}"] = f"=C{r}*I{r}"
    links = wb.create_sheet("Agent links")
    literal(
        links,
        [
            "Scenario",
            "Parent agent/group",
            "Child agent/group",
            "Branch group",
            "Trigger probability",
            "Child invocations per trigger",
            "Parent invocations/month (precomputed)",
            "Child invocations/month",
            "Status",
            "Link ID",
            "Parent row ID",
            "Child row ID",
            "Step execution probability",
        ],
    )
    row_names = {row.id: row.name for row in estimate.agents}
    for scenario in result["scenarios"]:
        for link in estimate.links:
            contribution = scenario["link_contributions"][link.id]
            literal(
                links,
                [
                    scenario["name"],
                    row_names[link.parent_id],
                    row_names[link.child_id],
                    link.branch_group,
                    float(contribution["trigger_probability"]),
                    float(contribution["invocations_per_trigger"]),
                    float(contribution["parent_total"]),
                    None,
                    "Complete" if contribution["complete"] else "INCOMPLETE — parent volume",
                    link.id,
                    link.parent_id,
                    link.child_id,
                    float(contribution["step_probability"]),
                ],
            )
            r = links.max_row
            links[f"H{r}"] = f"=E{r}*F{r}*G{r}*M{r}"
    tools = wb.create_sheet("Tool costs")
    literal(
        tools,
        [
            "Scenario",
            "Agent",
            "Tool",
            "Monthly invocations",
            "Step probability",
            "Tool probability",
            "Units/invocation",
            "USD/unit",
            "Monthly USD",
            "Step ID",
        ],
    )
    harness = wb.create_sheet("Harness")
    literal(
        harness,
        [
            "Scenario",
            "Harness type",
            "Name",
            "Fixed USD/month",
            "Invocations/month",
            "USD/invocation",
            "Step executions/month",
            "USD/step",
            "Monthly USD",
            "Allocation",
            "Include in use-case cost",
        ],
    )
    for scenario in result["scenarios"]:
        for item in scenario["tool_lines"]:
            literal(
                tools,
                [
                    scenario["name"],
                    item["agent"],
                    item["name"],
                    float(scenario["volumes"][item["row_id"]]["total"]),
                    float(item["step_probability"]),
                    float(item["probability"]),
                    float(item["expected_units_per_invocation"]),
                    float(item["unit_cost"]),
                    None,
                    item["step_id"],
                ],
            )
            r = tools.max_row
            tools[f"I{r}"] = f"=D{r}*E{r}*F{r}*G{r}*H{r}"
        literal(
            harness,
            [
                scenario["name"],
                estimate.harness.harness_type,
                estimate.harness.name,
                float(estimate.harness.fixed_monthly),
                float(scenario["harness_drivers"]["invocations"]),
                float(estimate.harness.per_invocation),
                float(scenario["harness_drivers"]["step_executions"]),
                float(estimate.harness.per_step_execution),
                None,
                estimate.harness.allocation,
                estimate.harness.include_in_cost_per_use_case,
            ],
        )
        r = harness.max_row
        harness[f"I{r}"] = f'=IF(B{r}="none",0,D{r}+E{r}*F{r}+G{r}*H{r})'
        summary_row = ["Low", "Expected", "High"].index(scenario["name"]) + 2
        summary[f"I{summary_row}"] = (
            f"=SUMIF('Tool costs'!A2:A{tools.max_row},A{summary_row},'Tool costs'!I2:I{tools.max_row})"
            if tools.max_row >= 2
            else "=0"
        )
        summary[f"J{summary_row}"] = f"=Harness!I{r}"
    use_cases = wb.create_sheet("Use cases")
    literal(
        use_cases,
        [
            "Scenario",
            "Agent",
            "Use case",
            "Monthly completions",
            "Direct USD/completion",
            "Harness USD/completion",
            "Loaded USD/completion",
            "Status",
            "Calculation path",
        ],
    )
    for scenario in result["scenarios"]:
        for row in estimate.agents:
            item = scenario["use_case_costs"][row.id]
            literal(
                use_cases,
                [
                    scenario["name"],
                    row.name,
                    item["name"],
                    float(item["monthly_invocations"]),
                    float(item["direct_cost_per_completion"]),
                    float(item["harness_per_completion"]),
                    float(item["loaded_cost_per_completion"]),
                    "Complete" if item["complete"] else "INCOMPLETE — known costs only",
                    "Precomputed DAG rollup; inputs and direct calculations in other sheets",
                ],
            )
    categories = wb.create_sheet("Category totals")
    literal(categories, ["Complexity", "Total monthly invocations all agents"])
    last_volume_row = volume.max_row
    for complexity in estimate.profiles:
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
    for complexity in estimate.profiles:
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
            "Average tokens/day",
            "Known cost USD/day",
            "Planning days/month",
        ],
    )
    for complexity in estimate.profiles:
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
            literal(
                category_costs,
                [
                    complexity,
                    token_type,
                    None,
                    None,
                    None,
                    status,
                    None,
                    None,
                    float(PLANNING_DAYS_PER_MONTH),
                ],
            )
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
            category_costs[f"G{r}"] = f"=C{r}/I{r}"
            category_costs[f"H{r}"] = f"=D{r}/I{r}"
        last = category_costs.max_row
        literal(
            category_costs,
            [complexity, "Total", None, None, None, status, None, None, float(PLANNING_DAYS_PER_MONTH)],
        )
        r = category_costs.max_row
        category_costs[f"C{r}"] = f"=SUM(C{first}:C{last})"
        category_costs[f"D{r}"] = f"=SUM(D{first}:D{last})"
        category_costs[f"G{r}"] = f"=C{r}/I{r}"
        category_costs[f"H{r}"] = f"=D{r}/I{r}"
    scenario_summary = wb.create_sheet("Monthly scenario summary")
    literal(
        scenario_summary,
        [
            "Scenario",
            "Input tokens/month",
            "Input cost USD/month",
            "Output tokens/month",
            "Output cost USD/month",
            "Total tokens/month",
            "Total token cost USD/month",
            "Harness cost USD/month",
            "Other costs USD/month",
            "Total cost USD/month",
            "Status",
        ],
    )
    for scenario in result["scenarios"]:
        status = (
            "Complete"
            if scenario["complete"] and scenario["harness_complete"] and scenario["other_complete"]
            else "INCOMPLETE — known costs only"
        )
        literal(
            scenario_summary,
            [scenario["name"], None, None, None, None, None, None, None, None, None, status],
        )
        r = scenario_summary.max_row

        def scenario_sum(source):
            return (
                f"SUMIFS(Calculations!{source}2:{source}{last_calc_row},"
                f"Calculations!A2:A{last_calc_row},A{r})"
                if last_calc_row >= 2
                else "0"
            )

        scenario_summary[f"B{r}"] = "=" + scenario_sum("R")
        scenario_summary[f"C{r}"] = "=" + "+".join(scenario_sum(col) for col in ("T", "V", "W"))
        scenario_summary[f"D{r}"] = "=" + scenario_sum("S")
        scenario_summary[f"E{r}"] = "=" + scenario_sum("U")
        scenario_summary[f"F{r}"] = f"=B{r}+D{r}"
        scenario_summary[f"G{r}"] = f"=C{r}+E{r}"
        last_summary_row = summary.max_row
        scenario_summary[f"H{r}"] = (
            f"=SUMIF(Summary!A2:A{last_summary_row},A{r},Summary!J2:J{last_summary_row})"
        )
        scenario_summary[f"I{r}"] = (
            f"=SUMIF(Summary!A2:A{last_summary_row},A{r},Summary!C2:C{last_summary_row})"
            f"+SUMIF(Summary!A2:A{last_summary_row},A{r},Summary!I2:I{last_summary_row})"
        )
        scenario_summary[f"J{r}"] = (
            f"=SUMIF(Summary!A2:A{last_summary_row},A{r},Summary!D2:D{last_summary_row})"
        )
    monthly_summary = wb.create_sheet("Monthly category summary")
    literal(
        monthly_summary,
        [
            "Complexity",
            "Input tokens/month",
            "Known input USD/month",
            "Output tokens/month",
            "Known output USD/month",
            "Total tokens/month",
            "Known LLM USD/month",
            "Status",
        ],
    )
    for index, complexity in enumerate(estimate.profiles):
        category_row = index + 2
        first_cost_row = index * 5 + 2
        status = (
            "Complete"
            if result["category_costs"][complexity]["complete"]
            else "INCOMPLETE — known costs only"
        )
        literal(monthly_summary, [complexity, None, None, None, None, None, None, status])
        r = monthly_summary.max_row
        monthly_summary[f"B{r}"] = f"='Category usage'!B{category_row}"
        monthly_summary[f"C{r}"] = f"=SUM('Category costs'!D{first_cost_row}:D{first_cost_row + 2})"
        monthly_summary[f"D{r}"] = f"='Category usage'!C{category_row}"
        monthly_summary[f"E{r}"] = f"='Category costs'!D{first_cost_row + 3}"
        monthly_summary[f"F{r}"] = f"=B{r}+D{r}"
        monthly_summary[f"G{r}"] = f"=C{r}+E{r}"
    status = "Complete" if result["monthly_token_summary"]["complete"] else "INCOMPLETE — known costs only"
    literal(monthly_summary, ["Suite total", None, None, None, None, None, None, status])
    r = monthly_summary.max_row
    for column in ("B", "C", "D", "E"):
        monthly_summary[f"{column}{r}"] = f"=SUM({column}2:{column}{r - 1})"
    monthly_summary[f"F{r}"] = f"=B{r}+D{r}"
    monthly_summary[f"G{r}"] = f"=C{r}+E{r}"
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
            "Input original currency/M",
            "Output original currency/M",
            "Cache read original currency/M",
            "Cache write original currency/M",
            "Source",
            "Retrieved at",
            "Custom",
            "Tier details",
            "Unsupported",
            "Source type",
            "Channel",
            "Region",
            "Original currency",
            "USD per currency unit",
            "FX source",
            "FX retrieval date",
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
                p.source_type,
                p.channel,
                p.region,
                p.currency,
                float(p.fx_to_usd),
                p.fx_source,
                p.fx_retrieved_at,
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
            "Edit numeric inputs in Calculations to recalculate costs. For direct-volume rows, column F derives scenario monthly volume from columns Z–AE using a 30-day planning month. For derived rows, column F is the graph result precomputed by the app; edit links or upstream volume in the app and re-export. Profiles, Scenarios, Agents and Pricing document the snapshot; editing those sheets does not propagate to Calculations.",
        ),
        (
            "Volume and category totals",
            "Volume derives direct baseline invocations and records app-precomputed derived invocations. Category totals sums the Volume sheet by complexity. These totals exclude scenario volume multipliers; Calculations contains scenario-effective volumes.",
        ),
        (
            "Agent links",
            "Agent links shows effective Low/Expected/High probability, fanout, and child contributions. Parent totals are precomputed in topological order by the app; changing edges or parent totals in this workbook does not update derived rows in Calculations or Volume. Re-export from the app for a revised graph. Derived rows in Agents cannot be reimported without rebuilding links in the app.",
        ),
        (
            "Category token usage",
            "Category usage sums Expected-scenario input and output tokens from Calculations, including normal calls and extra attempts. Cached input is part of input usage, not an extra category; billable reasoning is included in output. Average daily tokens divide monthly totals by 30 planning days.",
        ),
        (
            "Category token costs",
            "Category costs splits Expected-scenario tokens into uncached input, cached reads, cache writes and output. Known monthly costs sum the corresponding Calculations formulas; average daily tokens and costs divide monthly values by 30 planning days. Blended USD/1M is derived from each token-type subtotal when pricing is complete; inspect Calculations for each model's selected rate. Incomplete rows omit unpriced agent lines from costs while retaining their token counts. Re-export after resolving pricing or limits.",
        ),
        (
            "Monthly category summary",
            "Monthly category summary combines Category usage input/output token counts with Category costs. Input cost includes uncached input, cached reads, and cache writes; output includes billable reasoning. The suite row sums category values and reconciles to the Expected LLM amount in Summary. Incomplete values include only fully priced agent lines.",
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
            "Text tokens, including total billable reasoning in output. Cache writes use supplied rates. Per-agent tool rows and the simple suite harness are separate. Cache storage, multimodal charges, and advanced platform billing require additional items/custom rates.",
        ),
        (
            "Scenarios",
            "Planning assumptions, not statistical confidence intervals. Execution fields in Calculations are scenario-effective values.",
        ),
        (
            "Detailed workflows",
            "Each model row appears in Calculations and replaces the aggregate. Column G is raw calls in AJ multiplied by step x model probability in AK; edit AJ/AK to recalculate. The Agents sheet is an aggregate import template, not a lossless backup of detailed steps.",
        ),
        (
            "Tools, harness, and use cases",
            "Tool costs and Harness feed the Summary recurring total through formulas. Use cases stores the precomputed fully loaded DAG cost per completion; edit the graph in the app and re-export. A fixed harness charge stays in the suite total even at zero workload.",
        ),
        (
            "Original currency and FX",
            "Pricing records original-currency rates and the user-supplied USD conversion snapshot. Calculations stores the selected effective USD rates; changing FX in Pricing does not update Calculations until re-export.",
        ),
        ("Version", f"Schema {estimate.schema_version}; defaults {estimate.defaults_version}"),
    ]:
        literal(notes, [key, value])
    return finish(wb)
