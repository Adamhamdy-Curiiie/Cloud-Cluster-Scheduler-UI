// Exercise the actual Electron window, preload, IPC handler, and Java process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { createWindow } = require('../main');
const { runJava } = require('../java-runner');
const javaConfig = require('../java-config');

const root = path.resolve(__dirname, '..', '..');
const fields = ['id', 'arrival', 'finish', 'turnaround', 'waiting', 'response'];
const labels = {
  turnaround: 'Average Turnaround Time', waiting: 'Average Waiting Time',
  response: 'Average Response Time', cpuUtilization: 'CPU Utilization'
};
let window;
const evaluate = source => window.webContents.executeJavaScript(source, true);

function fixture(name, algorithm) {
  const tokens = fs.readFileSync(path.join(root, 'tests', 'inputs', `${name}.txt`), 'utf8')
    .trim().split(/\s+/).map(Number);
  assert.equal(tokens.shift(), 2);
  const count = tokens.shift();
  const processes = Array.from({ length: count }, (_, index) => ({
    id: `P${index + 1}`, arrival: tokens.shift(), burst: tokens.shift(), priority: tokens.shift()
  }));
  const contextSwitch = tokens.shift();
  const quantum = tokens.shift();
  assert.deepEqual(tokens, [3]);
  const golden = fs.readFileSync(path.join(root, 'tests', 'golden', `${name}.txt`), 'utf8')
    .replace(/\r\n/g, '\n');
  const section = golden.split(`---------- ${algorithm} ----------\n`)[1].split('\n---------- ')[0];
  const results = Array.from(section.matchAll(/^(P\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\d+)$/gm),
    match => match.slice(1));
  assert.ok(results.length);
  const averages = Object.fromEntries(Object.entries(labels).map(([key, label]) => {
    const match = section.match(new RegExp(`^${label}: ([0-9.]+)%?$`, 'm'));
    assert.ok(match, `Missing ${label}`);
    return [key, String(Number(match[1])) + (key === 'cpuUtilization' ? '%' : '')];
  }));
  return { request: { algorithm, quantum, contextSwitch, processes }, results, averages };
}

async function fill(request) {
  await evaluate(`(() => {
    const request = ${JSON.stringify(request)};
    document.getElementById('algorithm').value = request.algorithm;
    document.getElementById('algorithm').dispatchEvent(new Event('change'));
    document.getElementById('quantum').value = request.quantum;
    document.getElementById('context-switch').value = request.contextSwitch;
    document.querySelectorAll('#process-rows button').forEach(button => button.click());
    request.processes.forEach(process => {
      document.getElementById('add-process').click();
      const row = document.getElementById('process-rows').lastElementChild;
      for (const key of ['id', 'arrival', 'burst', 'priority']) {
        row.querySelector('[data-field="' + key + '"]').value = process[key];
      }
    });
  })()`);
}

async function submit() {
  await evaluate("document.getElementById('scheduler-form').requestSubmit()");
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const state = await evaluate(`({
      busy: document.getElementById('scheduler-form').getAttribute('aria-busy'),
      status: document.getElementById('status').textContent
    })`);
    if (!state.busy && (state.status.startsWith('Completed') || state.status === 'Run failed')) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Window did not complete the run within 20 seconds.');
}

async function displayed() {
  return evaluate(`({
    error: document.getElementById('error').hidden ? null : document.getElementById('error').textContent,
    outputHidden: document.getElementById('output').hidden,
    rows: Array.from(document.querySelectorAll('#result-rows tr'), row =>
      Array.from(row.children, cell => cell.textContent)),
    averages: Object.fromEntries(Array.from(document.querySelectorAll('[data-metric]'),
      value => [value.dataset.metric, value.textContent])),
    events: Array.from(document.querySelectorAll('#events li'), item => ({
      type: item.dataset.type, time: item.querySelector('.event-time').textContent,
      snapshot: JSON.parse(item.querySelector('pre').textContent)
    })),
    disabled: Array.from(document.querySelectorAll('#scheduler-form input, #scheduler-form select, #scheduler-form button'))
      .some(control => control.disabled)
  })`);
}

async function replayState() {
  return evaluate(`(() => {
    const scene = document.getElementById('replay-scene');
    const zone = name => Array.from(
      scene.querySelector('[data-zone="' + name + '"] .scene-zone-list').querySelectorAll('.process-card'),
      card => card.dataset.process);
    return {
      eventIndex: Number(scene.dataset.eventIndex),
      time: Number(scene.dataset.time),
      playing: scene.dataset.playing === 'true',
      complete: scene.dataset.complete === 'true',
      zones: {
        notArrived: zone('notArrived'),
        tier1: zone('tier1'),
        cpu: zone('cpu'),
        tier2: Array.from(
          scene.querySelector('[data-zone="tier2"] .scene-zone-list').querySelectorAll('.process-card'),
          card => ({ id: card.dataset.process, priority: Number(card.dataset.priority) })),
        done: zone('done')
      },
      gantt: Array.from(document.querySelectorAll('#replay-gantt .gantt-item'), item => ({
        index: Number(item.dataset.index),
        type: item.dataset.type,
        start: Number(item.dataset.start),
        end: Number(item.dataset.end),
        recordedEnd: Number(item.dataset.recordedEnd),
        process: item.dataset.process || null
      }))
    };
  })()`);
}

async function checkTier2Replay(response, request) {
  let state = await replayState();
  assert.equal(state.eventIndex, -1);
  assert.equal(state.time, 0);
  assert.deepEqual(state.zones.notArrived, request.processes.map(process => process.id));
  assert.deepEqual(state.zones.tier1, []);
  assert.deepEqual(state.zones.cpu, []);
  assert.deepEqual(state.zones.tier2, []);
  assert.deepEqual(state.zones.done, []);

  for (let index = 0; index < response.events.length; index++) {
    await evaluate("document.getElementById('replay-forward').click()");
    state = await replayState();
    const event = response.events[index];
    assert.equal(state.eventIndex, index, 'Replay event cursor');
    assert.equal(state.time, event.time, 'Replay event time');
    assert.deepEqual(state.zones.notArrived, event.snapshot.notArrived, 'Not Arrived snapshot');
    assert.deepEqual(state.zones.tier1, event.snapshot.tier1, 'Tier 1 snapshot');
    assert.deepEqual(state.zones.tier2, event.snapshot.tier2, 'Tier 2 priorities');
    assert.deepEqual(state.zones.done, event.snapshot.finished, 'Finished snapshot');
    assert.deepEqual(state.zones.cpu, event.snapshot.running
      ? [event.snapshot.running]
      : event.type === 'CONTEXT_SWITCH' ? [event.to] : [], 'CPU snapshot/event endpoint');
  }

  const expectedIntervals = response.events.map((event, index) => ({
    index, type: event.type, start: event.time, end: event.end,
    recordedEnd: event.end, process: event.process || null
  })).filter(event => ['RUN', 'CONTEXT_SWITCH', 'IDLE'].includes(event.type));
  assert.deepEqual(state.gantt, expectedIntervals, 'Final Gantt order and intervals');

  await evaluate("document.getElementById('replay-back').click()");
  state = await replayState();
  assert.equal(state.eventIndex, response.events.length - 2, 'Step back uses recorded event order');

  const scrubTime = 10.5;
  await evaluate(`(() => {
    const scrubber = document.getElementById('replay-scrubber');
    scrubber.value = ${scrubTime};
    scrubber.dispatchEvent(new Event('input'));
  })()`);
  state = await replayState();
  const scrubIndex = response.events.reduce((latest, event, index) =>
    event.time <= scrubTime ? index : latest, -1);
  assert.equal(state.eventIndex, scrubIndex, 'Scrubber selects the latest recorded snapshot');
  assert.equal(state.time, scrubTime);
  assert.deepEqual(state.zones.cpu, [response.events[scrubIndex].snapshot.running]);

  await evaluate("document.getElementById('replay-restart').click()");
  state = await replayState();
  assert.equal(state.eventIndex, -1);
  assert.equal(state.time, 0);

  await evaluate(`(() => {
    const speed = document.getElementById('replay-speed');
    speed.value = 8;
    speed.dispatchEvent(new Event('input'));
    document.getElementById('replay-play').click();
  })()`);
  const deadline = Date.now() + 15000;
  do {
    await new Promise(resolve => setTimeout(resolve, 100));
    state = await replayState();
  } while (Date.now() < deadline && (!state.complete || state.playing));
  assert.equal(state.complete, true, 'Play reaches the final event');
  assert.equal(state.playing, false, 'Play pauses at the final event');
  assert.deepEqual(state.gantt, expectedIntervals, 'Played Gantt matches the golden event intervals');
  console.log('PASS: Task 5 replay controls, snapshots, live priorities, and Gantt timeline');
}

async function expectError(request, message, edit) {
  await fill(request);
  if (edit) await evaluate(edit);
  await submit();
  const actual = await displayed();
  assert.match(actual.error, message);
  assert.equal(actual.outputHidden, true, 'Stale results must be hidden after failure');
  assert.equal(actual.disabled, false, 'Controls must recover after failure');
}

async function check() {
  await app.whenReady();
  window = await createWindow({ show: false });
  await evaluate("document.getElementById('replay-view').value = '2d'");
  const consoleErrors = [];
  window.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') consoleErrors.push(details.message);
  });
  assert.deepEqual(await evaluate(`({ node: typeof require, bridge: typeof window.schedulerApi.run })`),
    { node: 'undefined', bridge: 'function' });

  for (const name of ['all_arrive_zero', 'idle_gap', 'tier2_context_switch']) {
    for (const algorithm of ['ACS', 'SJF']) {
      const expected = fixture(name, algorithm);
      const response = await runJava(expected.request);
      await fill(expected.request);
      await submit();
      const actual = await displayed();
      assert.equal(actual.error, null);
      assert.equal(actual.outputHidden, false);
      assert.equal(actual.disabled, false);
      assert.deepEqual(actual.rows, expected.results, `${name}/${algorithm}: console result cells`);
      assert.deepEqual(actual.averages, expected.averages, `${name}/${algorithm}: console averages`);
      assert.deepEqual(actual.events, response.events.map(event => ({
        type: event.type,
        time: event.end === undefined ? `t = ${event.time}` : `[${event.time}, ${event.end})`,
        snapshot: event.snapshot
      })), `${name}/${algorithm}: recorded event order and snapshots`);
      if (name === 'tier2_context_switch' && algorithm === 'ACS') {
        await checkTier2Replay(response, expected.request);
      }
      console.log(`PASS: ${name}/${algorithm} form → IPC → Java → console-equivalent table/events`);
    }
  }

  const base = { algorithm: 'ACS', quantum: 2, contextSwitch: 0,
    processes: [{ id: 'P1', arrival: 0, burst: 3, priority: 1 }] };
  await expectError({ ...base, quantum: 0 }, /Quantum/);
  await expectError({ ...base, contextSwitch: -1 }, /Context switch/);
  await expectError({ ...base, processes: [] }, /at least one process/);
  await expectError({ ...base, processes: [base.processes[0], base.processes[0]] }, /Duplicate process ID/);
  await expectError(base, /must not be blank/,
    "document.querySelector('[data-field=\"id\"]').value = '   '");
  await expectError(base, /burst must be a whole number/,
    "document.querySelector('[data-field=\"burst\"]').value = '1.5'");
  // This passes form validation; ApiMain itself returns the range error through IPC.
  await expectError({ ...base, processes: [{ ...base.processes[0], arrival: 2147483647 }] },
    /Simulation time may exceed the 32-bit range/);
  console.log('PASS: form validation, row add/remove, Java validation errors, controls recover');

  const unusualId = '<img src=x onerror="window.__injected=true"> عربية " \\';
  await fill({ ...base, algorithm: 'SJF', quantum: 0,
    processes: [{ ...base.processes[0], id: unusualId, priority: -2147483648 }] });
  await submit();
  const unusual = await displayed();
  assert.equal(unusual.error, null);
  assert.deepEqual(unusual.rows, [[unusualId, '0', '3', '3', '0', '0']]);
  assert.equal(await evaluate("document.querySelector('#output img') === null && window.__injected === undefined"), true);
  assert.ok(await evaluate("document.getElementById('events').textContent.includes('عربية')"));
  console.log('PASS: SJF quantum zero, signed priority, Unicode/HTML IDs displayed safely');

  await assert.rejects(runJava(base, { ...javaConfig,
    executable: path.join(root, 'bin', 'missing-java-for-ui-check.exe') }), /Cannot start Java/);
  await assert.rejects(runJava(base, { ...javaConfig,
    classesPath: path.join(root, 'bin', 'missing-classes-for-ui-check') }), /ApiMain/);

  // The runner retains the shared config object, so these trigger genuine failures
  // through the same IPC used by the form, without test hooks in production code.
  const savedExecutable = javaConfig.executable;
  const savedClasses = javaConfig.classesPath;
  try {
    javaConfig.executable = path.join(root, 'bin', 'missing-java-for-ui-check.exe');
    await expectError(base, /Cannot start Java/);
    javaConfig.executable = savedExecutable;
    javaConfig.classesPath = path.join(root, 'bin', 'missing-classes-for-ui-check');
    await expectError(base, /ApiMain/);
  } finally {
    javaConfig.executable = savedExecutable;
    javaConfig.classesPath = savedClasses;
  }
  await fill(base);
  await submit();
  assert.equal((await displayed()).error, null, 'A run after Java failure must succeed');

  const replayFixture = fixture('tier2_context_switch', 'ACS');
  await fill(replayFixture.request);
  await submit();
  assert.equal((await displayed()).error, null, 'Task 5 screenshot workload must succeed');
  await evaluate("(() => { const scrubber = document.getElementById('replay-scrubber'); scrubber.value = 15; scrubber.dispatchEvent(new Event('input')); document.getElementById('replay-panel').scrollIntoView({ block: 'start' }); })()");
  await new Promise(resolve => setTimeout(resolve, 450));
  const replayGeometry = await evaluate("(() => { const scene = document.getElementById('replay-scene'); const sceneRect = scene.getBoundingClientRect(); return { sceneTop: sceneRect.top, sceneBottom: sceneRect.bottom, cards: Array.from(scene.querySelectorAll('.process-card'), card => { const rect = card.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, opacity: getComputedStyle(card).opacity }; }) }; })()");
  assert.equal(replayGeometry.cards.length, 4, 'Task 5 screenshot contains every process card');
  assert.ok(replayGeometry.cards.every(card => card.top >= replayGeometry.sceneTop &&
    card.bottom <= replayGeometry.sceneBottom && Number(card.opacity) > 0.5),
  'Process cards are visibly inside the scene: ' + JSON.stringify(replayGeometry));
  assert.deepEqual(consoleErrors, [], 'Renderer console errors');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  window.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 200));
  const screenshot = await window.webContents.capturePage();
  fs.writeFileSync(path.join(root, 'bin', 'ui', 'window-check.png'), screenshot.toPNG());
  console.log('PASS: missing Java/classpath errors in window, recovery, and Task 5 screenshot');
  console.log('All Electron window checks passed.');
}

check().then(() => {
  window?.destroy();
  app.quit();
}).catch(error => {
  console.error(error);
  window?.destroy();
  app.exit(1);
});
