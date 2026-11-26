(function (root) {
  'use strict';

  const COLORS = [0x26755a, 0x3976a8, 0x8b61a8, 0xb76a3a, 0xaf4f6c, 0x4b8c8b, 0x81713d, 0x626f93];
  const ROOMS = [
    { key: 'notArrived', title: 'Entrance', subtitle: 'Not Arrived', x: -13, color: 0xe4e9e7 },
    { key: 'tier1', title: 'Fast clinic', subtitle: 'Tier 1 / FIFO', x: -6.5, color: 0xd6eee2 },
    { key: 'cpu', title: "Doctor's room", subtitle: 'CPU / consultation', x: 0, color: 0xc8e5eb },
    { key: 'tier2', title: 'Ward', subtitle: 'Tier 2 / priority', x: 6.5, color: 0xe6dcf2 },
    { key: 'done', title: 'Exit', subtitle: 'Done', x: 13, color: 0xd4e9e3 }
  ];
  const CORRIDOR_Z = 4.1;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className || '';
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function format(value) {
    return Number(value).toFixed(2).replace(/\.?0+$/, '');
  }

  function createScene3D(options) {
    const settings = options || {};
    if (!settings.sceneRoot || !settings.ganttRoot) throw new Error('scene3d requires sceneRoot and ganttRoot.');
    const { THREE, OrbitControls, GLTFLoader, clone } = root.SchedulerThree;
    const sceneRoot = settings.sceneRoot;
    const reducedMotion = root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Gantt remains the Task 5 renderer; this scene only changes presentation.
    const chart = root.SchedulerScene2D.createScene2D({
      sceneRoot: element('div'), ganttRoot: settings.ganttRoot, ganttOnly: true
    });
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xeef3f2);
    renderer.domElement.className = 'hospital-canvas';
    renderer.domElement.setAttribute('aria-label', '3D hospital. Drag to orbit; scroll to zoom.');
    renderer.domElement.tabIndex = 0;

    const viewport = element('div', 'hospital-viewport');
    const overlay = element('div', 'hospital-labels');
    const reset = element('button', 'secondary hospital-camera-reset', 'Reset camera');
    reset.type = 'button';
    const activity = element('div', 'doctor-activity');
    const activityText = element('strong', '', 'Doctor waiting at an empty desk');
    const timerText = element('span', 'consultation-time');
    const timer = element('progress', 'consultation-timer');
    timer.max = 1;
    timer.value = 0;
    timer.setAttribute('aria-label', 'Recorded consultation progress');
    activity.append(activityText, timerText, timer);
    viewport.append(renderer.domElement, overlay, reset, activity);

    // An accessible, visible roster also exposes exact queue order when labels overlap.
    const roster = element('div', 'hospital-roster');
    const roomRecords = new Map();
    ROOMS.forEach(room => {
      const zone = element('section', 'hospital-roster-zone');
      zone.dataset.zone = room.key;
      const title = element('h3', '', room.title);
      const subtitle = element('p', 'hospital-room-subtitle', room.subtitle);
      const list = element('div', 'scene-zone-list');
      const sign = element('div', 'hospital-room-sign');
      sign.append(element('strong', '', room.title), element('span', '', room.subtitle));
      overlay.append(sign);
      zone.append(title, subtitle, list);
      roster.append(zone);
      roomRecords.set(room.key, { room, list, sign, subtitle, signPosition: new THREE.Vector3(room.x, 0, -3.6) });
    });
    sceneRoot.classList.add('is-3d');
    sceneRoot.replaceChildren(viewport, roster);

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa0b6ab, 1.7));
    const sunlight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunlight.position.set(-8, 16, 10);
    scene.add(sunlight);
    const camera = new THREE.OrthographicCamera(-18, 18, 10, -10, 0.1, 160);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minZoom = 0.6;
    controls.maxZoom = 4;
    controls.minPolarAngle = 0.2;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.target.set(0, 0, 0.7);
    camera.position.set(9, 25, 34);
    controls.update();
    controls.saveState();
    const cameraChanged = () => { dirty = true; };
    controls.addEventListener('change', cameraChanged);
    const resetCamera = () => controls.reset();
    reset.addEventListener('click', resetCamera);

    const geometries = new Set();
    const materials = new Set();
    const materialCache = new Map();
    const patients = new Map();
    const projected = new THREE.Vector3();
    let state;
    let destroyed = false;
    let dirty = true;
    let frameHandle;
    let previousFrame;
    let width = 1;
    let height = 1;
    let lastChartSignature = '';
    let frameCount = 0;
    let measureStart;

    function geometry(value) { geometries.add(value); return value; }
    function material(color, opacity) {
      const key = color + ':' + (opacity === undefined ? 1 : opacity);
      if (!materialCache.has(key)) {
        const value = new THREE.MeshLambertMaterial({ color, transparent: opacity !== undefined, opacity: opacity ?? 1 });
        materials.add(value);
        materialCache.set(key, value);
      }
      return materialCache.get(key);
    }
    const boxes = geometry(new THREE.BoxGeometry(1, 1, 1));
    const headGeometry = geometry(new THREE.SphereGeometry(0.23, 8, 6));
    const bodyGeometry = geometry(new THREE.CapsuleGeometry(0.26, 0.52, 3, 6));
    const limbGeometry = geometry(new THREE.CapsuleGeometry(0.075, 0.3, 2, 5));
    const shadowGeometry = geometry(new THREE.CircleGeometry(0.45, 12));
    const plantGeometry = geometry(new THREE.IcosahedronGeometry(0.65, 0));

    function box(x, y, z, sx, sy, sz, color) {
      const mesh = new THREE.Mesh(boxes, material(color));
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      scene.add(mesh);
      return mesh;
    }
    box(0, -0.24, 0.2, 34, 0.35, 11, 0xc7d7d0);
    box(0, -0.02, CORRIDOR_Z, 33, 0.12, 1.25, 0xf9f5e9);
    ROOMS.forEach(room => {
      box(room.x, -0.07, -0.1, 5.8, 0.18, 7, room.color);
      box(room.x, 0.01, 2.95, 2.05, 0.07, 0.75, 0xffffff);
      if (['tier1', 'cpu', 'tier2'].includes(room.key)) {
        box(room.x, 1.0, -3.5, 5.8, 2.1, 0.16, 0xf7faf8);
        box(room.x - 2.85, 0.5, -0.65, 0.15, 1.1, 5.6, 0xf7faf8);
        box(room.x + 2.85, 0.5, -0.65, 0.15, 1.1, 5.6, 0xf7faf8);
        box(room.x - 1.9, 0.48, 3.05, 1.8, 1, 0.14, 0xf7faf8);
        box(room.x + 1.9, 0.48, 3.05, 1.8, 1, 0.14, 0xf7faf8);
      }
      if (room.key === 'tier1' || room.key === 'tier2') {
        [-1.7, 0, 1.7].forEach(offset => {
          box(room.x + offset, 0.4, -2.5, 1.15, 0.12, 0.7, room.key === 'tier1' ? 0x6b9a81 : 0xa28ab7);
          box(room.x + offset, 0.75, -2.82, 1.15, 0.65, 0.1, room.key === 'tier1' ? 0x6b9a81 : 0xa28ab7);
          box(room.x + offset, 0.2, -2.5, 0.7, 0.4, 0.45, 0x91a6a0);
        });
      }
    });
    // Doctor's desk, monitor, handwashing sink, medical cross, and doorway.
    box(0.35, 0.68, -0.95, 2.05, 0.17, 0.8, 0xb49370);
    box(0.35, 0.32, -0.95, 1.6, 0.6, 0.5, 0xdce4df);
    box(0.85, 1.05, -1.05, 0.48, 0.42, 0.08, 0x304b58);
    box(0.85, 1.06, -0.999, 0.37, 0.28, 0.025, 0x91d5ba);
    box(-1.9, 0.65, -2.5, 0.9, 1.2, 0.65, 0xffffff);
    box(-1.9, 1.27, -2.5, 0.58, 0.06, 0.4, 0x85b9c7);
    box(-1.9, 1.43, -2.74, 0.07, 0.32, 0.07, 0x72868d);
    box(0, 1.45, -3.38, 0.28, 1.05, 0.07, 0xd9616b);
    box(0, 1.45, -3.38, 1.05, 0.28, 0.07, 0xd9616b);
    [-15.5, -11, 11, 15.5].forEach(x => {
      box(x, 0.26, -3, 0.65, 0.55, 0.65, 0xad9174);
      const plant = new THREE.Mesh(plantGeometry, material(0x6b9b72));
      plant.position.set(x, 1, -3);
      scene.add(plant);
    });

    function character(color, doctor) {
      const group = new THREE.Group();
      const figure = new THREE.Group();
      const torso = new THREE.Mesh(bodyGeometry, material(doctor ? 0xfafcfb : color));
      torso.position.y = 1.02;
      const head = new THREE.Mesh(headGeometry, material(0xdab08d));
      head.position.y = 1.74;
      const limbs = [];
      [-1, 1].forEach(side => {
        const leg = new THREE.Group();
        leg.position.set(side * 0.13, 0.64, 0);
        const mesh = new THREE.Mesh(limbGeometry, material(0x344c59));
        mesh.position.y = -0.26;
        leg.add(mesh);
        figure.add(leg);
        limbs.push(leg);
      });
      [-1, 1].forEach(side => {
        const arm = new THREE.Group();
        arm.position.set(side * 0.32, 1.25, 0);
        const mesh = new THREE.Mesh(limbGeometry, material(doctor ? 0xfafcfb : color));
        mesh.position.y = -0.22;
        arm.add(mesh);
        figure.add(arm);
        limbs.push(arm);
      });
      if (doctor) {
        const badge = new THREE.Mesh(boxes, material(0x65a6aa));
        badge.scale.set(0.12, 0.14, 0.05);
        badge.position.set(0.12, 1.18, 0.26);
        figure.add(badge);
      }
      figure.add(torso, head);
      const shadow = new THREE.Mesh(shadowGeometry, material(0x445f55, 0.16));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.035;
      group.add(shadow, figure);
      scene.add(group);
      return { group, figure, limbs, head, model: null, mixer: null, walkAction: null, route: [], phase: 0 };
    }
    const doctor = character(0xffffff, true);
    doctor.group.position.set(0.05, 0, -1.95);
    doctor.group.rotation.y = 0;
    const doctorLabel = element('div', 'patient-label doctor-label', 'Doctor');
    doctor.label = doctorLabel;
    overlay.append(doctorLabel);

    function ensurePatient(process, index) {
      if (patients.has(process.id)) return patients.get(process.id);
      const record = character(COLORS[index % COLORS.length], false);
      record.id = process.id;
      record.label = element('div', 'patient-label');
      record.label.dataset.process = process.id;
      record.label.title = process.id;
      record.name = element('strong', '', process.id);
      record.badge = element('span', 'patient-priority');
      record.label.append(record.name, record.badge);
      overlay.append(record.label);
      record.card = element('article', 'process-card hospital-roster-card');
      record.card.dataset.process = process.id;
      record.card.dataset.color = String(index % COLORS.length);
      record.card.append(element('strong', 'process-id', process.id), element('span', 'process-badge'));
      record.phase = index * 0.7;
      patients.set(process.id, record);
      if (patientTemplate) attachModel(record, patientTemplate);
      return record;
    }

    function queuePosition(room, index, count) {
      if (room.key === 'cpu') return new THREE.Vector3(0.2, 0, state.cpuMode === 'switching' ? 2.75 : 0.6);
      const columns = Math.min(3, Math.max(1, count));
      const rows = Math.max(1, Math.ceil(count / columns));
      const spacingZ = Math.min(1.15, 4 / rows);
      return new THREE.Vector3(room.x + (index % columns - (columns - 1) / 2) * 1.85,
        0, 1.9 - Math.floor(index / columns) * spacingZ);
    }

    function movePatient(record, room, target, animate) {
      const previousZone = record.zone;
      const changed = !record.target || record.target.distanceToSquared(target) > 0.0001;
      record.zone = room.key;
      record.label.dataset.zone = room.key;
      record.card.dataset.zone = room.key;
      if (!changed && animate) return;
      record.target = target;
      record.label.dataset.targetX = String(target.x);
      record.label.dataset.targetZ = String(target.z);
      record.route = [];
      if (!animate || reducedMotion || !previousZone) {
        record.walkAction?.stop();
        record.group.position.copy(target);
        record.group.rotation.y = room.key === 'cpu' ? Math.PI : 0;
        record.limbs.forEach(limb => { limb.rotation.x = 0; });
        record.figure.position.y = 0;
        record.label.dataset.walking = 'false';
        record.label.dataset.x = target.x.toFixed(3);
        record.label.dataset.z = target.z.toFixed(3);
        dirty = true;
        return;
      }
      const start = record.group.position.clone();
      record.route.push(start);
      if (previousZone !== room.key) {
        const previousX = roomRecords.get(previousZone).room.x;
        record.route.push(new THREE.Vector3(previousX, 0, Math.min(start.z, 2.7)));
        record.route.push(new THREE.Vector3(previousX, 0, CORRIDOR_Z));
        record.route.push(new THREE.Vector3(room.x, 0, CORRIDOR_Z));
        record.route.push(new THREE.Vector3(room.x, 0, 2.7));
      }
      record.route.push(target.clone());
      record.routeLengths = record.route.slice(1).map((point, index) => point.distanceTo(record.route[index]));
      record.routeLength = record.routeLengths.reduce((total, length) => total + length, 0);
      record.travelStart = performance.now();
      record.label.dataset.walking = 'true';
      // Travel fits inside the recorded event's presentation time; it never holds the player.
      const intervalUnits = state.event?.end === undefined ? null : state.event.end - state.time;
      record.travelDuration = Math.max(0.018, Math.min(0.36 / state.speed,
        intervalUnits === null ? 0.18 / state.speed : Math.max(0, intervalUnits) * 0.18 / state.speed));
      dirty = true;
    }

    function renderRooms(animate) {
      const clinic = roomRecords.get('tier1');
      const clinicSubtitle = state.algorithm === 'SJF' ? 'Ready / order unrecorded' : clinic.room.subtitle;
      if (clinic.subtitle.textContent !== clinicSubtitle) {
        clinic.subtitle.textContent = clinicSubtitle;
        clinic.sign.lastChild.textContent = clinicSubtitle;
      }
      const lists = {
        notArrived: state.zones.notArrived.map(id => ({ id })),
        tier1: state.zones.tier1.map(id => ({ id })),
        cpu: state.zones.cpu.map(id => ({ id })),
        tier2: state.zones.tier2,
        done: state.zones.done.map(id => ({ id }))
      };
      state.zones.waiting.forEach(id => lists.tier1.push({ id }));
      const remainingById = new Map(state.processes.map(process => [process.id, process.remaining]));
      state.processes.forEach(ensurePatient);
      roomRecords.forEach(({ room, list, sign }) => {
        const ids = lists[room.key];
        sign.dataset.count = String(ids.length);
        ids.forEach((item, index) => {
          const record = patients.get(item.id);
          movePatient(record, room, queuePosition(room, index, state.processes.length), animate);
          const priorityText = room.key === 'tier2' ? 'Priority ' + item.priority : '';
          if (record.badge.textContent !== priorityText) {
            // Priority is displayed verbatim from a snapshot; no aging is calculated here.
            const previousPriority = record.label.dataset.priority;
            record.badge.textContent = priorityText;
            record.label.classList.toggle('priority-improved', animate && previousPriority !== undefined && item.priority < Number(previousPriority));
          }
          record.badge.hidden = !priorityText;
          record.card.lastChild.textContent = priorityText || (room.key === 'done' ? 'Done' : format(remainingById.get(item.id)) + ' left');
          if (room.key === 'tier2') {
            record.label.dataset.priority = String(item.priority);
            record.card.dataset.priority = String(item.priority);
          } else {
            delete record.label.dataset.priority;
            delete record.card.dataset.priority;
            record.label.classList.remove('priority-improved');
          }
          // Preserve the snapshot's list order, including unsorted Tier 2 entries.
          const desiredCard = list.children[index];
          if (desiredCard !== record.card) list.insertBefore(record.card, desiredCard || null);
        });
      });
    }

    function render(nextState) {
      if (destroyed) return;
      const previous = state;
      state = nextState;
      const sameEvent = previous && state.eventIndex === previous.eventIndex;
      const forward = previous && state.eventIndex === previous.eventIndex + 1 &&
        state.time >= previous.time && (state.time === state.event?.time || state.playing);
      if (!sameEvent || (!state.playing && state.time !== previous.time)) {
        renderRooms(Boolean(forward));
      } else if (state.cpuMode === 'running') {
        const process = state.processes.find(item => item.id === state.event.process);
        patients.get(process.id).card.lastChild.textContent = format(process.remaining) + ' left';
      }
      activity.dataset.mode = state.cpuMode;
      const remaining = state.event?.end === undefined ? 0 : Math.max(0, state.event.end - state.time);
      const length = state.event?.end === undefined ? 0 : state.event.end - state.event.time;
      timer.value = length > 0 ? Math.min(1, (length - remaining) / length) : 0;
      timer.hidden = state.cpuMode !== 'running';
      timerText.textContent = length > 0 ? format(remaining) + ' time units left' : '';
      if (state.cpuMode === 'running') {
        activityText.textContent = 'Consultation / ' + state.event.process;
        if (state.event.tier === 1 && settings.quantum !== undefined) timerText.textContent += ' · quantum ' + settings.quantum;
      } else if (state.cpuMode === 'switching') {
        activityText.textContent = 'Washing hands / ' + state.event.from + ' → ' + state.event.to;
      } else {
        activityText.textContent = 'Doctor waiting at an empty desk';
      }
      for (const key of ['eventIndex', 'time', 'playing', 'complete', 'algorithm']) sceneRoot.dataset[key] = String(state[key]);
      const chartSignature = state.eventIndex + ':' + state.time + ':' + state.duration;
      if (chartSignature !== lastChartSignature) { chart.render(state); lastChartSignature = chartSignature; }
      dirty = true;
    }

    function updateWalk(record, timestamp, delta) {
      if (record.route.length < 2) return false;
      const elapsed = Math.max(0, timestamp - record.travelStart) / 1000;
      let distance = Math.min(1, elapsed / record.travelDuration) * record.routeLength;
      for (let index = 0; index < record.routeLengths.length; index++) {
        const length = record.routeLengths[index];
        if (distance <= length || index === record.routeLengths.length - 1) {
          const start = record.route[index];
          const end = record.route[index + 1];
          record.group.position.lerpVectors(start, end, length > 0 ? Math.min(1, distance / length) : 1);
          record.group.rotation.y = Math.atan2(end.x - start.x, end.z - start.z);
          break;
        }
        distance -= length;
      }
      if (elapsed >= record.travelDuration) {
        record.group.position.copy(record.target);
        record.route = [];
        record.group.rotation.y = record.zone === 'cpu' ? Math.PI : 0;
      }
      record.phase += delta * 18;
      const stride = record.route.length > 1 ? Math.sin(record.phase) * 0.52 : 0;
      const [leftLeg, rightLeg, leftArm, rightArm] = record.limbs;
      leftLeg.rotation.x = rightArm.rotation.x = stride;
      rightLeg.rotation.x = leftArm.rotation.x = -stride;
      record.figure.position.y = Math.abs(stride) * 0.06;
      if (record.walkAction) {
        if (record.route.length < 2) record.walkAction.stop();
        else {
          record.walkAction.play();
          record.mixer.update(delta);
        }
      }
      record.label.dataset.walking = String(record.route.length > 1);
      record.label.dataset.x = record.group.position.x.toFixed(3);
      record.label.dataset.z = record.group.position.z.toFixed(3);
      return true;
    }

    function placeLabel(label, position, lift) {
      projected.copy(position);
      projected.y += lift;
      projected.project(camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      label.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)';
      label.hidden = projected.z < -1 || projected.z > 1 || x < -100 || x > width + 100 || y < -100 || y > height + 100;
    }

    function frame(timestamp) {
      if (destroyed) return;
      const delta = previousFrame === undefined ? 0 : Math.max(0, timestamp - previousFrame) / 1000;
      previousFrame = timestamp;
      if (document.visibilityState === 'visible' && viewport.offsetWidth > 0) {
        let moved = false;
        patients.forEach(record => { moved = updateWalk(record, timestamp, delta) || moved; });
        if (state) {
          const washing = state.cpuMode === 'switching';
          const doctorX = washing ? -1.9 : 0.05;
          doctor.group.position.x += (doctorX - doctor.group.position.x) * Math.min(1, delta * 18);
          doctor.group.position.z = washing ? -1.55 : -1.95;
          doctor.group.rotation.y = washing ? Math.PI : 0;
          const gesture = washing && state.playing && !reducedMotion ? Math.sin(timestamp * 0.025) * 0.16 : 0;
          doctor.limbs[2].rotation.x = washing ? -0.9 + gesture : 0;
          doctor.limbs[3].rotation.x = washing ? -0.9 - gesture : 0;
          if (doctor.walkAction) {
            if (Math.abs(doctorX - doctor.group.position.x) > 0.02 && !reducedMotion) {
              doctor.walkAction.play();
              doctor.mixer.update(delta);
            } else doctor.walkAction.stop();
          }
        }
        if (dirty || moved || state?.playing || Math.abs(doctor.group.position.x - (state?.cpuMode === 'switching' ? -1.9 : 0.05)) > 0.002) {
          camera.updateMatrixWorld();
          patients.forEach(record => placeLabel(record.label, record.group.position, 2.28));
          roomRecords.forEach(({ sign, signPosition }) => placeLabel(sign, signPosition, 2.8));
          placeLabel(doctorLabel, doctor.group.position, 2.2);
          renderer.render(scene, camera);
          dirty = false;
          frameCount++;
          if (measureStart === undefined) measureStart = timestamp;
          if (timestamp - measureStart >= 1000) {
            sceneRoot.dataset.fps = String(Math.round(frameCount * 1000 / (timestamp - measureStart)));
            sceneRoot.dataset.drawCalls = String(renderer.info.render.calls);
            frameCount = 0;
            measureStart = timestamp;
          }
        }
      }
      frameHandle = root.requestAnimationFrame(frame);
    }

    const resizeObserver = new ResizeObserver(() => {
      width = Math.max(1, viewport.clientWidth);
      height = Math.max(1, viewport.clientHeight);
      renderer.setSize(width, height, false);
      // Fit all five rooms and overhead labels at both supported window widths and wide aspect ratios.
      const aspect = width / height;
      const halfHeight = Math.max(8, 18.5 / aspect);
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.right = halfHeight * aspect;
      camera.left = -camera.right;
      camera.updateProjectionMatrix();
      dirty = true;
    });
    resizeObserver.observe(viewport);
    frameHandle = root.requestAnimationFrame(frame);

    let patientTemplate;
    const modelResources = new Set();
    function ownModelResources(object) {
      object.traverse(node => {
        if (node.geometry) modelResources.add(node.geometry);
        const values = Array.isArray(node.material) ? node.material : [node.material];
        values.filter(Boolean).forEach(value => {
          modelResources.add(value);
          Object.values(value).forEach(property => { if (property?.isTexture) modelResources.add(property); });
        });
      });
    }
    function attachModel(record, gltf) {
      const model = clone(gltf.scene);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) return;
      const scale = 1.95 / size.y;
      const center = bounds.getCenter(new THREE.Vector3());
      const wrapper = new THREE.Group();
      model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
      wrapper.add(model);
      wrapper.scale.setScalar(scale);
      record.figure.visible = false;
      record.model = wrapper;
      record.group.add(wrapper);
      if (gltf.animations.length) {
        record.mixer = new THREE.AnimationMixer(model);
        const clip = gltf.animations.find(item => /walk/i.test(item.name));
        if (clip) record.walkAction = record.mixer.clipAction(clip);
      }
      record.label?.setAttribute('data-model', 'gltf');
      dirty = true;
    }
    async function loadModels() {
      if (settings.loadModels === false) return;
      try {
        const urls = settings.modelUrl ? [settings.modelUrl] : await root.schedulerApi?.listModels?.() || [];
        if (destroyed || !urls.length) return;
        const patientUrl = urls.find(url => /\/patient\.(glb|gltf)$/i.test(url)) ||
          urls.find(url => !/\/doctor\.(glb|gltf)$/i.test(url));
        const doctorUrl = urls.find(url => /\/doctor\.(glb|gltf)$/i.test(url));
        const loader = new GLTFLoader();
        // Try the optional files independently; failure leaves the primitive character intact.
        await Promise.allSettled([patientUrl, doctorUrl].filter(Boolean).map(async url => {
          let gltf;
          try { gltf = await loader.loadAsync(url); }
          catch { if (!destroyed) sceneRoot.dataset.modelStatus = 'primitive-fallback'; return; }
          ownModelResources(gltf.scene);
          if (destroyed) { modelResources.forEach(resource => resource.dispose()); return; }
          if (url === patientUrl) { patientTemplate = gltf; patients.forEach(record => attachModel(record, gltf)); }
          if (url === doctorUrl) attachModel(doctor, gltf);
          sceneRoot.dataset.modelStatus = 'loaded';
        }));
      } catch { if (!destroyed) sceneRoot.dataset.modelStatus = 'primitive-fallback'; }
    }
    sceneRoot.dataset.modelStatus = 'primitives';
    loadModels();

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      root.cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      reset.removeEventListener('click', resetCamera);
      controls.removeEventListener('change', cameraChanged);
      controls.dispose();
      [doctor, ...patients.values()].forEach(record => {
        record.mixer?.stopAllAction();
        if (record.mixer) record.mixer.uncacheRoot(record.mixer.getRoot());
        record.model?.traverse(node => { node.skeleton?.dispose(); });
      });
      modelResources.forEach(resource => resource.dispose());
      geometries.forEach(value => value.dispose());
      materials.forEach(value => value.dispose());
      scene.clear();
      patients.clear();
      chart.destroy();
      renderer.dispose();
      renderer.forceContextLoss();
      sceneRoot.classList.remove('is-3d');
      sceneRoot.replaceChildren();
      for (const key of ['fps', 'drawCalls', 'modelStatus']) delete sceneRoot.dataset[key];
    }

    return Object.freeze({ render, destroy });
  }

  root.SchedulerScene3D = Object.freeze({ createScene3D });
})(globalThis);
