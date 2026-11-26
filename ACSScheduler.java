import java.util.ArrayList;
import java.util.Iterator;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.LinkedList;
import java.util.List;
import java.util.Queue;

public class ACSScheduler extends Scheduler {

    private int quantum;
    private static final int AGING_STEP = 4;
    private boolean tier2Started = false;

    private Queue<Process> tier1 = new LinkedList<>(); // Round Robin
    private List<Process> tier2 = new ArrayList<>(); // priority + aging
    private List<Process> notArrived = new ArrayList<>(); // not arrived yet
    private final Map<Process, Integer> eventTiers = new IdentityHashMap<>();

    public ACSScheduler(List<Process> processes, int contextSwitch, int quantum) {
        super(processes, contextSwitch);
        this.quantum = quantum;
        this.notArrived.addAll(processes); // input is sorted by arrival time
    }

    @Override
    public void run() {

        while (!allFinished()) {

            addArrivalsToTier1();
            if (!tier1.isEmpty()) {
                runTier1(tier1.poll());

            } else if (!tier2.isEmpty()) {
                runTier2();

            } else {
                idle(nextArrivalTime() - currentTime);

            }
            printQueues();
        }
    }

    // ---------------- Tier 1 (Round Robin)

    private void addArrivalsToTier1() {
        Iterator<Process> it = notArrived.iterator();

        while (it.hasNext()) {
            Process p = it.next();

            if (p.getArrivalTime() <= currentTime) {
                tier1.offer(p);
                it.remove();
                printEvent(p.getId() + " arrived (arrival time " + p.getArrivalTime() + ") -> Tier 1");
                recordArrival(p);
            }
        }
    }

    private void runTier1(Process p) {
        execute(p, quantum);

        if (!p.isFinished()) {
            demoteToTier2(p);
        }
    }

    private void demoteToTier2(Process p) {
        p.setWaitingSince(currentTime);
        tier2.add(p);
        printEvent(p.getId() + " moved from Tier 1 to Tier 2");
        recordDemotion(p);
    }

    // ---------------Tier 2 (Priority + Aging) بقبقبقبق
    private void runTier2() {
        if (!tier2Started) {
            tier2Started = true;
            applyAging();
        }
        Process p = pickHighestPriority();
        tier2.remove(p);

        printEvent(p.getId() + " selected from Tier 2 (priority " + p.getPriority() + ")");
        execute(p, p.getRemainingTime());
        applyAging();
    }

    private Process pickHighestPriority() {
        Process best = tier2.get(0);

        for (Process p : tier2) {
            if (p.getPriority() < best.getPriority()) {
                best = p;
            } else if (p.getPriority() == best.getPriority()
                    && p.getArrivalTime() < best.getArrivalTime()) {
                best = p;
            }
        }
        return best;
    }

    private void applyAging() {
        for (Process p : tier2) {
            int waited = currentTime - p.getWaitingSince();
            int newPriority = p.getInitialPriority() - (waited / AGING_STEP);

            if (newPriority < 0) {
                newPriority = 0;
            }

            int old = p.getPriority();
            p.setPriority(newPriority);

            if (newPriority != old) {
                printEvent(p.getId() + " aged: priority " + old
                        + " -> " + newPriority);
            }
        }
    }

    // Observational state and detached copies only; queue selection is unchanged.
    private void recordArrival(Process p) {
        eventTiers.put(p, 1);
        eventLog.add(new Event(Event.Type.ARRIVE, currentTime, null,
                p.getId(), null, null, 1, eventSnapshot(null)));
    }

    private void recordDemotion(Process p) {
        eventTiers.put(p, 2);
        eventLog.add(new Event(Event.Type.DEMOTE, currentTime, null,
                p.getId(), null, null, 2, eventSnapshot(null)));
    }

    @Override
    protected Integer eventTier(Process p) {
        return eventTiers.get(p);
    }

    @Override
    protected Event.Snapshot eventSnapshot(Process running) {
        List<Event.Tier2Entry> priorities = new ArrayList<>();
        for (Process p : tier2) {
            priorities.add(new Event.Tier2Entry(p.getId(), p.getPriority()));
        }
        return new Event.Snapshot(eventIds(tier1), priorities, eventIds(notArrived),
                eventFinishedIds(), running == null ? null : running.getId());
    }

    // ----------------Helpers

    // geb el next arrival time of the processes that have not arrived yet
    private int nextArrivalTime() {
        int min = Integer.MAX_VALUE;

        for (Process p : notArrived) {
            if (p.getArrivalTime() < min) {
                min = p.getArrivalTime();
            }
        }
        return min;
    }

    // etba3 kol el processes in tier1 and tier2 in the timeline
    @Override
    protected void printQueues() {
        printEvent("Tier1 = " + tier1 + " | Tier2 = " + tier2);
    }
}