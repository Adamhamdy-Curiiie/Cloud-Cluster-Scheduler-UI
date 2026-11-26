# Structured scheduler events

Each event has exactly these fields; optional fields are omitted when inapplicable:

```json
{
  "type": "RUN",
  "time": 3,
  "end": 5,
  "process": "P2",
  "tier": 1,
  "snapshot": {
    "tier1": ["P3"],
    "tier2": [{"id": "P1", "priority": 4}],
    "notArrived": ["P4"],
    "finished": [],
    "running": "P2"
  }
}
```

| Field | Value |
| --- | --- |
| `type` | One of `ARRIVE`, `RUN`, `CONTEXT_SWITCH`, `DEMOTE`, `IDLE`, `FINISH`. |
| `time` | Integer simulation time when the recorded action begins or occurs. |
| `end` | Optional integer; present for RUN, CONTEXT_SWITCH and IDLE intervals. |
| `process` | Optional string process ID; present for ARRIVE, RUN, DEMOTE and FINISH. |
| `from`, `to` | String process IDs, present only for CONTEXT_SWITCH (previous and next process). |
| `tier` | Optional integer 1 or 2; present on ACS process events. DEMOTE uses destination tier 2. |
| `snapshot` | Required object with all five fields below. |

Snapshots contain `tier1` (IDs in FIFO queue order), `tier2` (objects with
exactly `id` and current integer `priority`, in the scheduler's list order),
`notArrived` (IDs in the scheduler's pending-list order), `finished` (IDs
whose finish time has been marked, in input-list order), and `running`
(the current execution slice's ID, otherwise JSON null). Empty collections
are arrays, never null. Tier 2 is not sorted for display: selection and aging
remain entirely in the scheduler.

| Type | Meaning and snapshot timing |
| --- | --- |
| ARRIVE | Recorded after ACS enqueues the process in Tier 1 and removes it from notArrived. |
| RUN | `time` is the start after any context-switch cost; `end` is the start plus actual units consumed. Snapshot describes the start of the slice, with the selected process removed from its queue and `running` set to its ID. |
| CONTEXT_SWITCH | Recorded only when the existing scheduler charges a positive switching cost. `time`/`end` bracket that interval; `from` and `to` identify its endpoints. The next process has already been removed from its queue; `running` is null. |
| DEMOTE | Recorded after adding the process to Tier 2; `running` is null. |
| IDLE | `time`/`end` bracket the existing idle interval; `running` is null. |
| FINISH | Recorded at the execution end, after marking the process finished; it appears in `finished` and `running` is null. |

Events remain in hook-call order, with nondecreasing start timestamps.
Intervals use [time, end); zero-cost switches do not produce events.
ARRIVE uses the time of actual queue admission, which can be later than the
input arrival time when the frozen scheduler checks arrivals after a slice.
A completed RUN is immediately followed by FINISH at its end; an unfinished
ACS Tier 1 RUN is followed by DEMOTE. Aging has no separate event type;
subsequent snapshots capture the priorities in effect at their recording points.
Snapshots are detached immutable copies, so later aging cannot rewrite history.

## Java access and scope

After `scheduler.run()`, call `scheduler.getEventLog().getEvents()` for an
immutable list of Event objects, `size()` for the count, or `toJson()` for a
JSON array. Event, Snapshot and Tier2Entry expose getters. Serialization uses
only the Java standard library, omits unused optional fields, and escapes
quotes, backslashes, control characters and UTF-16 surrogates.

ACS records all six event types through the shared execution/switch/idle hooks
and its arrival/demotion hooks. SJF receives RUN, CONTEXT_SWITCH and FINISH
from Scheduler. Its own arrival and idle loop and private heap are unchanged:
its snapshots have empty tier1/tier2 arrays, omit tier, and list notArrived
by input arrival time greater than the snapshot time. No SJF queue order is
inferred or simulated here.

## Verification

From the project root on Windows:

```bat
tests\run_golden.bat
java -cp bin\golden-bat\classes tests\EventLogTest.java
```

The second command uses input (c), `tests/inputs/tier2_context_switch.txt`,
prints its event count and sequence, and checks interval/queue/finish/priority
snapshots, other golden input scenarios, JSON escaping, and SJF shared hooks.
It also writes the debug log to the ignored `bin/golden-bat/events-c.json`.
