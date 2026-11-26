import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** An immutable event and a detached snapshot of the scheduler's queues. */
public final class Event {
    public enum Type {
        ARRIVE, RUN, CONTEXT_SWITCH, DEMOTE, IDLE, FINISH
    }

    public static final class Tier2Entry {
        private final String id;
        private final int priority;

        public Tier2Entry(String id, int priority) {
            this.id = id;
            this.priority = priority;
        }

        public String getId() { return id; }
        public int getPriority() { return priority; }
    }

    public static final class Snapshot {
        private final List<String> tier1;
        private final List<Tier2Entry> tier2;
        private final List<String> notArrived;
        private final List<String> finished;
        private final String running;

        public Snapshot(List<String> tier1, List<Tier2Entry> tier2,
                        List<String> notArrived, List<String> finished, String running) {
            this.tier1 = immutableCopy(tier1);
            this.tier2 = immutableCopy(tier2);
            this.notArrived = immutableCopy(notArrived);
            this.finished = immutableCopy(finished);
            this.running = running;
        }

        private static <T> List<T> immutableCopy(List<T> values) {
            return Collections.unmodifiableList(new ArrayList<>(values));
        }

        public List<String> getTier1() { return tier1; }
        public List<Tier2Entry> getTier2() { return tier2; }
        public List<String> getNotArrived() { return notArrived; }
        public List<String> getFinished() { return finished; }
        public String getRunning() { return running; }

        public String toJson() {
            StringBuilder json = new StringBuilder("{\"tier1\":");
            appendIds(json, tier1);
            json.append(",\"tier2\":[");
            for (int i = 0; i < tier2.size(); i++) {
                if (i > 0) json.append(',');
                Tier2Entry entry = tier2.get(i);
                json.append("{\"id\":");
                appendString(json, entry.id);
                json.append(",\"priority\":").append(entry.priority).append('}');
            }
            json.append("],\"notArrived\":");
            appendIds(json, notArrived);
            json.append(",\"finished\":");
            appendIds(json, finished);
            json.append(",\"running\":");
            appendString(json, running);
            return json.append('}').toString();
        }
    }

    private final Type type;
    private final int time;
    private final Integer end;
    private final String process;
    private final String from;
    private final String to;
    private final Integer tier;
    private final Snapshot snapshot;

    public Event(Type type, int time, Integer end, String process,
                 String from, String to, Integer tier, Snapshot snapshot) {
        this.type = type;
        this.time = time;
        this.end = end;
        this.process = process;
        this.from = from;
        this.to = to;
        this.tier = tier;
        this.snapshot = snapshot;
    }

    public Type getType() { return type; }
    public int getTime() { return time; }
    public Integer getEnd() { return end; }
    public String getProcess() { return process; }
    public String getFrom() { return from; }
    public String getTo() { return to; }
    public Integer getTier() { return tier; }
    public Snapshot getSnapshot() { return snapshot; }

    public String toJson() {
        StringBuilder json = new StringBuilder("{\"type\":");
        appendString(json, type.name());
        json.append(",\"time\":").append(time);
        if (end != null) json.append(",\"end\":").append(end);
        if (process != null) {
            json.append(",\"process\":");
            appendString(json, process);
        }
        if (from != null) {
            json.append(",\"from\":");
            appendString(json, from);
        }
        if (to != null) {
            json.append(",\"to\":");
            appendString(json, to);
        }
        if (tier != null) json.append(",\"tier\":").append(tier);
        return json.append(",\"snapshot\":").append(snapshot.toJson()).append('}').toString();
    }

    private static void appendIds(StringBuilder json, List<String> ids) {
        json.append('[');
        for (int i = 0; i < ids.size(); i++) {
            if (i > 0) json.append(',');
            appendString(json, ids.get(i));
        }
        json.append(']');
    }

    private static void appendString(StringBuilder json, String value) {
        if (value == null) {
            json.append("null");
            return;
        }
        json.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': json.append("\\\""); break;
                case '\\': json.append("\\\\"); break;
                case '\b': json.append("\\b"); break;
                case '\f': json.append("\\f"); break;
                case '\n': json.append("\\n"); break;
                case '\r': json.append("\\r"); break;
                case '\t': json.append("\\t"); break;
                default:
                    if (c < 0x20 || Character.isSurrogate(c)) {
                        json.append("\\u");
                        for (int shift = 12; shift >= 0; shift -= 4) {
                            json.append("0123456789abcdef".charAt((c >> shift) & 15));
                        }
                    } else {
                        json.append(c);
                    }
            }
        }
        json.append('"');
    }
}
