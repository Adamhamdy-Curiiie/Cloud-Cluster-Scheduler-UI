#!/usr/bin/env python3
"""Compile ApiMain and compare both algorithms with the three console goldens."""
import copy
import json
import re
import subprocess
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "bin" / "api-check"
CASES = ("all_arrive_zero", "idle_gap", "tier2_context_switch")
RESULT_FIELDS = ("id", "arrival", "finish", "turnaround", "waiting", "response")
AVERAGE_LABELS = {
    "turnaround": "Average Turnaround Time",
    "waiting": "Average Waiting Time",
    "response": "Average Response Time",
    "cpuUtilization": "CPU Utilization",
}


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def request_from_console(name, algorithm):
    values = iter(map(int, (ROOT / "tests" / "inputs" / (name + ".txt")).read_text().split()))
    require(next(values) == 2, name + ": expected custom input mode")
    processes = [
        dict(zip(("id", "arrival", "burst", "priority"),
                 ("P" + str(i + 1), next(values), next(values), next(values))))
        for i in range(next(values))
    ]
    context_switch, quantum, selection = next(values), next(values), next(values)
    require(selection == 3 and next(values, None) is None, name + ": unexpected input format")
    return {"algorithm": algorithm, "quantum": quantum,
            "contextSwitch": context_switch, "processes": processes}


def golden_metrics(name, algorithm):
    text = (ROOT / "tests" / "golden" / (name + ".txt")).read_text()
    sections = re.findall(r"---------- " + algorithm + r" ----------\n(.*?)(?=\n---------- |\Z)",
                          text, re.S)
    require(len(sections) == 1, name + ": missing or duplicate golden section for " + algorithm)
    section = sections[0]
    rows = re.findall(r"^(P\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+)$",
                      section, re.M)
    require(bool(rows), name + ": no golden result rows")
    results = [dict(zip(RESULT_FIELDS, (row[0], *(int(value) for value in row[1:]))))
               for row in rows]
    averages = {}
    for key, label in AVERAGE_LABELS.items():
        matches = re.findall(r"^" + label + r": ([0-9.]+)%?$", section, re.M)
        require(len(matches) == 1, name + ": missing or duplicate golden " + label)
        averages[key] = Decimal(matches[0])
    return {"results": results, "averages": averages}


def run_api(payload, expected_code=0):
    data = payload if isinstance(payload, bytes) else payload.encode("utf-8")
    completed = subprocess.run(
        ["java", "-cp", str(BUILD / "classes"), "ApiMain"], input=data,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=ROOT, timeout=20)
    require(completed.returncode == expected_code,
            "ApiMain exit code " + str(completed.returncode) + ": "
            + completed.stderr.decode("utf-8", errors="replace"))
    require(not completed.stderr, "ApiMain wrote to stderr")
    output = completed.stdout.decode("utf-8")
    require(len(output.splitlines()) == 1, "ApiMain must print exactly one JSON line")
    result = json.loads(output, parse_float=Decimal)
    require(isinstance(result, dict), "ApiMain response must be an object")
    if expected_code:
        require(set(result) == {"error"} and isinstance(result["error"], str) and result["error"],
                "Bad input must produce only a nonempty error message")
    else:
        require(set(result) == {"events", "results", "averages"}, "Unexpected response fields")
    return result


def check_events(events, request, results):
    require(isinstance(events, list) and events, "Missing event array")
    ids = {process["id"] for process in request["processes"]}
    optional = {
        "ARRIVE": {"process"}, "RUN": {"process", "end"}, "FINISH": {"process"},
        "DEMOTE": {"process"}, "IDLE": {"end"}, "CONTEXT_SWITCH": {"from", "to", "end"},
    }
    finishes = {}
    previous_time = -1
    for index, event in enumerate(events):
        kind = event["type"]
        require(kind in optional, "Unknown event type")
        fields = {"type", "time", "snapshot"} | optional[kind]
        if request["algorithm"] == "ACS" and "process" in fields:
            fields.add("tier")
        require(set(event) == fields, "Event fields differ from EVENT_SCHEMA.md")
        require(type(event["time"]) is int and event["time"] >= previous_time,
                "Event timestamps must be nondecreasing integers")
        previous_time = event["time"]
        if "end" in event:
            require(type(event["end"]) is int and event["end"] > event["time"],
                    "Invalid event interval")
        if "process" in event:
            require(event["process"] in ids, "Unknown event process")
        if "from" in event:
            require(event["from"] in ids and event["to"] in ids, "Unknown switch endpoint")
        if "tier" in event:
            require(event["tier"] in (1, 2), "Invalid event tier")
        snapshot = event["snapshot"]
        require(set(snapshot) == {"tier1", "tier2", "notArrived", "finished", "running"},
                "Unexpected snapshot fields")
        for key in ("tier1", "notArrived", "finished"):
            require(isinstance(snapshot[key], list) and set(snapshot[key]) <= ids,
                    "Invalid snapshot ID array")
        require(isinstance(snapshot["tier2"], list), "tier2 must be an array")
        for entry in snapshot["tier2"]:
            require(set(entry) == {"id", "priority"} and entry["id"] in ids
                    and type(entry["priority"]) is int, "Invalid tier2 entry")
        require(snapshot["running"] == (event["process"] if kind == "RUN" else None),
                "Snapshot running process disagrees with event")
        if request["algorithm"] == "SJF":
            require(not snapshot["tier1"] and not snapshot["tier2"],
                    "SJF queue snapshots must be empty")
            require(kind in ("RUN", "CONTEXT_SWITCH", "FINISH"), "Unexpected SJF event")
        if kind == "FINISH":
            require(event["process"] not in finishes, "Duplicate FINISH")
            require(event["process"] in snapshot["finished"], "FINISH missing from snapshot")
            finishes[event["process"]] = event["time"]
        if kind == "RUN":
            following = events[index + 1] if index + 1 < len(events) else {}
            if following.get("type") == "FINISH":
                require(following["time"] == event["end"]
                        and following["process"] == event["process"], "RUN/FINISH mismatch")
    require(finishes == {row["id"]: row["finish"] for row in results},
            "Event finish times disagree with results")


def additional_checks():
    # Stable arrival sorting and arbitrary object field order, with JSON whitespace.
    request = request_from_console("idle_gap", "SJF")
    request["processes"].reverse()
    request = dict(reversed(list(request.items())))
    request["processes"] = [dict(reversed(list(process.items()))) for process in request["processes"]]
    actual = run_api(json.dumps(request, indent=2))
    expected = golden_metrics("idle_gap", "SJF")
    require(actual["results"] == expected["results"] and actual["averages"] == expected["averages"],
            "Unsorted input/field order changed golden metrics")

    base = {"algorithm": "ACS", "quantum": 2, "contextSwitch": 0,
            "processes": [{"id": "P1", "arrival": 0, "burst": 3, "priority": 1}]}
    for algorithm in ("ACS", "SJF"):
        for identifier in ('quote"slash\\/\b\f\n\r\t\x00\x1f', "مرحبا☃😀", "surrogate\ud800"):
            request = copy.deepcopy(base)
            request["algorithm"] = algorithm
            request["processes"][0]["id"] = identifier
            actual = run_api(json.dumps(request, ensure_ascii=True))
            require(actual["results"] == [
                {"id": identifier, "arrival": 0, "finish": 3,
                 "turnaround": 3, "waiting": 0, "response": 0}], "ID escaping lost data")
            check_events(actual["events"], request, actual["results"])
        request = copy.deepcopy(base)
        request["algorithm"] = algorithm
        request["processes"][0]["id"] = "مرحبا☃😀"
        actual = run_api(json.dumps(request, ensure_ascii=False))
        require(actual["results"][0]["id"] == request["processes"][0]["id"], "UTF-8 lost data")

    request = copy.deepcopy(base)
    request["algorithm"] = "SJF"
    request["quantum"] = 0
    request["processes"][0]["priority"] = -2147483648
    actual = run_api(json.dumps(request))
    require(actual["results"][0]["finish"] == 3, "SJF quantum zero/signed priority failed")

    invalid = ["", "{}", "[]", "null", json.dumps(base) + "{}",
               '{"algorithm":"ACS",}', '{"algorithm":"ACS","algorithm":"SJF"}',
               '{"algorithm":"ACS","processes":[{"id":"P1","id":"P2"}]}',
               '{"algorithm":"bad\\q"}', '{"algorithm":"bad\\u12xz"}',
               '{"algorithm":"bad\\u123"}', '{"algorithm":"bad\nid"}',
               '{"algorithm":"unterminated}', b"\xff"]
    for field in base:
        request = copy.deepcopy(base)
        del request[field]
        invalid.append(json.dumps(request))
    for field in base["processes"][0]:
        request = copy.deepcopy(base)
        del request["processes"][0][field]
        invalid.append(json.dumps(request))
    for field, value in (
        ("algorithm", "INVALID"), ("algorithm", None), ("quantum", 0), ("quantum", -1),
        ("quantum", 1.5), ("quantum", 1.0), ("quantum", True), ("contextSwitch", -1),
        ("contextSwitch", "0"), ("quantum", 2147483648), ("quantum", -2147483649),
        ("processes", []), ("processes", {}), ("processes", [None]), ("extra", 1),
    ):
        request = copy.deepcopy(base)
        request[field] = value
        invalid.append(json.dumps(request))
    for field, value in (
        ("id", ""), ("id", "   "), ("id", 1), ("arrival", -1), ("arrival", 2147483647),
        ("burst", 0), ("burst", -1), ("burst", None), ("priority", 1.5), ("extra", 1),
    ):
        request = copy.deepcopy(base)
        request["processes"][0][field] = value
        invalid.append(json.dumps(request))
    request = copy.deepcopy(base)
    request["processes"].append(copy.deepcopy(request["processes"][0]))
    invalid.append(json.dumps(request))
    invalid.extend((json.dumps(base).replace('"quantum": 2', '"quantum": 02'),
                    json.dumps(base).replace('"quantum": 2', '"quantum": 2e0'),
                    json.dumps(base).replace('"quantum": 2', '"quantum": +2'),
                    json.dumps(base).replace('"quantum": 2', '"quantum": 2.'),
                    json.dumps(base).replace('"id": "P1"', '"id": "bad\\\\"unknown"')))
    for payload in invalid:
        run_api(payload, expected_code=1)
    field = 'unexpected"\\\n'
    error = run_api(json.dumps({field: 0}), expected_code=1)
    require(field in error["error"], "Error JSON did not preserve escaped field name")
    print("PASS: ordering, UTF-8/string escaping, and " + str(len(invalid) + 1) + " bad inputs")


def main():
    classes = BUILD / "classes"
    classes.mkdir(parents=True, exist_ok=True)
    subprocess.run(["javac", "-encoding", "UTF-8", "-d", str(classes),
                    *(str(path) for path in sorted(ROOT.glob("*.java")))], cwd=ROOT, check=True)
    inputs = BUILD / "inputs"
    actuals = BUILD / "actual"
    inputs.mkdir(exist_ok=True)
    actuals.mkdir(exist_ok=True)
    for name in CASES:
        for algorithm in ("ACS", "SJF"):
            request = request_from_console(name, algorithm)
            payload = json.dumps(request, indent=2) + "\n"
            stem = name + "-" + algorithm.lower()
            (inputs / (stem + ".json")).write_text(payload, encoding="utf-8")
            actual = run_api(payload)
            (actuals / (stem + ".json")).write_text(
                json.dumps(actual, default=float, ensure_ascii=True) + "\n", encoding="utf-8")
            expected = golden_metrics(name, algorithm)
            for field in ("results", "averages"):
                require(actual[field] == expected[field],
                        stem + ": " + field + " differ\nactual: " + str(actual[field])
                        + "\ngolden: " + str(expected[field]))
            check_events(actual["events"], request, actual["results"])
            print("PASS: " + stem + " results/averages match golden exactly")
    additional_checks()
    print("All API checks passed (3 inputs x 2 algorithms).")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError, subprocess.SubprocessError) as error:
        print("FAIL: " + str(error), file=sys.stderr)
        sys.exit(1)
