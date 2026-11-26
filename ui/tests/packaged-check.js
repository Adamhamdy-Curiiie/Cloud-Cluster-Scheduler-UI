// Run with standalone Node.js. Only the release executable and this file are needed.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { fileURLToPath } = require('node:url');

// This function runs inside the packaged renderer through its normal form and controls.
async function playDefaultWorkload() {
  const element = id => document.getElementById(id);
  async function waitFor(condition, message) {
    const deadline = Date.now() + 30000;
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error(message);
      await new Promise(resolve => setTimeout(resolve, 75));
    }
  }
  await waitFor(() => document.querySelectorAll('#process-rows tr').length === 3, 'Form failed to load');
  element('run').click();
  await waitFor(() => !element('output').hidden || !element('error').hidden, 'Simulation timed out');
  if (!element('error').hidden) throw new Error(element('error').textContent);
  const scene = element('replay-scene');
  if (scene.dataset.renderer !== '3d') throw new Error(element('scene-view-note').textContent);
  scene.scrollIntoView();
  element('replay-speed').value = '4';
  element('replay-speed').dispatchEvent(new Event('input'));
  element('replay-play').click();
  await waitFor(() => scene.dataset.playing === 'true' && Number(scene.dataset.time) > 0,
    '3D playback did not advance');
  await waitFor(() => scene.dataset.complete === 'true' && scene.dataset.playing === 'false',
    '3D playback did not finish');
  return {
    results: Array.from(element('result-rows').rows, row => row.cells[0].textContent),
    finished: Array.from(scene.querySelectorAll('.patient-label[data-zone="done"]'), label => label.dataset.process),
    events: element('events').children.length,
    lastEvent: Number(scene.dataset.eventIndex),
    time: Number(scene.dataset.time),
    drawCalls: Number(scene.dataset.drawCalls)
  };
}

async function check(executable, directory) {
  // Use only Windows directories for executable lookup and deliberately break development overrides.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(path|java_home|jdk_home|classpath|java_tool_options|jdk_java_options|_java_options|electron_run_as_node|node_options)$/i.test(key)) delete env[key];
  }
  const system = path.join(env.SystemRoot, 'System32');
  const javaLog = path.join(directory, 'jvm.log');
  Object.assign(env, {
    Path: [system, env.SystemRoot].join(path.delimiter), TEMP: directory, TMP: directory,
    SCHEDULER_JAVA: path.join(directory, 'missing-java.exe'), SCHEDULER_CLASSES: path.join(directory, 'missing-classes'),
    JDK_JAVA_OPTIONS: `"-Xlog:class+path=info:file=${javaLog}"`
  });
  const lookup = spawnSync(path.join(system, 'where.exe'), ['java'], { env, cwd: directory, windowsHide: true });
  if (lookup.error) throw lookup.error;
  assert.equal(lookup.status, 1, 'System java must be unavailable');

  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const endpoint = `http://127.0.0.1:${port}`;
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(directory, 'profile')}`,
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'
  ], { env, cwd: directory, windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn');
  const closed = once(child, 'exit');
  let page;
  let socket;
  try {
    const deadline = Date.now() + 90000;
    while (!page) {
      if (child.exitCode !== null) throw new Error(`App exited before opening a window (${child.exitCode})`);
      if (Date.now() >= deadline) throw new Error('Packaged application window did not open');
      const pages = await fetch(endpoint + '/json/list', { signal: AbortSignal.timeout(1500) })
        .then(response => response.json()).catch(() => []);
      page = pages.find(target => target.type === 'page' && /^file:.*\/resources\/app\.asar\/index\.html$/i.test(target.url));
      if (!page) await delay(200);
    }
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
    const response = once(socket, 'message', { signal: AbortSignal.timeout(100000) });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
      expression: `(${playDefaultWorkload.toString()})()`, awaitPromise: true, returnByValue: true
    } }));
    const reply = JSON.parse((await response)[0].data);
    if (reply.error || reply.result?.exceptionDetails) {
      throw new Error(reply.result?.exceptionDetails?.exception?.description || JSON.stringify(reply.error || reply.result));
    }
    const replay = reply.result.result.value;
    assert.deepEqual(replay.results, ['P1', 'P2', 'P3']);
    assert.deepEqual(replay.finished.sort(), replay.results);
    assert.equal(replay.events, 20);
    assert.equal(replay.lastEvent, replay.events - 1);
    assert.equal(replay.time, 17);
    assert.ok(replay.drawCalls > 0, 'The WebGL renderer must draw the 3D hospital');
    const resources = path.dirname(path.dirname(fileURLToPath(page.url)));
    const modules = path.join(resources, 'scheduler', 'runtime', 'lib', 'modules');
    const loaded = fs.readFileSync(javaLog, 'utf8').match(/bootstrap loader class path=(.+)/)?.[1];
    assert.ok(loaded, 'JVM did not record its bootstrap path');
    assert.equal(fs.realpathSync.native(loaded), fs.realpathSync.native(modules), 'JVM must load the shipped runtime');
    console.log(`PASS ${path.basename(executable)}: ${replay.results.length} processes, ${replay.events} events, 3D through t=${replay.time}, ${replay.drawCalls} draw calls.\nJVM: ${loaded}`);
  } finally {
    socket?.close();
    if (page) await fetch(endpoint + '/json/close/' + page.id, { signal: AbortSignal.timeout(2000) }).catch(() => {});
    if (child.exitCode === null && !await Promise.race([closed, delay(3000, false, { ref: false })])) {
      spawnSync(path.join(system, 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      await Promise.race([closed, delay(5000)]);
    }
  }
}

async function main() {
  const argument = process.argv[2];
  assert.ok(process.platform === 'win32' && argument && !/-setup\.exe$/i.test(argument),
    'Usage: node packaged-check.js <portable or installed app.exe>');
  const executable = fs.realpathSync(argument);
  const temp = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(temp, 'scheduler-check-'));
  try {
    await check(executable, directory);
  } finally {
    assert.equal(path.dirname(fs.realpathSync(directory)), temp);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
