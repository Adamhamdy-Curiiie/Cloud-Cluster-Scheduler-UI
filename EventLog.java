import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Append-only recording; readers receive immutable copies in recording order. */
public final class EventLog {
    private final List<Event> events = new ArrayList<>();

    public void add(Event event) {
        events.add(event);
    }

    public int size() {
        return events.size();
    }

    public List<Event> getEvents() {
        return Collections.unmodifiableList(new ArrayList<>(events));
    }

    public String toJson() {
        StringBuilder json = new StringBuilder("[");
        for (int i = 0; i < events.size(); i++) {
            if (i > 0) json.append(',');
            json.append(events.get(i).toJson());
        }
        return json.append(']').toString();
    }
}
