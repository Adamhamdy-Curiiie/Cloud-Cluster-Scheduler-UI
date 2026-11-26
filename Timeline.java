import java.util.ArrayList;
import java.util.List;

public class Timeline {

    private List<Integer> times = new ArrayList<>();
    private List<String> messages = new ArrayList<>();

    public void addEvent(int time, String message) {
        times.add(time);
        messages.add(message);
    }

    public void print() {

        int last = -1;

        for (int i = 0; i < messages.size(); i++) {

            int time = times.get(i);

            if (time != last) {
                System.out.println("T=" + time + ":");
                last = time;
            }

            System.out.println("  " + messages.get(i));
        }
    }
}
