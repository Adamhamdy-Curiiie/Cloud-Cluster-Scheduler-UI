const form = document.getElementById('scheduler-form');
const rows = document.getElementById('process-rows');
const algorithm = document.getElementById('algorithm');
const quantum = document.getElementById('quantum');
const contextSwitch = document.getElementById('context-switch');
const errorBox = document.getElementById('error');
const output = document.getElementById('output');
const emptyState = document.getElementById('empty-state');
const status = document.getElementById('status');
const replayClock = document.getElementById('replay-clock');
const replayEvent = document.getElementById('replay-event');
const replayCounter = document.getElementById('replay-counter');
const replayScrubber = document.getElementById('replay-scrubber');
const replaySpeed = document.getElementById('replay-speed');
const replaySpeedValue = document.getElementById('replay-speed-value');
const replayRestart = document.getElementById('replay-restart');
const replayBack = document.getElementById('replay-back');
const replayPlay = document.getElementById('replay-play');
const replayPause = document.getElementById('replay-pause');
const replayForward = document.getElementById('replay-forward');
const replayView = document.getElementById('replay-view');
let replayPlayer;
let replaySubscription;
let sceneRenderer;
let replayQuantum;
let highlightedEvent = -1;

function addProcess(process) {
  const occupied = new Set(Array.from(rows.querySelectorAll('[data-field="id"]'), input => input.value));
  let number = 1;
  while (occupied.has(`P${number}`)) number++;
  const values = process || { id: `P${number}`, arrival: 0, burst: 1, priority: 1 };
  const row = document.createElement('tr');
  for (const field of ['id', 'arrival', 'burst', 'priority']) {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.dataset.field = field;
    input.type = field === 'id' ? 'text' : 'number';
    input.value = values[field];
    input.required = true;
    input.setAttribute('aria-label', `${field} for process row ${rows.children.length + 1}`);
    if (field !== 'id') {
      input.step = '1';
      input.min = field === 'priority' ? '-2147483648' : field === 'burst' ? '1' : '0';
      input.max = '2147483647';
    }
    cell.append(input);
    row.append(cell);
  }
  const action = document.createElement('td');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => { row.remove(); updateRowLabels(); });
  action.append(remove);
  row.append(action);
  rows.append(row);
  updateRowLabels();
}

function updateRowLabels() {
  Array.from(rows.children).forEach((row, index) => {
    row.querySelectorAll('input').forEach(input => {
      input.setAttribute('aria-label', `${input.dataset.field} for process row ${index + 1}`);
    });
    row.querySelector('button').setAttribute('aria-label', `Remove process row ${index + 1}`);
  });
  const count = rows.children.length;
  document.getElementById('process-count').textContent = `${count} process${count === 1 ? '' : 'es'}`;
}

function integer(input, label, minimum) {
  const value = Number(input.value);
  if (input.value.trim() === '' || !Number.isInteger(value) || value < minimum || value > 2147483647) {
    input.focus();
    throw new Error(`${label} must be a whole number from ${minimum} to 2147483647.`);
  }
  return value;
}

function collectInput() {
  const request = {
    algorithm: algorithm.value,
    quantum: integer(quantum, 'Quantum', algorithm.value === 'ACS' ? 1 : 0),
    contextSwitch: integer(contextSwitch, 'Context switch', 0),
    processes: []
  };
  if (rows.children.length === 0) throw new Error('Add at least one process.');
  const ids = new Set();
  Array.from(rows.children).forEach((row, index) => {
    const input = field => row.querySelector(`[data-field="${field}"]`);
    const id = input('id').value;
    if (!id.trim()) {
      input('id').focus();
      throw new Error(`Row ${index + 1}: process ID must not be blank.`);
    }
    if (ids.has(id)) {
      input('id').focus();
      throw new Error(`Duplicate process ID: ${id}`);
    }
    ids.add(id);
    request.processes.push({
      id,
      arrival: integer(input('arrival'), `Row ${index + 1} arrival`, 0),
      burst: integer(input('burst'), `Row ${index + 1} burst`, 1),
      priority: integer(input('priority'), `Row ${index + 1} priority`, -2147483648)
    });
  });
  return request;
}

function eventDescription(event) {
  const tier = event.tier === undefined ? '' : ` · Tier ${event.tier}`;
  switch (event.type) {
    case 'ARRIVE': return `${event.process} admitted to the queue${tier}`;
    case 'RUN': return `${event.process} runs${tier}`;
    case 'CONTEXT_SWITCH': return `Context switch: ${event.from} → ${event.to}`;
    case 'DEMOTE': return `${event.process} moves to Tier ${event.tier}`;
    case 'IDLE': return 'CPU idle';
    case 'FINISH': return `${event.process} finishes${tier}`;
    default: return event.type;
  }
}

function formatReplayTime(value) {
  const numeric = Number(value);
  if (Math.abs(numeric - Math.round(numeric)) < 0.001) return String(Math.round(numeric));
  return numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function destroyReplay() {
  replaySubscription?.();
  replaySubscription = undefined;
  replayPlayer?.destroy();
  replayPlayer = undefined;
  sceneRenderer?.destroy();
  sceneRenderer = undefined;
  highlightedEvent = -1;
}

function renderReplayState(state) {
  sceneRenderer.render(state);
  replayClock.textContent = 't = ' + formatReplayTime(state.time);
  replayCounter.textContent = 'Event ' + Math.max(0, state.eventIndex + 1) + ' of ' + state.eventCount;
  replayEvent.textContent = state.event
    ? eventDescription(state.event)
    : 'Before the first recorded event';
  replayScrubber.max = String(Math.max(state.duration, 0.01));
  replayScrubber.value = String(Math.min(state.time, Math.max(state.duration, 0.01)));
  replayScrubber.disabled = state.eventCount === 0;
  replaySpeed.value = String(state.speed);
  replaySpeedValue.value = formatReplayTime(state.speed) + 'x';
  replaySpeedValue.textContent = replaySpeedValue.value;
  replayRestart.disabled = state.eventCount === 0 ||
    (!state.playing && state.eventIndex < 0 && state.time === 0);
  replayBack.disabled = state.eventIndex < 0;
  replayPlay.disabled = state.eventCount === 0 || state.playing;
  replayPause.disabled = !state.playing;
  replayForward.disabled = state.eventIndex >= state.eventCount - 1;

  if (highlightedEvent !== state.eventIndex) {
    const eventItems = document.getElementById('events').children;
    if (highlightedEvent >= 0 && eventItems[highlightedEvent]) {
      eventItems[highlightedEvent].classList.remove('is-current');
      eventItems[highlightedEvent].removeAttribute('aria-current');
    }
    if (state.eventIndex >= 0 && eventItems[state.eventIndex]) {
      eventItems[state.eventIndex].classList.add('is-current');
      eventItems[state.eventIndex].setAttribute('aria-current', 'step');
    }
    highlightedEvent = state.eventIndex;
  }
}

function setupReplay(response, request) {
  destroyReplay();
  replayQuantum = request.quantum;
  createSelectedScene();
  const inputById = new Map(request.processes.map(process => [process.id, process]));
  const processes = response.results.map(result => {
    const input = inputById.get(result.id);
    return input ? { ...input } : { id: result.id, arrival: result.arrival, burst: 0, priority: 0 };
  });
  request.processes.forEach(process => {
    if (!processes.some(item => item.id === process.id)) processes.push({ ...process });
  });
  replayPlayer = window.SchedulerReplay.createPlayer({
    events: response.events,
    processes,
    algorithm: request.algorithm
  });
  replaySubscription = replayPlayer.subscribe(renderReplayState);
}

function createSelectedScene() {
  const options = {
    sceneRoot: document.getElementById('replay-scene'),
    ganttRoot: document.getElementById('replay-gantt'),
    quantum: replayQuantum
  };
  const note = document.getElementById('scene-view-note');
  if (replayView.value === '3d') {
    try {
      sceneRenderer = window.SchedulerScene3D.createScene3D(options);
      note.textContent = 'Drag to orbit, scroll to zoom, right-drag to pan.';
    } catch (error) {
      replayView.value = '2d';
      sceneRenderer = window.SchedulerScene2D.createScene2D(options);
      note.textContent = '3D is unavailable on this device. Showing the 2D replay.';
    }
  } else {
    sceneRenderer = window.SchedulerScene2D.createScene2D(options);
    note.textContent = 'Queue cards follow the recorded snapshots.';
  }
  options.sceneRoot.dataset.renderer = replayView.value;
  options.sceneRoot.setAttribute('aria-label', replayView.value === '3d'
    ? 'Hospital process replay' : 'Two-dimensional process replay');
}

replayView.addEventListener('change', () => {
  if (!replayPlayer) return;
  sceneRenderer?.destroy();
  createSelectedScene();
  renderReplayState(replayPlayer.getState());
});

replayRestart.addEventListener('click', () => replayPlayer?.restart());
replayBack.addEventListener('click', () => replayPlayer?.stepBackward());
replayPlay.addEventListener('click', () => replayPlayer?.play());
replayPause.addEventListener('click', () => replayPlayer?.pause());
replayForward.addEventListener('click', () => replayPlayer?.stepForward());
replaySpeed.addEventListener('input', () => replayPlayer?.setSpeed(Number(replaySpeed.value)));
replayScrubber.addEventListener('input', () => replayPlayer?.seekTime(Number(replayScrubber.value)));

function renderResponse(response, selectedAlgorithm, request) {
  const resultRows = document.getElementById('result-rows');
  resultRows.replaceChildren();
  for (const result of response.results) {
    const row = document.createElement('tr');
    for (const key of ['id', 'arrival', 'finish', 'turnaround', 'waiting', 'response']) {
      const cell = document.createElement('td');
      cell.textContent = result[key];
      row.append(cell);
    }
    resultRows.append(row);
  }
  const averages = document.getElementById('averages');
  averages.replaceChildren();
  for (const [key, label] of [
    ['turnaround', 'Avg. turnaround'], ['waiting', 'Avg. waiting'],
    ['response', 'Avg. response'], ['cpuUtilization', 'CPU utilization']
  ]) {
    const metric = document.createElement('div');
    metric.className = 'metric';
    const title = document.createElement('span');
    title.textContent = label;
    const value = document.createElement('strong');
    value.dataset.metric = key;
    value.textContent = `${response.averages[key]}${key === 'cpuUtilization' ? '%' : ''}`;
    metric.append(title, value);
    averages.append(metric);
  }
  const events = document.getElementById('events');
  events.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const event of response.events) {
    const item = document.createElement('li');
    item.dataset.type = event.type;
    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = event.end === undefined ? `t = ${event.time}` : `[${event.time}, ${event.end})`;
    const body = document.createElement('div');
    const description = document.createElement('p');
    description.textContent = eventDescription(event);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Queue snapshot';
    const snapshot = document.createElement('pre');
    snapshot.textContent = JSON.stringify(event.snapshot, null, 2);
    details.append(summary, snapshot);
    body.append(description, details);
    item.append(time, body);
    fragment.append(item);
  }
  events.append(fragment);
  document.getElementById('result-algorithm').textContent = selectedAlgorithm;
  document.getElementById('event-count').textContent = `${response.events.length} events`;
  document.getElementById('event-note').textContent = selectedAlgorithm === 'SJF'
    ? 'SJF records runs, context switches, and finishes. Its queue snapshots are empty; arrival and idle events are not recorded.'
    : 'Events appear in their recorded order. Intervals include the start time and exclude the end time.';
  emptyState.hidden = true;
  output.hidden = false;
  setupReplay(response, request);
}

function updateAlgorithmHelp() {
  const isACS = algorithm.value === 'ACS';
  quantum.min = isACS ? '1' : '0';
  document.getElementById('algorithm-help').textContent = isACS
    ? 'ACS requires a positive quantum. All times are whole simulation units.'
    : 'SJF ignores quantum and priority. Quantum may be zero. All times are whole simulation units.';
}

document.getElementById('add-process').addEventListener('click', () => addProcess());
algorithm.addEventListener('change', updateAlgorithmHelp);
let running = false;
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (running) return;
  errorBox.hidden = true;
  errorBox.textContent = '';
  destroyReplay();
  output.hidden = true;
  emptyState.hidden = false;
  let controls;
  try {
    const request = collectInput();
    running = true;
    controls = Array.from(form.querySelectorAll('input, select, button'));
    controls.forEach(control => { control.disabled = true; });
    status.textContent = 'Running…';
    form.setAttribute('aria-busy', 'true');
    const response = await window.schedulerApi.run(request);
    if (response.error) throw new Error(response.error);
    renderResponse(response, request.algorithm, request);
    status.textContent = `Completed · ${request.processes.length} processes`;
  } catch (error) {
    errorBox.textContent = error.message || 'Unable to run the scheduler.';
    errorBox.hidden = false;
    status.textContent = 'Run failed';
  } finally {
    controls?.forEach(control => { control.disabled = false; });
    form.removeAttribute('aria-busy');
    running = false;
  }
});

[
  { id: 'P1', arrival: 0, burst: 5, priority: 2 },
  { id: 'P2', arrival: 1, burst: 3, priority: 1 },
  { id: 'P3', arrival: 2, burst: 4, priority: 3 }
].forEach(addProcess);
updateAlgorithmHelp();
