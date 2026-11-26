# Golden console tests

Requires a JDK with `java` and `javac` on PATH. Run from any directory:

```bat
tests\run_golden.bat
```

Or, in Bash (Git Bash on Windows):

```sh
bash tests/run_golden.sh
```

Each runner compiles the unchanged Java sources, feeds each input to `Main`,
and compares the entire standard output against the matching golden file.
A compilation error, program error, missing golden file, or output difference
returns a nonzero exit code. Build files and actual outputs stay under the
already ignored `bin/` directory. The runners never overwrite golden files.

The golden files preserve every Windows console output byte, including the
original line endings. `tests/.gitattributes` prevents Git from converting the
golden files' line endings. Use a Windows JDK for exact comparisons; a Unix JDK
normally prints LF line endings, which will be reported as differences.

`ready_tests.txt` contains only menu option `1`. It runs all six built-in cases.
The three custom inputs use this whitespace-separated format:

```text
2                         (menu: InputReader)
number_of_processes
arrival burst priority    (one triplet per process)
context_switch
quantum
3                         (algorithm: both SJF and ACS)
```

The labels above explain the fields; actual input files contain only integers.
InputReader assigns IDs `P1`, `P2`, and so on, and creates a `List<Process>`.

| Input | Coverage |
| --- | --- |
| `all_arrive_zero.txt` | Three processes arriving at time 0. |
| `idle_gap.txt` | A forced idle gap before arrivals at 10 and 11. |
| `tier2_context_switch.txt` | Four bursts longer than quantum 2, with context switch 1, so several processes enter Tier 2. |

These files freeze the current program output; they do not claim that its
scheduling decisions are correct.


## JSON API checks (Task 3)

Requires a JDK and Python 3 on PATH:

```bat
tests\api_check.bat
```

Alternatively, run `python tests/api_check.py` from any directory.
The script converts the three custom inputs to JSON and runs both ACS and
SJF (six requests). It compares every result and all four rounded averages
directly against the existing console golden files, checks event shape and
finish times, and exercises field order, arrival sorting, UTF-8, string
escaping, and invalid input/exit codes. Generated requests, responses, and
classes stay in ignored `bin/api-check/`; goldens are never rewritten.

After running the checks, invoke the API from PowerShell:

```powershell
Get-Content -Raw bin/api-check/inputs/tier2_context_switch-acs.json |
    java -cp bin/api-check/classes ApiMain
```

ApiMain reads exactly one UTF-8 JSON object through end-of-input, then prints
one JSON object. Required request fields are `algorithm` (ACS or SJF),
`quantum`, `contextSwitch`, and `processes`; each process requires string
`id` and integer `arrival`, `burst`, `priority`. Fields may appear in any order.
IDs must be unique and nonblank, arrivals/context switches nonnegative,
bursts positive, and quantum positive for ACS (nonnegative for SJF).
Priority accepts any 32-bit integer. Empty process lists, duplicate/unknown
fields, malformed JSON/UTF-8, noninteger numbers, and inputs whose conservative
time bound exceeds the scheduler's 32-bit clock return `{"error":"message"}`
with exit code 1.

Results follow Main's stable arrival ordering; averages use its exact
two-decimal rounding. CPU utilization is a percentage (0–100).
Events use the existing `docs/EVENT_SCHEMA.md` serialization; SJF retains its
documented shared-event scope. Main and the scheduling classes are unchanged.
