import java.util.ArrayList;
import java.util.List;

public abstract class Scheduler {

    protected List<Process> processes;
    protected int contextSwitch;

    protected int currentTime = 0;
    protected int busyTime = 0;
    protected Process lastRunning = null;

    protected Timeline timeline;
    protected final EventLog eventLog = new EventLog();

    public Scheduler(List<Process> processes, int contextSwitch) {
        this.processes = processes;
        this.contextSwitch = contextSwitch;
        this.timeline = new Timeline();
    }

    // Every scheduling algorithm implements its own run()
    public abstract void run();

    // EXECUTION
    protected int execute(Process p, int maxUnits) {

        if (p.isFinished()) {
            return 0;
        }

        switchTo(p);

        p.markFirstRun(currentTime);

        int used = p.run(maxUnits);

        printEvent(p.getId() + " runs for " + used + " units (until T=" + (currentTime + used) + ")");
        recordRun(p, used);

        currentTime += used;
        busyTime += used;

        if (p.isFinished()) {
            p.markFinished(currentTime);

            printEvent(p.getId() + " finished");
            recordFinish(p);
        }
        return used;
    }

    // CONTEXT SWITCH
    protected void switchTo(Process next) {

        if (lastRunning != null && lastRunning != next && contextSwitch > 0) {
            printEvent("Context switch saves " + lastRunning.getId() + " and loads " + next.getId());
            recordContextSwitch(lastRunning, next);
            currentTime += contextSwitch;
        }

        lastRunning = next;
    }

    // IDLE
    protected void idle(int units) {

        if (units <= 0) {
            return;
        }

        printEvent("CPU is idle for " + units + " units");
        recordIdle(units);
        currentTime += units;
        lastRunning = null;
    }

    // Observational hooks: no scheduling state is changed.
    public EventLog getEventLog() {
        return eventLog;
    }

    protected Integer eventTier(Process p) {
        return null;
    }

    protected List<String> eventIds(Iterable<Process> queue) {
        List<String> ids = new ArrayList<>();
        for (Process p : queue) ids.add(p.getId());
        return ids;
    }

    protected List<String> eventFinishedIds() {
        List<String> ids = new ArrayList<>();
        for (Process p : processes) {
            if (p.getFinishTime() >= 0) ids.add(p.getId());
        }
        return ids;
    }

    protected Event.Snapshot eventSnapshot(Process running) {
        List<String> pending = new ArrayList<>();
        for (Process p : processes) {
            if (p.getArrivalTime() > currentTime) pending.add(p.getId());
        }
        return new Event.Snapshot(new ArrayList<>(), new ArrayList<>(),
                pending, eventFinishedIds(), running == null ? null : running.getId());
    }

    private void recordRun(Process p, int used) {
        eventLog.add(new Event(Event.Type.RUN, currentTime, currentTime + used,
                p.getId(), null, null, eventTier(p), eventSnapshot(p)));
    }

    private void recordFinish(Process p) {
        eventLog.add(new Event(Event.Type.FINISH, currentTime, null,
                p.getId(), null, null, eventTier(p), eventSnapshot(null)));
    }

    private void recordContextSwitch(Process previous, Process next) {
        eventLog.add(new Event(Event.Type.CONTEXT_SWITCH, currentTime, currentTime + contextSwitch,
                null, previous.getId(), next.getId(), null, eventSnapshot(null)));
    }

    private void recordIdle(int units) {
        eventLog.add(new Event(Event.Type.IDLE, currentTime, currentTime + units,
                null, null, null, null, eventSnapshot(null)));
    }

    // CHECK FINISHED
    protected boolean allFinished() {

        for (Process p : processes) {
            if (!p.isFinished()) {
                return false;
            }
        }

        return true;
    }

    // PRINTING HELPERS
    protected void printEvent(String message) {
        timeline.addEvent(currentTime, message);
    }

    // ACS overrides this to print Tier 1 and Tier 2
    protected void printQueues() {
        // Implemented in ACS
    }

    // Print all scheduling events
    public void printTimeline() {
        timeline.print();
    }

    // METRICS
    public double getAvgWaitingTime() {

        double sum = 0;

        for (Process p : processes) {
            sum += p.getWaitingTime();
        }

        return sum / processes.size();
    }

    public double getAvgTurnaroundTime() {

        double sum = 0;

        for (Process p : processes) {
            sum += p.getTurnaroundTime();
        }

        return sum / processes.size();
    }

    public double getAvgResponseTime() {

        double sum = 0;

        for (Process p : processes) {
            sum += p.getResponseTime();
        }

        return sum / processes.size();
    }

    public double getCpuUtilization() {

        if (currentTime == 0) {
            return 0;
        }

        return busyTime * 100.0 / currentTime;
    }

    private double round(double x) {
        return Math.round(x * 100) / 100.0;
    }

    // RESULTS
    public void printResults() {

        System.out.println(
                "\nProcess | Arrival | Finish | Turnaround | Waiting | Response");

        for (Process p : processes) {

            System.out.println(
                    p.getId() + " | " +
                            p.getArrivalTime() + " | " +
                            p.getFinishTime() + " | " +
                            p.getTurnaroundTime() + " | " +
                            p.getWaitingTime() + " | " +
                            p.getResponseTime());
        }

        System.out.println(
                "\nAverage Turnaround Time: "
                        + round(getAvgTurnaroundTime()));

        System.out.println(
                "Average Waiting Time: "
                        + round(getAvgWaitingTime()));

        System.out.println(
                "Average Response Time: "
                        + round(getAvgResponseTime()));

        System.out.println(
                "CPU Utilization: "
                        + round(getCpuUtilization()) + "%");
    }
}
