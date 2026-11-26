# Cloud Cluster CPU Scheduling

Java console schedulers (ACS and SJF), with a plain JavaScript Electron interface.
Scheduling remains in Java; the UI sends one JSON request and displays the returned events and results.

The app compares Adaptive Cluster Scheduling (ACS) and Shortest Job First (SJF) on editable workloads. Explore
the recorded schedule with a Gantt chart, a 2D queue view, or an interactive 3D hospital replay.

## Project structure

- Root Java files contain the schedulers, console entry point (`Main.java`), JSON API (`ApiMain.java`), and event recording.
- `ui/` contains the Electron interface, 2D and 3D replay, and Windows packaging scripts.
- `docs/` covers the scheduler behavior and JSON event schema. `tests/` contains the console and API checks and golden fixtures. `ui/tests/` checks the Electron UI and replay.

## Run the standalone Windows app

Download the Windows x64 setup or portable executable from the [latest GitHub release](https://github.com/Adamhamdy-Curiiie/Cloud-Cluster-Scheduler-UI/releases/latest).
Run setup and launch **Cloud Cluster Scheduler** from Start, or open the portable executable directly.
Windows SmartScreen may warn because the app is unsigned.

After a local build, the same executables are available under `ui\dist`.
On Windows x64, open `ui\dist\Cloud-Cluster-Scheduler-0.1.0-x64-portable.exe` directly, or run
`ui\dist\Cloud-Cluster-Scheduler-0.1.0-x64-setup.exe` and launch **Cloud Cluster Scheduler** from Start.
Both releases include Electron, the scheduler JAR, the Java runtime and the 3D hospital assets.
The simulation and replay work offline. End users can run the app without installing Java or Node.js.

## Build the Windows release

Use Windows x64 with x64 Node.js 24 LTS, npm, and a full Windows x64 JDK 25 containing
`javac`, `jar`, `jdeps`, `jlink` and `jmods`. The first build downloads the locked npm dependencies,
Electron and the Windows packaging tools. In PowerShell from the project root, set `JAVA_HOME`
to your JDK directory and run the following commands.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-25.0.4.1'
cd ui
npm.cmd ci
npm.cmd run build:app
```

`build:app` rebuilds the Java resources and local Three.js bundle, then produces the portable EXE,
the NSIS installer and the unpacked app in `ui\dist`. You can also run either Java build stage on its own from `ui`.

```powershell
npm.cmd run build:java
npm.cmd run build:runtime
```

`build:java` compiles the development classes into `bin\ui\classes`. `build:runtime` compiles a fresh
`scheduler.jar`, uses `jdeps` to identify its modules (currently `java.base`), and runs `jlink` on that
same JDK. Electron Builder copies the JAR and runtime from `bin\ui\scheduler` to `resources\scheduler`
beside `app.asar`. The packaged app starts `resources\scheduler\runtime\bin\java.exe` by absolute path.

## Verify the packaged replay

On a fresh Windows x64 machine or Windows Sandbox with no JDK or JRE installed, copy just the portable
EXE into the guest. Run `where.exe java` in PowerShell and confirm it finds no executable. Open the
portable EXE, leave the default ACS workload in place and click **Run simulation**. Select **Play** in
the **3D hospital** view. All three patients should reach the exit and the clock should stop at
`t = 17` on event 20 of 20. To check the installer, repeat with the app installed by the setup EXE.

For an automated check, run the following command from `ui` with standalone Node.js 24.

```powershell
node .\tests\packaged-check.js .\dist\Cloud-Cluster-Scheduler-0.1.0-x64-portable.exe
```

You can also pass the installed `Cloud Cluster Scheduler.exe` as the argument. The check uses a fresh
profile, excludes Java from PATH, submits the real form and plays the WebGL scene through its last event.
It verifies the bootstrap module path reported by the running JVM against the runtime inside that copy
of the app. The test driver uses only Node.js built-ins.

## Run the UI in dev mode (Task 4)

Install a current Node.js LTS release (including npm) and a JDK with `java` and `javac` on PATH.
From the project root, in PowerShell or a terminal:

```powershell
cd ui
npm ci
npm run build:3d
npm start
```

`npm start` compiles the root Java sources into `bin/ui/classes` before opening the window.
Choose ACS or SJF, set quantum and context-switch cost, and edit the process table.
Use **Add process** and **Remove**, then **Run simulation**. The window displays validation or Java errors,
the console-equivalent results table and averages, and the recorded events in order.
Expand an event's **Queue snapshot** to inspect its recorded state. The replay opens in the 3D hospital.
Drag to orbit, scroll to zoom, or select **2D queues** to change the view at the current replay time.
The Gantt and both views follow the same Java events. `npm run build:3d` generates the local Three.js bundle in `ui/vendor`.
For optional patient and doctor models, see [the model directory](ui/assets/models/README.md).

In development, the UI uses the JDK under `JAVA_HOME` when set, otherwise `java` and `javac` on PATH.
Its default classpath is the absolute path to `bin/ui/classes`. You can override these settings for a
development run through environment variables or in [`ui/java-config.js`](ui/java-config.js).

```powershell
$env:SCHEDULER_JAVA = 'C:\Program Files\Java\jdk-25\bin\java.exe'
$env:SCHEDULER_JAVAC = 'C:\Program Files\Java\jdk-25\bin\javac.exe'
$env:SCHEDULER_CLASSES = 'D:\my classes'
npm start
```

Use a matching JDK/runtime version. `SCHEDULER_CLASSES` is also the compilation destination;
to use classes you have already compiled, run `npx electron .` from `ui`.
The Java execution timeout defaults to 120 seconds and can be adjusted in the config.

To verify the form, IPC, live Java results, event rendering, and error handling:

```powershell
npm test
```

This opens a hidden Electron window, submits the three console golden workloads through the actual form
for both algorithms, and compares every displayed result cell and average with the console fixtures.
It also exercises row editing/removal, invalid input, Java failures and safe display of unusual IDs.
Run `npm run test:3d` in `ui` to check the hospital replay, camera, local models and 12-patient frame rate.

## Final scheduler verification (Task 8)

Both suites passed on Windows. To reproduce the checks, run these commands from the project root with a JDK and Python 3 on PATH.

```powershell
.\tests\run_golden.bat
.\tests\api_check.bat
```

| Check | Result |
| --- | --- |
| Console golden output | All four fixtures matched byte for byte, including the fixture that runs the six built-in cases. |
| JSON API | All three custom workloads matched the golden results and averages for both ACS and SJF. Event checks, input ordering, UTF-8, string escaping and all 54 invalid-input cases passed. |

**Scheduling decision logic is untouched relative to the golden capture.** During Task 8, this checkout had no commits or refs, so `git diff baseline` could not resolve the requested revision. Compiling the seven saved sources in `bin/task2-original` reproduced every class in `bin/golden-capture` byte for byte. Comparing those sources with the current scheduling classes gave the following inventory.

| File | Changes since the golden capture |
| --- | --- |
| `ACSScheduler.java` | 33 lines added, zero removed. Added the `IdentityHashMap` and `Map` imports and the `eventTiers` field. Added `recordArrival` after admission in `addArrivalsToTier1` and `recordDemotion` after transfer in `demoteToTier2`. Both helpers update the recording map and append an event. The new `eventTier` and `eventSnapshot` overrides read the recorded tier and copy queue order, priorities, pending, finished and running IDs. |
| `Scheduler.java` | 58 lines added, zero removed. Added the `ArrayList` import, `eventLog` field and `getEventLog` accessor. Added `recordRun` and `recordFinish` calls in `execute`, `recordContextSwitch` in `switchTo`, and `recordIdle` in `idle`. These four new helpers append events. New `eventTier`, `eventIds`, `eventFinishedIds` and `eventSnapshot` helpers supply their snapshot data. |
| `SJF.java`, `Process.java`, `Timeline.java` | Each file is byte-identical to its saved source. |

The hooks write only to the event log, its tier map and snapshot copies. The ACS dispatch loop, both tier runners, priority selection, tie-breaking and aging retain their original statements.

To inspect the source comparison on this machine, run the following from the project root. Git returns 1 for each file with differences. The saved sources and captured classes are local build artifacts under `bin`.

```powershell
foreach ($file in 'ACSScheduler.java', 'Scheduler.java', 'SJF.java', 'Process.java', 'Timeline.java') {
    git diff --no-index -- "bin/task2-original/$file" $file
}
```

### Known limitations

- A comparison against the named Git revision still requires the original `baseline` ref. The neighboring console repo at `b522dcd` has an older output difference. Its `SJF.run()` calls `printResults()`, while the golden capture and current code print SJF results from `Main.runSJF()`.
- The golden fixtures preserve Windows line endings. Reproducing the byte comparison requires a Windows JDK.
- SJF ignores quantum and priority. Its replay records runs, context switches and finishes. Idle gaps and arrivals have no dedicated events, and the private ready queue has no snapshot. [Event schema](docs/EVENT_SCHEMA.md)
- The Windows x64 portable and installed apps passed replay using their bundled JVM on a host with a JDK. Verification on a separate Windows installation without Java remains open.
