import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Scanner;
import java.util.Set;

/** Standalone event checks; never changes Main or the golden console output. */
public class EventLogTest {
    private static final class Input {
        final List<Process> processes = new ArrayList<>();
        int contextSwitch;
        int quantum;
    }

    public static void main(String[] args) throws Exception {
        Input inputC = readInput("tests/inputs/tier2_context_switch.txt");
        ACSScheduler acs = runACS(inputC);
        checkACS(acs.getEventLog(), inputC);
        List<Event> events = acs.getEventLog().getEvents();
        require(events.size() == 26, "input (c) should record 26 events");

        Map<Event.Type, Integer> counts = new EnumMap<>(Event.Type.class);
        StringBuilder sequence = new StringBuilder();
        for (Event event : events) {
            counts.put(event.getType(), counts.getOrDefault(event.getType(), 0) + 1);
            if (sequence.length() > 0) sequence.append(" -> ");
            sequence.append(event.getType()).append('@').append(event.getTime());
            if (event.getProcess() != null) sequence.append('(').append(event.getProcess()).append(')');
        }
        System.out.println("Input (c): " + events.size() + " events " + counts);
        System.out.println(sequence);
        Files.write(Paths.get("bin/golden-bat/events-c.json"),
                acs.getEventLog().toJson().getBytes(StandardCharsets.UTF_8));

        // Historical priorities stay frozen after later aging.
        Event firstDemotion = first(events, Event.Type.DEMOTE, "P1");
        require(firstDemotion.getSnapshot().getTier2().get(0).getPriority() == 4,
                "first demotion priority must remain 4");
        Event tier2Run = null;
        for (Event event : events) {
            if (event.getType() == Event.Type.RUN && Integer.valueOf(2).equals(event.getTier())) {
                tier2Run = event;
                break;
            }
        }
        require(tier2Run != null && "P4".equals(tier2Run.getProcess()), "first Tier 2 run should be P4");
        require(tier2Run.getSnapshot().getTier2().get(0).getPriority() == 2,
                "Tier 2 snapshot should expose effective aged priority");

        for (String name : Arrays.asList("all_arrive_zero", "idle_gap")) {
            Input input = readInput("tests/inputs/" + name + ".txt");
            ACSScheduler scheduler = runACS(input);
            checkACS(scheduler.getEventLog(), input);
            if ("idle_gap".equals(name)) {
                Event idle = first(scheduler.getEventLog().getEvents(), Event.Type.IDLE, null);
                require(idle.getTime() == 2 && idle.getEnd() == 10, "idle interval should be [2,10)");
                require(idle.getSnapshot().getNotArrived().equals(Arrays.asList("P2", "P3")),
                        "idle snapshot must preserve pending arrival order");
            }
        }

        // Admissions during a slice/switch are recorded at the frozen scheduler's check time.
        Input delayed = new Input();
        delayed.contextSwitch = 2;
        delayed.quantum = 2;
        delayed.processes.add(new Process("A", 5, 5, 4));
        delayed.processes.add(new Process("B", 6, 3, 2));
        delayed.processes.add(new Process("C", 8, 1, 1));
        ACSScheduler delayedACS = runACS(delayed);
        checkACS(delayedACS.getEventLog(), delayed);
        require(first(delayedACS.getEventLog().getEvents(), Event.Type.IDLE, null).getEnd() == 5,
                "initial idle should end at first arrival");
        require(first(delayedACS.getEventLog().getEvents(), Event.Type.ARRIVE, "B").getTime() == 7,
                "B admission should occur after A's slice");
        require(first(delayedACS.getEventLog().getEvents(), Event.Type.ARRIVE, "C").getTime() == 11,
                "C admission should occur after switch and B's slice");

        List<Process> sjfInput = copies(inputC.processes);
        SJF sjf = new SJF(sjfInput, inputC.contextSwitch);
        sjf.run();
        int sjfFinished = 0;
        Map<String, Integer> sjfUnits = new HashMap<>();
        for (Event event : sjf.getEventLog().getEvents()) {
            require(event.getTier() == null, "SJF must omit tier");
            require(event.getSnapshot().getTier1().isEmpty()
                    && event.getSnapshot().getTier2().isEmpty(), "SJF must not invent ACS queues");
            if (event.getType() == Event.Type.RUN) {
                require(event.getEnd() - event.getTime() == 1, "SJF slice should be one unit");
                sjfUnits.put(event.getProcess(), sjfUnits.getOrDefault(event.getProcess(), 0) + 1);
            } else if (event.getType() == Event.Type.FINISH) {
                sjfFinished++;
            } else {
                require(event.getType() == Event.Type.CONTEXT_SWITCH, "unexpected SJF shared event");
            }
        }
        require(sjfFinished == inputC.processes.size(), "SJF finish count");
        for (Process p : sjfInput) require(sjfUnits.get(p.getId()) == p.getBurstTime(), "SJF run total");

        checkImmutabilityAndJson();
        System.out.println("All event log checks passed.");
    }

    private static Input readInput(String path) throws Exception {
        Input input = new Input();
        try (Scanner scanner = new Scanner(Paths.get(path))) {
            require(scanner.nextInt() == 2, "expected custom input menu option");
            int n = scanner.nextInt();
            for (int i = 1; i <= n; i++) {
                input.processes.add(new Process("P" + i, scanner.nextInt(), scanner.nextInt(), scanner.nextInt()));
            }
            input.contextSwitch = scanner.nextInt();
            input.quantum = scanner.nextInt();
            scanner.nextInt(); // Original algorithm menu option.
        }
        input.processes.sort((a, b) -> a.getArrivalTime() - b.getArrivalTime());
        return input;
    }

    private static List<Process> copies(List<Process> input) {
        List<Process> copies = new ArrayList<>();
        for (Process p : input) copies.add(p.copy());
        return copies;
    }

    private static ACSScheduler runACS(Input input) {
        ACSScheduler scheduler = new ACSScheduler(copies(input.processes), input.contextSwitch, input.quantum);
        scheduler.run();
        return scheduler;
    }

    private static void checkACS(EventLog log, Input input) {
        Map<String, List<Event.Type>> histories = new HashMap<>();
        Map<String, Integer> units = new HashMap<>();
        Set<String> finished = new HashSet<>();
        List<String> pending = new ArrayList<>();
        for (Process p : input.processes) {
            histories.put(p.getId(), new ArrayList<>());
            pending.add(p.getId());
        }
        int previousTime = -1;
        int intervalEnd = 0;
        for (Event event : log.getEvents()) {
            require(event.getTime() >= previousTime && event.getTime() >= intervalEnd, "event time order");
            previousTime = event.getTime();
            Event.Snapshot snapshot = event.getSnapshot();
            if (event.getProcess() != null) histories.get(event.getProcess()).add(event.getType());
            switch (event.getType()) {
                case ARRIVE:
                    require(event.getTier() == 1, "arrival tier");
                    pending.remove(event.getProcess());
                    require(snapshot.getTier1().contains(event.getProcess()), "arrival must be in Tier 1");
                    break;
                case RUN:
                    require(event.getProcess().equals(snapshot.getRunning()), "RUN running ID");
                    units.put(event.getProcess(), units.getOrDefault(event.getProcess(), 0)
                            + event.getEnd() - event.getTime());
                    break;
                case DEMOTE:
                    require(event.getTier() == 2, "demotion tier");
                    require(snapshot.getTier2().get(snapshot.getTier2().size() - 1).getId()
                            .equals(event.getProcess()), "demotion must append to Tier 2");
                    break;
                case FINISH:
                    require(finished.add(event.getProcess()), "duplicate finish");
                    break;
                case CONTEXT_SWITCH:
                    require(event.getEnd() - event.getTime() == input.contextSwitch, "switch duration");
                    require(event.getFrom() != null && event.getTo() != null
                            && !event.getFrom().equals(event.getTo()), "switch IDs");
                    break;
                case IDLE:
                    break;
            }
            require(snapshot.getNotArrived().equals(pending), "pending-list snapshot order");
            List<String> expectedFinished = new ArrayList<>();
            for (Process p : input.processes) if (finished.contains(p.getId())) expectedFinished.add(p.getId());
            require(snapshot.getFinished().equals(expectedFinished), "finished snapshot order");
            if (event.getType() != Event.Type.RUN) require(snapshot.getRunning() == null, "non-RUN running");
            boolean interval = event.getType() == Event.Type.RUN
                    || event.getType() == Event.Type.CONTEXT_SWITCH || event.getType() == Event.Type.IDLE;
            require((event.getEnd() != null) == interval, "optional end field");
            if (interval) {
                require(event.getEnd() > event.getTime(), "positive interval length");
                intervalEnd = event.getEnd();
            }
            Set<String> partition = new HashSet<>();
            for (String id : snapshot.getTier1()) require(partition.add(id), "duplicate Tier 1 ID");
            for (Event.Tier2Entry entry : snapshot.getTier2()) require(partition.add(entry.getId()), "duplicate Tier 2 ID");
            for (String id : snapshot.getNotArrived()) require(partition.add(id), "duplicate pending ID");
            for (String id : snapshot.getFinished()) require(partition.add(id), "duplicate finished ID");
            if (snapshot.getRunning() != null) require(partition.add(snapshot.getRunning()), "running still queued");
            if (event.getType() == Event.Type.CONTEXT_SWITCH) require(partition.add(event.getTo()), "switch target still queued");
            require(partition.equals(histories.keySet()), "snapshot must account for every process");
            String json = event.toJson();
            require(json.contains("\"snapshot\":{"), "required snapshot serialization");
            require(json.contains("\"from\":") == (event.getType() == Event.Type.CONTEXT_SWITCH),
                    "from only on context switches");
        }
        for (Process p : input.processes) {
            List<Event.Type> expected = p.getBurstTime() > input.quantum
                    ? Arrays.asList(Event.Type.ARRIVE, Event.Type.RUN, Event.Type.DEMOTE, Event.Type.RUN, Event.Type.FINISH)
                    : Arrays.asList(Event.Type.ARRIVE, Event.Type.RUN, Event.Type.FINISH);
            require(histories.get(p.getId()).equals(expected), "per-process lifecycle for " + p.getId());
            require(units.get(p.getId()) == p.getBurstTime(), "RUN intervals must total burst for " + p.getId());
        }
        require(finished.size() == input.processes.size(), "all processes finish");
    }

    private static Event first(List<Event> events, Event.Type type, String process) {
        for (Event event : events) {
            if (event.getType() == type && (process == null || process.equals(event.getProcess()))) return event;
        }
        throw new AssertionError("Missing event " + type + " " + process);
    }

    private static void checkImmutabilityAndJson() {
        List<String> ids = new ArrayList<>(Arrays.asList("original"));
        Event.Snapshot snapshot = new Event.Snapshot(ids, new ArrayList<>(),
                new ArrayList<>(), new ArrayList<>(), null);
        ids.set(0, "changed");
        require(snapshot.getTier1().get(0).equals("original"), "snapshot must detach from source lists");
        expectReadOnly(() -> snapshot.getTier1().clear());
        expectReadOnly(() -> snapshot.getTier2().clear());
        expectReadOnly(() -> snapshot.getNotArrived().clear());
        expectReadOnly(() -> snapshot.getFinished().clear());
        String unusual = "quote\" slash\\\n\t" + (char) 1 + (char) 0xd800;
        Event event = new Event(Event.Type.ARRIVE, 0, null, unusual, null, null, 1, snapshot);
        String expected = "{\"type\":\"ARRIVE\",\"time\":0,\"process\":\"quote\\\" slash\\\\\\n\\t\\u0001\\ud800\",\"tier\":1,"
                + "\"snapshot\":{\"tier1\":[\"original\"],\"tier2\":[],\"notArrived\":[],\"finished\":[],\"running\":null}}";
        require(event.toJson().equals(expected), "exact schema and JSON escaping");
        EventLog log = new EventLog();
        List<Event> before = log.getEvents();
        log.add(event);
        require(before.isEmpty(), "reader list must not change when the log grows");
        expectReadOnly(() -> log.getEvents().clear());
        require(log.toJson().equals("[" + expected + "]"), "JSON array serialization");
    }

    private static void expectReadOnly(Runnable mutation) {
        try {
            mutation.run();
        } catch (UnsupportedOperationException expected) {
            return;
        }
        throw new AssertionError("Collection should be immutable");
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
