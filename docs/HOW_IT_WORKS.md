# How the scheduling program works

This guide describes the current Java program.
It also proposes a way to record events for a future UI.
No Java code was changed for this guide.

## 1. Input: from integers to process objects

`Main.main()` starts with a menu.
Option `1` runs six ready test cases.
Option `2` reads your own input through `InputReader.readProcesses()`.

For option `2`, enter integers in this order:

| Field | Meaning |
| --- | --- |
| `2` | Select custom input from the opening menu. |
| Process count | How many processes follow. |
| Arrival, burst, priority | One triplet for each process, in that order. |
| Context switch | Time needed to change between different running processes. |
| Quantum | Maximum execution time for a Tier 1 turn in ACS. |
| Algorithm | `1` = SJF, `2` = ACS, `3` = both. |

Arrival time says when a process becomes available.
Burst time is the total CPU time it needs.
In ACS Tier 2, a smaller priority number has higher priority.
Use non-negative arrival and context switch times.
Use positive burst times and a positive quantum.
Times are integer simulation units.

Here is a complete custom input:

```text
2
3
0 6 5
1 3 3
2 4 1
1
2
3
```

This creates three processes.
The context switch is `1` and the quantum is `2`.
Algorithm choice `3` runs both algorithms.
Spaces and newlines both separate integers.
You do not enter process IDs.

`InputReader.readProcesses()` assigns IDs `P1`, `P2`, and `P3`.
For the first triplet, it creates `new Process("P1", 0, 6, 5)`.
It returns an `ArrayList` through the type `List<Process>`.
`Main.runFromInput()` sorts that list by arrival time.

Each `Process` stores its ID, arrival time, burst time, and initial priority.
It also stores mutable simulation data.
Remaining time starts at the burst time.
Effective priority starts at the initial priority.
Waiting-since starts at the arrival time.
First-run and finish times start at `-1`.

`Main.copyAll()` calls `Process.copy()` before each algorithm runs.
These are fresh processes with reset simulation data.
They are not snapshots of an already running process.
The two algorithms therefore receive independent process objects.

## 2. Logic: what `run()` does

Think of a hospital with one doctor.
Patients are processes, and treatment time is burst time.
Tier 1 gives each patient a short first appointment.
Patients who need more treatment move to Tier 2.
The doctor then selects them by priority.
Preparing for another patient takes context switch time.
Aging improves the priority of patients waiting in Tier 2.

`Scheduler.run()` is abstract.
Each algorithm supplies its own implementation.
The numbered steps below describe `ACSScheduler.run()`.
`Main` also calls `SJF.run()`.
The SJF implementation is outside the six files inspected for this task.

An ACS scheduler starts at time `0` with busy time `0`.
Tier 1 is an empty FIFO queue.
Tier 2 is an empty list.
The input processes begin in `notArrived`.

1. **Check whether work remains.** Repeat while `allFinished()` is false.
   A process is finished when its remaining time is zero.
2. **Admit arrivals.** `addArrivalsToTier1()` moves every process whose
   arrival time is at most `currentTime` into Tier 1.
   It removes those processes from `notArrived`.
3. **Use Tier 1 if it has work.** Remove its first process.
   `runTier1()` calls `execute()` with the quantum.
   A process can consume less time if it finishes early.
   If it still has work, `demoteToTier2()` moves it to Tier 2.
   Its waiting-since time becomes the current time.
   It gets one Tier 1 turn before this demotion.
4. **Otherwise, use Tier 2 if it has work.** On the first Tier 2 execution
   of the simulation, `runTier2()` calls `applyAging()` before selection.
   `pickHighestPriority()` chooses the smallest effective priority.
   Equal priorities favor the earlier arrival time.
   If both values tie, the first matching entry in the Tier 2 list wins.
   Remove the selected process and execute all its remaining work.
   Call `applyAging()` afterward for processes still waiting in Tier 2.
5. **Otherwise, idle.** Both queues are empty.
   `nextArrivalTime()` finds the next future arrival.
   `idle()` advances the clock to that time.
6. **Record the queues.** `printQueues()` adds the Tier 1 and Tier 2 contents
   to the text timeline after each loop iteration.
   Then return to step 1.

`Scheduler.execute()` handles the actual execution interval.
First, it calls `switchTo()`.
A positive context switch is charged only when there was a previous process
and the next process is a different object.
The first execution has no context switch charge.
`idle()` clears the previous process, so execution after idle has no charge either.

Next, `execute()` records the first-run time if needed.
`Process.run()` consumes the smaller of the requested units and remaining time.
`execute()` records a run message and advances the clock.
It adds only the consumed execution units to busy time.
If the process finishes, it records its finish time and a finish message.

Arrivals are admitted at the start of loop iterations.
They do not interrupt an execution interval or a context switch.
A Tier 2 process runs to completion once selected.
An arrival message can therefore be logged later than its original arrival time.
The message includes that original arrival time.

Aging uses this formula:

```text
waited = currentTime - waitingSince
effectivePriority = max(0, initialPriority - (waited / 4))
```

Division is integer division.
The waiting-since time is set when the process enters Tier 2.
Aging is applied at the calls described in step 4.
It is not recalculated continuously or before every selection.
`applyAging()` records a message only when a priority changes.

## 3. Output: what is printed and where

| Output | Methods responsible |
| --- | --- |
| Opening menu and choice prompt | `Main.main()` |
| Process count and arrival/burst/priority prompts | `InputReader.readProcesses()` |
| Input confirmation, context switch, quantum, and algorithm prompts | `Main.runFromInput()` |
| Ready-test titles and separators | `Main.runTest()`, called by `runReadyTests()` |
| ACS and SJF headings | `Main.runACS()` and `Main.runSJF()` |
| Timeline grouped under `T=<time>:` headings | `Scheduler.printTimeline()` calls `Timeline.print()` |
| Per-process results and overall metrics | `Scheduler.printResults()` |

Despite its name, `Scheduler.printEvent()` does not immediately print.
It calls `Timeline.addEvent(currentTime, message)`.
That method appends a timestamp and a message to two lists.
`Timeline.print()` later prints them in insertion order.
It starts a new time heading when the timestamp changes.

The shared scheduler records execution, finish, context switch, and idle messages.
ACS also records arrivals, demotions, Tier 2 selections, aging, and queue contents.
Queue messages use `Process.toString()` to show IDs, remaining time, and priority.

`Scheduler.printResults()` prints one row per process.
The columns are ID, arrival, finish, turnaround, waiting, and response.
The values come from `Process` getters:

```text
turnaround = finish time - arrival time
waiting = turnaround - original burst time
response = first-run time - arrival time
```

It also prints average turnaround, waiting, and response times.
CPU utilization is `busyTime * 100.0 / currentTime`.
It is zero if the total time is zero.
Idle time and context switch time increase total time, but not busy time.
The printed averages and utilization are rounded to two decimal places.

Custom input with algorithm `3` prints SJF, then ACS.
Each ready test prints ACS, then SJF.
The helpers call `run()`, `printTimeline()`, and `printResults()` in that order.

## 4. Proposed UI flow

The current program uses console input and text output.
The following JSON path is a proposal.
`docs/EVENT_SCHEMA.md` does not exist yet.
Event names here are suggestions for the later schema.

1. The UI collects process inputs, context switch, quantum, and algorithm.
   It sends those values as JSON to a Java adapter.
2. The adapter creates fresh `Process` objects and sorts them by arrival time.
   It constructs the selected scheduler and calls `run()` once.
3. Recording hooks collect an ordered list of structured events during that run.
   Java also supplies the final metrics from the existing getters.
4. After the run finishes, the adapter returns the event list and results as JSON.
5. The UI replays those events as an animation.
   It displays the running process, queues, clock, and final metrics.
   Play, pause, and speed controls change playback only.

For algorithm choice `both`, Java runs each algorithm once on fresh process copies.
Each algorithm returns a separate event list.
Replaying an animation does not run Java again.

Useful events include arrival, dispatch, run, completion, idle, context switch,
demotion, aging, and queue snapshot.
Intervals need start and end times.
Queue snapshots need copied process values in their existing queue order.
Events with the same timestamp need a sequence number to preserve their order.
Arrival events should include both the original arrival time and the admission time.
The UI follows the logged admission time.
It does not move arrivals into a queue early or choose the next process.

## 5. Text diagram

```text
UI input form
    |
    | JSON: processes, context switch, quantum, algorithm
    v
Java input adapter
    |
    | Fresh List<Process>, sorted by arrival time
    v
Selected Java scheduler.run() -- called once per algorithm
    |
    | Recording hooks observe existing decisions
    v
Ordered event list + existing Java results
    |
    | JSON response after the simulation finishes
    v
UI event player
    |
    v
CPU animation + queue display + clock + results
```

## 6. Exact additive changes proposed for event recording

This section proposes recording only.
It does not implement the JSON adapter or change scheduling decisions.
Keep every existing statement and console message in place.
Add fields, new recording classes, read-only accessors, and hook calls.
The hooks must not print anything.

Add `SimulationEvent.java` for immutable event data.
Add `EventLog.java` for an append-only list and sequence numbers.
Each scheduler instance needs its own log.
Copy IDs and primitive getter values into events.
Do not retain mutable `Process` references in event snapshots.
Do not use `Process.copy()` for snapshots: it resets simulation data.

| Existing file and exact method | Additive recording change |
| --- | --- |
| `Scheduler.java`: fields and constructor | Add and initialize an `EventLog` for this scheduler instance. Add a new `getEvents()` accessor that returns an immutable view or copy. |
| `Scheduler.java`: `execute(Process, int)` | Capture the execution start after the existing `switchTo()` call. Record the consumed units, end time, and before/after remaining time around the existing execution. Record completion after the existing `markFinished()` call. |
| `Scheduler.java`: `switchTo(Process)` | Inside the existing context switch branch, record its start, end, previous ID, and next ID. Do not introduce another context switch condition or charge. |
| `Scheduler.java`: `idle(int)` | In the existing positive-duration path, record the idle start and end around the existing clock advance. |
| `Scheduler.java`: `printEvent(String)` (optional) | Mirror the existing timestamp and text into a `LOG` event. Keep the original `timeline.addEvent()` call. Typed events supply animation data; text messages need not be parsed. |
| `ACSScheduler.java`: `run()` | Add a start hook before the loop and an end hook after it. The end hook snapshots final process values and the existing metric getters. |
| `ACSScheduler.java`: `addArrivalsToTier1()` | After the existing queue insertion and removal from `notArrived`, record the admitted process, original arrival time, and current admission time. |
| `ACSScheduler.java`: `runTier1(Process)` | Before the existing `execute()` call, record the process already chosen by `run()` and its Tier 1 origin. Do not poll the queue again. |
| `ACSScheduler.java`: `demoteToTier2(Process)` | After the existing waiting-since update and Tier 2 insertion, record the demotion and resulting waiting-since value. |
| `ACSScheduler.java`: `runTier2()` | After the existing selection and removal, record the chosen process, effective priority, and Tier 2 origin. Use the existing local variable `p`. |
| `ACSScheduler.java`: `applyAging()` | Inside the existing priority-change branch, record `old` and `newPriority`. Do not add another aging call. |
| `ACSScheduler.java`: `printQueues()` | Add immutable snapshots of Tier 1 and Tier 2 in their existing order, at the current time. Keep the text event. |

`ACSScheduler.pickHighestPriority()` and `nextArrivalTime()` need no changes.
Observe the selected process in `runTier2()` instead of selecting again.
Recording code must not call `run()`, `execute()`, or `applyAging()` itself.
It must not change a process, queue, clock, quantum, or scheduling flag.

`Main.java` needs no recording changes in `main()`, `runFromInput()`,
`runReadyTests()`, `runTest()`, `runACS()`, `runSJF()`, or `copyAll()`.
The proposed adapter can read the new event accessor after its single run.
`InputReader.readProcesses()` needs no changes.
No `Process` method needs changes; its existing getters supply snapshot values.
`Timeline.addEvent()` and `Timeline.print()` need no changes.
The structured log can live beside the existing text timeline.

No edits to `SJF.java` or `SJF.run()` are proposed here.
The shared hooks record operations that use `Scheduler` helpers.
SJF-specific decision points have not been inspected in this task.

Before recording hooks are implemented later, review the event schema.
After implementation, the existing golden outputs must still match byte for byte.
This task adds this guide only; it adds no hooks or source code.
