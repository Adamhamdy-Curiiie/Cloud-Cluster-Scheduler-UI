GLOBAL RULES FOR THIS PROJECT:
- The scheduling logic is FROZEN. Never change the decisions made in
  ACSScheduler (run, runTier1, runTier2, pickHighestPriority, applyAging,
  demoteToTier2, addArrivalsToTier1), SJFScheduler, or Process.
- Allowed Java changes are ADDITIVE only: new classes, new fields, new hook
  calls that record events. Existing console output must stay byte-identical or in case that u want output in way to be easy for the UI.
- The UI contains NO scheduling logic. It only sends input and replays events.
- Do only the current task. Do not start the next one. Do not read files
  unrelated to the current task.
- At the end of each task: update PROGRESS.md (max 5 lines: what was done,
  files touched, how to verify, open problems), then stop and report.