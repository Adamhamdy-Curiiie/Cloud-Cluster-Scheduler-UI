import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** One UTF-8 JSON request on stdin, one JSON response on stdout. */
public final class ApiMain {
    private ApiMain() {}

    public static void main(String[] args) {
        String response;
        int exitCode = 0;
        try {
            Request request = new JsonInput(readInput()).parse();
            // Match Main's stable arrival ordering, including ties.
            request.processes.sort(Comparator.comparingInt(Process::getArrivalTime));
            Scheduler scheduler = request.algorithm.equals("ACS")
                    ? new ACSScheduler(request.processes, request.contextSwitch, request.quantum)
                    : new SJF(request.processes, request.contextSwitch);
            scheduler.run();
            response = resultsJson(scheduler, request.processes);
        } catch (IOException | RuntimeException exception) {
            StringBuilder json = new StringBuilder("{\"error\":");
            appendString(json, exception.getMessage() == null
                    ? "Unable to read or run the request" : exception.getMessage());
            response = json.append('}').toString();
            exitCode = 1;
        }
        PrintWriter output = new PrintWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8));
        output.println(response);
        output.flush();
        if (exitCode != 0) System.exit(exitCode);
    }

    private static String readInput() throws IOException {
        InputStreamReader input = new InputStreamReader(System.in, StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT));
        StringBuilder text = new StringBuilder();
        char[] buffer = new char[4096];
        int count;
        while ((count = input.read(buffer)) != -1) text.append(buffer, 0, count);
        return text.toString();
    }

    private static String resultsJson(Scheduler scheduler, List<Process> processes) {
        StringBuilder json = new StringBuilder("{\"events\":");
        json.append(scheduler.getEventLog().toJson()).append(",\"results\":[");
        for (int i = 0; i < processes.size(); i++) {
            if (i > 0) json.append(',');
            Process process = processes.get(i);
            json.append("{\"id\":");
            appendString(json, process.getId());
            json.append(",\"arrival\":").append(process.getArrivalTime())
                    .append(",\"finish\":").append(process.getFinishTime())
                    .append(",\"turnaround\":").append(process.getTurnaroundTime())
                    .append(",\"waiting\":").append(process.getWaitingTime())
                    .append(",\"response\":").append(process.getResponseTime()).append('}');
        }
        return json.append("],\"averages\":{\"turnaround\":")
                .append(consoleRound(scheduler.getAvgTurnaroundTime()))
                .append(",\"waiting\":").append(consoleRound(scheduler.getAvgWaitingTime()))
                .append(",\"response\":").append(consoleRound(scheduler.getAvgResponseTime()))
                .append(",\"cpuUtilization\":").append(consoleRound(scheduler.getCpuUtilization()))
                .append("}}").toString();
    }

    // Use exactly the rounding used by Scheduler.printResults().
    private static double consoleRound(double value) {
        return Math.round(value * 100) / 100.0;
    }

    private static void appendString(StringBuilder json, String value) {
        json.append('"');
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            switch (character) {
                case '"': json.append("\\\""); break;
                case '\\': json.append("\\\\"); break;
                case '\b': json.append("\\b"); break;
                case '\f': json.append("\\f"); break;
                case '\n': json.append("\\n"); break;
                case '\r': json.append("\\r"); break;
                case '\t': json.append("\\t"); break;
                default:
                    if (character < 0x20 || Character.isSurrogate(character)) {
                        json.append("\\u");
                        for (int shift = 12; shift >= 0; shift -= 4) {
                            json.append("0123456789abcdef".charAt((character >> shift) & 15));
                        }
                    } else {
                        json.append(character);
                    }
            }
        }
        json.append('"');
    }

    private static final class Request {
        private String algorithm;
        private int quantum;
        private int contextSwitch;
        private List<Process> processes;
    }

    /** A strict parser for the request schema; no scheduling decisions occur here. */
    private static final class JsonInput {
        private final String text;
        private int position;

        private JsonInput(String text) {
            this.text = text;
        }

        private Request parse() {
            Request request = new Request();
            Set<String> fields = new HashSet<>();
            expect('{');
            if (!take('}')) {
                do {
                    String field = field(fields);
                    switch (field) {
                        case "algorithm": request.algorithm = string(); break;
                        case "quantum": request.quantum = integer(); break;
                        case "contextSwitch": request.contextSwitch = integer(); break;
                        case "processes": request.processes = processes(); break;
                        default: throw error("Unknown request field: " + field);
                    }
                } while (take(','));
                expect('}');
            }
            whitespace();
            if (position != text.length()) throw error("Expected exactly one JSON object");
            requireFields(fields, "algorithm", "quantum", "contextSwitch", "processes");
            if (!request.algorithm.equals("ACS") && !request.algorithm.equals("SJF")) {
                throw error("algorithm must be ACS or SJF");
            }
            if (request.quantum < 0 || (request.algorithm.equals("ACS") && request.quantum == 0)) {
                throw error("quantum must be positive for ACS and nonnegative for SJF");
            }
            if (request.contextSwitch < 0) throw error("contextSwitch must be nonnegative");
            if (request.processes.isEmpty()) throw error("processes must not be empty");
            validateTimeRange(request);
            return request;
        }

        private List<Process> processes() {
            List<Process> processes = new ArrayList<>();
            Set<String> ids = new HashSet<>();
            expect('[');
            if (!take(']')) {
                do {
                    Process process = process();
                    if (!ids.add(process.getId())) throw error("Duplicate process id: " + process.getId());
                    processes.add(process);
                } while (take(','));
                expect(']');
            }
            return processes;
        }

        private Process process() {
            String id = null;
            int arrival = 0, burst = 0, priority = 0;
            Set<String> fields = new HashSet<>();
            expect('{');
            if (!take('}')) {
                do {
                    String field = field(fields);
                    switch (field) {
                        case "id": id = string(); break;
                        case "arrival": arrival = integer(); break;
                        case "burst": burst = integer(); break;
                        case "priority": priority = integer(); break;
                        default: throw error("Unknown process field: " + field);
                    }
                } while (take(','));
                expect('}');
            }
            requireFields(fields, "id", "arrival", "burst", "priority");
            if (id.trim().isEmpty()) throw error("Process id must not be blank");
            if (arrival < 0) throw error("arrival must be nonnegative");
            if (burst <= 0) throw error("burst must be positive");
            return new Process(id, arrival, burst, priority);
        }

        private String field(Set<String> fields) {
            String field = string();
            if (!fields.add(field)) throw error("Duplicate field: " + field);
            expect(':');
            return field;
        }

        private void requireFields(Set<String> fields, String... required) {
            for (String field : required) {
                if (!fields.contains(field)) throw error("Missing field: " + field);
            }
        }

        private int integer() {
            whitespace();
            int start = position;
            if (position < text.length() && text.charAt(position) == '-') position++;
            if (position == text.length() || !digit(text.charAt(position))) {
                throw error("Expected a 32-bit integer");
            }
            if (text.charAt(position++) != '0') {
                while (position < text.length() && digit(text.charAt(position))) position++;
            } else if (position < text.length() && digit(text.charAt(position))) {
                throw error("Leading zeros are not valid JSON");
            }
            if (position < text.length() && ".eE+".indexOf(text.charAt(position)) >= 0) {
                throw error("Expected a 32-bit integer");
            }
            try {
                return Integer.parseInt(text.substring(start, position));
            } catch (NumberFormatException exception) {
                throw error("Integer is outside the 32-bit range");
            }
        }

        private boolean digit(char character) {
            return character >= '0' && character <= '9';
        }

        private String string() {
            expect('"');
            StringBuilder value = new StringBuilder();
            while (position < text.length()) {
                char character = text.charAt(position++);
                if (character == '"') return value.toString();
                if (character < 0x20) throw error("Unescaped control character in string");
                if (character != '\\') {
                    value.append(character);
                    continue;
                }
                if (position == text.length()) throw error("Unfinished string escape");
                switch (text.charAt(position++)) {
                    case '"': value.append('"'); break;
                    case '\\': value.append('\\'); break;
                    case '/': value.append('/'); break;
                    case 'b': value.append('\b'); break;
                    case 'f': value.append('\f'); break;
                    case 'n': value.append('\n'); break;
                    case 'r': value.append('\r'); break;
                    case 't': value.append('\t'); break;
                    case 'u':
                        int code = 0;
                        for (int i = 0; i < 4; i++) {
                            if (position == text.length()) throw error("Incomplete Unicode escape");
                            char hex = text.charAt(position++);
                            int digit = "0123456789abcdef".indexOf(Character.toLowerCase(hex));
                            if (digit < 0) throw error("Invalid Unicode escape");
                            code = (code << 4) | digit;
                        }
                        value.append((char) code);
                        break;
                    default: throw error("Invalid string escape");
                }
            }
            throw error("Unterminated string");
        }

        private boolean take(char expected) {
            whitespace();
            if (position < text.length() && text.charAt(position) == expected) {
                position++;
                return true;
            }
            return false;
        }

        private void expect(char expected) {
            if (!take(expected)) throw error("Expected '" + expected + "'");
        }

        private void whitespace() {
            while (position < text.length() && " \t\r\n".indexOf(text.charAt(position)) >= 0) position++;
        }

        private IllegalArgumentException error(String message) {
            return new IllegalArgumentException(message + " at character " + position);
        }

        private void validateTimeRange(Request request) {
            long latestArrival = 0, work = 0, slices = 0;
            for (Process process : request.processes) {
                latestArrival = Math.max(latestArrival, process.getArrivalTime());
                work += process.getBurstTime();
                slices += request.algorithm.equals("ACS")
                        ? (process.getBurstTime() > request.quantum ? 2 : 1)
                        : process.getBurstTime();
            }
            // Conservative bound, without simulating any selection or queue behavior.
            if (latestArrival + work > Integer.MAX_VALUE
                    || latestArrival + work + (slices - 1) * request.contextSwitch > Integer.MAX_VALUE) {
                throw error("Simulation time may exceed the 32-bit range");
            }
        }
    }
}
