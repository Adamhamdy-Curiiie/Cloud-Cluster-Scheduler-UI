// Verify real Java events, WebGL movement, scene switching, and optional local glTF.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, session } = require('electron');
const { createWindow } = require('../main');
const { runJava } = require('../java-runner');

const root = path.resolve(__dirname, '..', '..');
let modelDirectory;
let window;
const evaluate = source => window.webContents.executeJavaScript(source, true);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Measure normal interactive playback even if another desktop window covers the test.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

async function waitFor(source, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(source)) return;
    await delay(80);
  }
  const diagnostics = await evaluate(`({visibility: document.visibilityState,
    viewport: document.querySelector('.hospital-viewport')?.offsetWidth,
    scene: {...document.getElementById('replay-scene').dataset},
    errors: window.testErrors})`);
  throw new Error(message + ' ' + JSON.stringify(diagnostics));
}

async function submit(request) {
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
      for (const key of ['id', 'arrival', 'burst', 'priority']) row.querySelector('[data-field="' + key + '"]').value = process[key];
    });
    document.getElementById('scheduler-form').requestSubmit();
  })()`);
  await waitFor("!document.getElementById('scheduler-form').hasAttribute('aria-busy')", 'Java run timed out');
  assert.equal(await evaluate("document.getElementById('error').hidden"), true,
    await evaluate("document.getElementById('error').textContent"));
  assert.equal(await evaluate("document.getElementById('replay-scene').dataset.renderer"), '3d', 'WebGL hospital is active');
  await evaluate("document.getElementById('replay-panel').scrollIntoView({block: 'start'})");
}

async function view(mode) {
  await evaluate(`(() => { const select = document.getElementById('replay-view'); select.value = '${mode}'; select.dispatchEvent(new Event('change')); })()`);
}

async function seek(time) {
  await evaluate(`(() => {
    const scrubber = document.getElementById('replay-scrubber');
    scrubber.value = ${Number(time)};
    scrubber.dispatchEvent(new Event('input'));
  })()`);
}

async function state() {
  return evaluate(`(() => {
    const scene = document.getElementById('replay-scene');
    const list = zone => Array.from(scene.querySelectorAll('[data-zone="' + zone + '"] .scene-zone-list .process-card'), card =>
      zone === 'tier2' ? {id: card.dataset.process, priority: Number(card.dataset.priority)} : card.dataset.process);
    return {
      index: Number(scene.dataset.eventIndex), time: Number(scene.dataset.time),
      zones: Object.fromEntries(['notArrived', 'tier1', 'cpu', 'tier2', 'done'].map(zone => [zone, list(zone)])),
      patients: Array.from(scene.querySelectorAll('.patient-label[data-process]'), label => ({
        id: label.dataset.process, zone: label.dataset.zone, priority: label.dataset.priority,
        x: Number(label.dataset.x), z: Number(label.dataset.z),
        targetX: Number(label.dataset.targetX), targetZ: Number(label.dataset.targetZ),
        walking: label.dataset.walking === 'true', visible: !label.hidden,
        badge: label.querySelector('.patient-priority').innerText,
        improved: label.classList.contains('priority-improved')
      })),
      doctor: scene.querySelector('.doctor-activity')?.dataset.mode,
      gantt: Array.from(document.querySelectorAll('#replay-gantt .gantt-item'), item => ({
        index: Number(item.dataset.index), type: item.dataset.type, start: Number(item.dataset.start),
        end: Number(item.dataset.end), recordedEnd: Number(item.dataset.recordedEnd), process: item.dataset.process || null
      }))
    };
  })()`);
}

function assertSettled(actual) {
  actual.patients.forEach(patient => {
    assert.equal(patient.walking, false, patient.id + ' completes its walk');
    assert.ok(Math.abs(patient.x - patient.targetX) < 0.003 && Math.abs(patient.z - patient.targetZ) < 0.003,
      patient.id + ' physically reaches its recorded zone');
  });
}

async function checkCamera() {
  const transform = "document.querySelector('.hospital-room-sign').style.transform";
  await waitFor(transform, 'Room labels were not projected');
  const initial = await evaluate(transform);
  const { x, y } = await evaluate(`(() => {
    const rect = document.querySelector('.hospital-canvas').getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + 110) };
  })()`);
  const mouse = (type, offset, button) => window.webContents.sendInputEvent({
    type, x: x + offset, y, button, clickCount: 1
  });
  mouse('mouseDown', 0, 'left');
  mouse('mouseMove', 75, 'left');
  mouse('mouseUp', 75, 'left');
  await waitFor(transform + ' !== ' + JSON.stringify(initial), 'Orbit did not move the projected rooms');
  await evaluate("document.querySelector('.hospital-camera-reset').click()");
  await waitFor(transform + ' === ' + JSON.stringify(initial), 'Reset did not restore the angled camera');
}

async function check() {
  await app.whenReady();
  const remoteRequests = [];
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    remoteRequests.push(details.url);
    callback({ cancel: true });
  });
  const buildDir = path.join(root, 'bin', 'ui');
  fs.mkdirSync(buildDir, { recursive: true });
  modelDirectory = fs.mkdtempSync(path.join(buildDir, 'scene3d-models-'));
  const modelFile = path.join(modelDirectory, 'patient.gltf');
  window = await createWindow({ modelDirectory });
  // The test window must receive animation frames even on an occluded desktop.
  window.webContents.setBackgroundThrottling(false);
  const errors = [];
  window.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') { errors.push(details.message); console.error(details.message); }
  });
  await evaluate("window.testErrors = []; window.addEventListener('error', e => window.testErrors.push(e.error?.stack || e.message))");
  assert.deepEqual(await evaluate('window.schedulerApi.listModels()'), [], 'Empty optional model folder');

  const tokens = fs.readFileSync(path.join(root, 'tests', 'inputs', 'tier2_context_switch.txt'), 'utf8').trim().split(/\s+/).map(Number);
  tokens.shift();
  const count = tokens.shift();
  const processes = Array.from({ length: count }, (_, index) => ({
    id: 'P' + (index + 1), arrival: tokens.shift(), burst: tokens.shift(), priority: tokens.shift()
  }));
  const request = { algorithm: 'ACS', processes, contextSwitch: tokens.shift(), quantum: tokens.shift() };
  const response = await runJava(request);
  await submit(request);
  await delay(100);
  const entrance = await state();
  assert.deepEqual(entrance.zones.notArrived, processes.map(process => process.id));
  let previousPatients = entrance.patients;
  let witnessedWalking = false;
  let witnessedAging = false;
  for (let index = 0; index < response.events.length; index++) {
    await evaluate("document.getElementById('replay-forward').click()");
    const immediate = await state();
    const event = response.events[index];
    assert.equal(immediate.index, index);
    assert.equal(immediate.time, event.time);
    assert.deepEqual(immediate.zones, {
      notArrived: event.snapshot.notArrived, tier1: event.snapshot.tier1,
      cpu: event.snapshot.running ? [event.snapshot.running] : event.type === 'CONTEXT_SWITCH' ? [event.to] : [],
      tier2: event.snapshot.tier2, done: event.snapshot.finished
    }, event.type + ': exact snapshot order and priorities');
    for (const entry of event.snapshot.tier2) {
      const label = immediate.patients.find(patient => patient.id === entry.id);
      assert.equal(label.badge, 'Priority ' + entry.priority);
      const previous = response.events[index - 1]?.snapshot.tier2.find(item => item.id === entry.id);
      if (previous && entry.priority < previous.priority) {
        assert.ok(label.improved, 'Aging highlights the improved head badge');
        witnessedAging = true;
      }
    }
    if (event.type === 'RUN') assert.equal(immediate.doctor, 'running');
    if (event.type === 'CONTEXT_SWITCH') assert.equal(immediate.doctor, 'switching');
    await delay(50);
    const inTransit = await state();
    witnessedWalking ||= inTransit.patients.some(patient => {
      const previous = previousPatients.find(item => item.id === patient.id);
      return patient.walking && (patient.x !== previous.x || patient.z !== previous.z) &&
        (patient.x !== patient.targetX || patient.z !== patient.targetZ);
    });
    await waitFor("!document.querySelector('.patient-label[data-walking=true]')", event.type + ': walk did not finish');
    const settled = await state();
    assertSettled(settled);
    previousPatients = settled.patients;
    assert.ok(settled.patients.every(patient => patient.visible), 'All patient labels are inside the default camera');
    if (event.type === 'RUN') {
      const patient = settled.patients.find(item => item.id === event.process);
      assert.equal(patient.zone, 'cpu');
      assert.ok(patient.z < 2, 'RUN patient enters the consultation room');
    }
    if (event.type === 'FINISH') assert.equal(settled.patients.find(item => item.id === event.process).zone, 'done');
  }
  assert.equal(witnessedWalking, true, 'Primitive patients use animated travel');
  assert.ok(witnessedAging, 'The fixture exercises a waiting patient gaining priority');
  const final = await state();
  const expectedGantt = response.events.map((event, index) => ({
    index, type: event.type, start: event.time, end: event.end, recordedEnd: event.end, process: event.process || null
  })).filter(event => ['RUN', 'CONTEXT_SWITCH', 'IDLE'].includes(event.type));
  assert.deepEqual(final.gantt, expectedGantt, '3D scene and Gantt finish on the same recorded intervals');
  console.log('PASS: real ACS snapshots, walking, RUN consultations, FINISH exits, priorities, and Gantt');

  await evaluate("document.getElementById('replay-back').click()");
  await delay(30);
  const backward = await state();
  assertSettled(backward);
  await view('2d');
  const flat = await state();
  assert.deepEqual(flat.zones, backward.zones, '2D switch keeps snapshot and queues');
  assert.equal(flat.time, backward.time);
  await view('3d');
  await delay(50);
  const restored = await state();
  assert.deepEqual(restored.zones, backward.zones, '3D switch keeps snapshot and queues');
  assertSettled(restored);
  await seek(10.5);
  await delay(50);
  assert.equal((await state()).time, 10.5);
  assertSettled(await state());
  await evaluate("document.getElementById('quantum').value = 99");
  await view('2d');
  await view('3d');
  assert.equal(await evaluate("document.querySelector('.consultation-time').textContent"),
    '0.5 time units left · quantum ' + request.quantum);
  assert.equal(await evaluate("document.querySelector('.consultation-timer').value"), 0.75);
  await checkCamera();
  await evaluate("document.getElementById('replay-restart').click()");
  await delay(50);
  assert.equal((await state()).index, -1);
  console.log('PASS: camera orbit/reset, recorded quantum and timer, 2D/3D toggle, scrubbing, and restart');

  const many = { algorithm: 'ACS', quantum: 2, contextSwitch: 1,
    processes: Array.from({length: 12}, (_, index) => ({id: 'P' + (index + 1), arrival: 2, burst: 8, priority: index % 4})) };
  const manyResponse = await runJava(many);
  await submit(many);
  await evaluate("document.getElementById('replay-forward').click()");
  assert.equal((await state()).doctor, 'idle', 'Recorded IDLE shows doctor waiting at an empty desk');
  const wardRun = manyResponse.events.find(event => event.type === 'RUN' && event.tier === 2);
  await seek(wardRun.time);
  await evaluate("document.getElementById('replay-play').click()");
  const performance = await evaluate(`new Promise(resolve => {
    const samples = []; let last; const start = performance.now();
    function sample(now) {
      if (last !== undefined) samples.push(now - last); last = now;
      if (now - start < 2500) requestAnimationFrame(sample);
      else {
        samples.sort((a,b) => a-b);
        const scene = document.getElementById('replay-scene');
        resolve({fps: Math.round(1000 / (samples.reduce((a,b) => a+b,0) / samples.length)),
          p95: samples[Math.floor(samples.length * .95)], renderedFps: Number(scene.dataset.fps), draws: Number(scene.dataset.drawCalls),
          patients: scene.querySelectorAll('.patient-label[data-process]').length});
      }
    } requestAnimationFrame(sample);
  })`);
  assert.equal(performance.patients, 12);
  assert.ok(performance.fps >= 59 && performance.renderedFps >= 59 && performance.draws > 0,
    '12-patient replay should sustain 60 FPS: ' + JSON.stringify(performance));
  console.log('PASS: 12-patient playback performance ' + JSON.stringify(performance));
  const playingTime = (await state()).time;
  await view('2d');
  await delay(100);
  await view('3d');
  await waitFor(`document.getElementById('replay-scene').dataset.playing === 'true' &&
    Number(document.getElementById('replay-scene').dataset.time) > ${playingTime}`,
    'Scene switches preserve ongoing playback', 5000);
  await evaluate("document.getElementById('replay-pause').click()");
  const pausedTime = (await state()).time;
  await delay(150);
  assert.equal((await state()).time, pausedTime, 'Pause freezes simulation time');
  await evaluate("(() => { const scrubber = document.getElementById('replay-scrubber'); scrubber.value = scrubber.max; scrubber.dispatchEvent(new Event('input')); })()");
  await delay(80);
  assertSettled(await state());
  assert.deepEqual((await state()).zones.done, manyResponse.events.at(-1).snapshot.finished);

  // Supply a tiny embedded, uncompressed glTF to exercise the real optional loader.
  const positions = Buffer.from(new Float32Array([0,0,0, 1,0,0, 0,2,0]).buffer);
  const model = {
    asset:{version:'2.0'}, scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0}}]}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,2,0]}],
    bufferViews:[{buffer:0,byteLength:positions.length}],
    buffers:[{byteLength:positions.length,uri:'data:application/octet-stream;base64,' + positions.toString('base64')}]
  };
  fs.writeFileSync(modelFile, JSON.stringify(model));
  // GLB stores the same mesh in a binary chunk following its padded JSON chunk.
  delete model.buffers[0].uri;
  const json = Buffer.from(JSON.stringify(model));
  const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(paddedJson);
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + paddedJson.length + positions.length, 8);
  header.writeUInt32LE(paddedJson.length, 12);
  header.write('JSON', 16);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(positions.length);
  binaryHeader.write('BIN', 4);
  const doctorFile = path.join(modelDirectory, 'doctor.glb');
  fs.writeFileSync(doctorFile, Buffer.concat([header, paddedJson, binaryHeader, positions]));
  assert.ok((await evaluate('window.schedulerApi.listModels()')).some(url => url.endsWith('/patient.gltf')));
  await view('2d');
  await view('3d');
  await waitFor("document.querySelectorAll('.patient-label[data-process][data-model=\"gltf\"]').length === 12", 'Local glTF did not replace primitives');
  await waitFor("document.querySelector('.doctor-label')?.dataset.model === 'gltf'", 'Local GLB did not replace the doctor');
  assert.equal(await evaluate("document.getElementById('replay-scene').dataset.modelStatus"), 'loaded');
  console.log('PASS: optional folder discovery, glTF patients and GLB doctor replacement');
  fs.unlinkSync(modelFile);
  fs.unlinkSync(doctorFile);
  await view('2d'); await view('3d');
  await delay(100);
  assert.equal(await evaluate("document.getElementById('replay-scene').dataset.modelStatus"), 'primitives');

  await submit({ ...many, algorithm: 'SJF', quantum: 0 });
  await seek(2.5);
  const sjf = await state();
  assert.equal(sjf.zones.tier1.length, 11);
  assert.equal(sjf.zones.cpu.length, 1);
  assert.deepEqual(sjf.zones.tier2, []);
  assert.match(await evaluate("document.querySelector('section[data-zone=tier1] .hospital-room-subtitle').textContent"), /order unrecorded/);
  assert.doesNotMatch(await evaluate("document.querySelector('.consultation-time').textContent"), /quantum/);

  // Capture the default angled hospital view with a populated clinic and ward.
  await submit(request);
  await seek(15);
  await evaluate("document.querySelector('.scene-view-toolbar').scrollIntoView({ block: 'start' })");
  await delay(200);
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.join(root, 'bin', 'ui'), {recursive: true});
  fs.writeFileSync(path.join(root, 'bin', 'ui', 'scene3d-check.png'), image.toPNG());
  assert.deepEqual(errors, [], 'Renderer console errors');
  assert.deepEqual(await evaluate('window.testErrors'), [], 'Uncaught renderer exceptions');
  assert.deepEqual(remoteRequests, [], 'Hospital replay and model loading work entirely offline');
  console.log('All Task 6 hospital window checks passed. Screenshot: bin/ui/scene3d-check.png');
}

check().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  window?.destroy();
  if (modelDirectory) {
    fs.rmSync(path.join(modelDirectory, 'patient.gltf'), { force: true });
    fs.rmSync(path.join(modelDirectory, 'doctor.glb'), { force: true });
    fs.rmdirSync(modelDirectory);
  }
  app.exit(process.exitCode || 0);
});
