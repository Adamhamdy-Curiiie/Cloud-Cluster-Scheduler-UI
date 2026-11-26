import java.util.Comparator;
import java.util.List;
import java.util.PriorityQueue;

public class SJF extends Scheduler {

    public SJF(List<Process> processes, int contextSwitch) {
        super(processes, contextSwitch);
    }

    @Override
    public void run() {
        // create Min Heap 
        PriorityQueue<Process> minHeap = new PriorityQueue<>
        (
            Comparator.comparingInt(Process::getRemainingTime)
                    .thenComparingInt(Process::getArrivalTime)
        );

        // while list have processes
        while (!allFinished()) {
            int index = 0;
            // add process when arrive on TimeLine
            while (index < processes.size() && processes.get(index).getArrivalTime() <= currentTime) {
                Process p = processes.get(index);
                if (!p.isFinished() && !minHeap.contains(p)) {
                    minHeap.add(p);
                    if (p.getBurstTime() == p.getRemainingTime()) // first run on cpu (arrive)
                        timeline.addEvent(currentTime, p.getId() + " arrived");
                }
                index++;
            }

            if (minHeap.isEmpty()) { // not have current process executed and still have processes
                currentTime++;
                lastRunning = null;
            } else {
                Process currentProcess = minHeap.poll();
                execute(currentProcess, 1);
            }
        }

    }
}