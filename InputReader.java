import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;

public class InputReader {

    public static List<Process> readProcesses(Scanner in) {

        System.out.print("Number of processes: ");
        int n = in.nextInt();

        List<Process> list = new ArrayList<>();

        for (int i = 1; i <= n; i++) {

            String id = "P" + i;

            System.out.println("\nProcess " + id + ":");

            System.out.print("  Arrival time: ");
            int arrival = in.nextInt();

            System.out.print("  Burst time: ");
            int burst = in.nextInt();

            System.out.print("  Priority: ");
            int priority = in.nextInt();

            list.add(new Process(id, arrival, burst, priority));
        }

        return list;
    }
}
