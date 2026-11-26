import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;

public class Main {

    public static void main(String[] args) {

        Scanner in = new Scanner(System.in);

        System.out.println("1) Run the ready test cases");
        System.out.println("2) Enter my own input (InputReader)");
        System.out.print("Choice: ");
        int mode = in.nextInt();

        if (mode == 1) {
            runReadyTests();
        } else {
            runFromInput(in);
        }
    }

    // ------------------------------------------------------------
    // MODE 2: input from InputReader
    // ------------------------------------------------------------
    private static void runFromInput(Scanner in) {

        List<Process> processes = InputReader.readProcesses(in);

        // the schedulers need the processes sorted by arrival time
        processes.sort((a, b) -> a.getArrivalTime() - b.getArrivalTime());

        System.out.println("\nInput loaded successfully!");
        System.out.println("Number of processes: " + processes.size());

        System.out.print("Context switch time: ");
        int contextSwitch = in.nextInt();

        System.out.print("Quantum (used by ACS only): ");
        int quantum = in.nextInt();

        System.out.print("Algorithm (1 = SJF, 2 = ACS, 3 = both): ");
        int choice = in.nextInt();

        if (choice == 1 || choice == 3) {
            runSJF(processes, contextSwitch);
        }
        if (choice == 2 || choice == 3) {
            runACS(processes, contextSwitch, quantum);
        }
    }

    // ------------------------------------------------------------
    // MODE 1: ready test cases
    // each process = { arrival, burst, priority }  (ids: P1, P2, ...)
    // ------------------------------------------------------------
    private static void runReadyTests() {

        // TEST 1: basic, no context switch
        runTest("TEST 1: basic (cs=0, quantum=2)", 0, 2, new int[][] {
                {0, 6, 5}, {1, 3, 3}, {2, 4, 1}
        });

        // TEST 2: idle gap in the middle + context switch
        runTest("TEST 2: idle gap + context switch (cs=1, quantum=2)", 1, 2, new int[][] {
                {0, 3, 4}, {1, 5, 2}, {15, 2, 3}
        });

        // TEST 3: aging (long waits in Tier 2)
        runTest("TEST 3: aging (cs=0, quantum=2)", 0, 2, new int[][] {
                {0, 10, 8}, {0, 10, 6}, {0, 3, 7}
        });

        // TEST 4: CPU idle at the start (first arrival is not 0)
        runTest("TEST 4: first arrival at 5 (cs=0, quantum=3)", 0, 3, new int[][] {
                {5, 4, 2}, {6, 2, 1}
        });

        // TEST 5: single process
        runTest("TEST 5: single process (cs=2, quantum=3)", 2, 3, new int[][] {
                {0, 7, 3}
        });

        // TEST 6: same arrival time, equal priorities, late short arrival
        runTest("TEST 6: ties + late arrival (cs=1, quantum=2)", 1, 2, new int[][] {
                {0, 4, 2}, {0, 4, 2}, {0, 2, 5}, {3, 1, 1}
        });
    }

    private static void runTest(String title, int contextSwitch, int quantum, int[][] data) {

        System.out.println("\n##################################################");
        System.out.println(title);
        System.out.println("##################################################");

        List<Process> processes = new ArrayList<>();

        for (int i = 0; i < data.length; i++) {
            processes.add(new Process("P" + (i + 1), data[i][0], data[i][1], data[i][2]));
        }

        runACS(processes, contextSwitch, quantum);
        runSJF(processes, contextSwitch);
    }

    // ------------------------------------------------------------
    // run helpers (each run gets fresh copies of the processes)
    // ------------------------------------------------------------
    private static void runACS(List<Process> processes, int contextSwitch, int quantum) {
        System.out.println("\n---------- ACS ----------");
        ACSScheduler acs = new ACSScheduler(copyAll(processes), contextSwitch, quantum);
        acs.run();
        acs.printTimeline();
        acs.printResults();
    }

    private static void runSJF(List<Process> processes, int contextSwitch) {
        System.out.println("\n---------- SJF ----------");
        SJF sjf = new SJF(copyAll(processes), contextSwitch);
        sjf.run();
        sjf.printTimeline();
        sjf.printResults();
    }

    private static List<Process> copyAll(List<Process> source) {
        List<Process> list = new ArrayList<>();

        for (Process p : source) {
            list.add(p.copy());
        }
        return list;
    }
}