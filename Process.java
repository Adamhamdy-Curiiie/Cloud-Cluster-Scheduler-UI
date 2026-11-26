public class Process {

    // Immutable input data
    private final String id;
    private final int arrivalTime;
    private final int burstTime;
    private final int initialPriority;

    //  Mutable data -- changes during simulation
    private int remainingTime;
    private int priority;          // effective priority (changes with aging)
    private int waitingSince;      // time it started waiting in its current queue (for aging)
    private int firstRunTime = -1; // -1 = has not run yet
    private int finishTime = -1;   // -1 = not finished yet

    public Process(String id, int arrivalTime, int burstTime, int initialPriority) {
        this.id = id;
        this.arrivalTime = arrivalTime;
        this.burstTime = burstTime;
        this.initialPriority = initialPriority;

        this.remainingTime = burstTime;
        this.priority = initialPriority; // aging -- priority = initialPriority - ((waiting since - arrivalTime IN TIER2) / 4 )
        this.waitingSince = arrivalTime; // used in ASCC for aging 
    }

    // ---- Behaviour ----

    public int run(int units) {
        int consumed = Math.min(units, remainingTime);
        remainingTime -= consumed;
        return consumed;
    }

    public boolean isFinished() {
        return remainingTime == 0;
    }

    public void markFirstRun(int time) {
        if (firstRunTime == -1)
            firstRunTime = time;
    }

    public void markFinished(int time) {
        this.finishTime = time;
    }

    //if needed, create a copy of the process with the same id, arrival time, burst time, and initial priority. The new process will have the same remaining time and priority as the original process. The new process will also have the same waiting since, first run time, and finish time as the original process.
    public Process copy() {
        return new Process(id, arrivalTime, burstTime, initialPriority);
    }


    public int getTurnaroundTime() {
        requireFinished();
        return finishTime - arrivalTime;
    }

    public int getWaitingTime() {
        return getTurnaroundTime() - burstTime;
    }

    public int getResponseTime() {
        return firstRunTime - arrivalTime;
    }

    private void requireFinished() {
        if (finishTime == -1)
            throw new IllegalStateException(id + " has not finished yet");
    }


    public String getId()              { return id; }
    public int getArrivalTime()        { return arrivalTime; }
    public int getBurstTime()          { return burstTime; }
    public int getInitialPriority()    { return initialPriority; }
    public int getRemainingTime()      { return remainingTime; }
    public int getPriority()           { return priority; }
    public int getWaitingSince()       { return waitingSince; }
    public int getFirstRunTime()       { return firstRunTime; }
    public int getFinishTime()         { return finishTime; }

    public void setPriority(int priority)         { this.priority = priority; }
    public void setWaitingSince(int waitingSince) { this.waitingSince = waitingSince; }

    @Override
    public String toString() {
        return id + " (remaining: " + remainingTime + ", Priority: " + priority + ")";
    }
}
