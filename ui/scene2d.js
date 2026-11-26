(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SchedulerScene2D = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (root) {
  'use strict';

  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  const zoneDefinitions = [
    { key: 'notArrived', title: 'Not Arrived', empty: 'No pending arrivals' },
    { key: 'tier1', title: 'Tier 1 queue', empty: 'Queue is empty' },
    { key: 'cpu', title: 'CPU', empty: 'CPU is clear' },
    { key: 'tier2', title: 'Tier 2 queue', empty: 'Queue is empty' },
    { key: 'done', title: 'Done', empty: 'Nothing finished yet' }
  ];

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createSvg(tag, attributes) {
    const node = document.createElementNS(SVG_NAMESPACE, tag);
    Object.entries(attributes || {}).forEach(entry => node.setAttribute(entry[0], String(entry[1])));
    return node;
  }

  function formatNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    if (Math.abs(numeric - Math.round(numeric)) < 0.001) return String(Math.round(numeric));
    return numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function niceTickStep(duration) {
    const rough = Math.max(duration / 8, 1);
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const fraction = rough / power;
    if (fraction <= 1) return power;
    if (fraction <= 2) return 2 * power;
    if (fraction <= 5) return 5 * power;
    return 10 * power;
  }

  function createScene2D(options) {
    const settings = options || {};
    if (!settings.sceneRoot || !settings.ganttRoot) {
      throw new Error('scene2d requires sceneRoot and ganttRoot.');
    }
    const sceneRoot = settings.sceneRoot;
    const ganttRoot = settings.ganttRoot;
    const reducedMotion = typeof root.matchMedia === 'function' &&
      root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const zones = new Map();
    const cards = new Map();
    let placementSignature = '';

    const board = createElement('div', 'scene-board');
    zoneDefinitions.forEach(definition => {
      const zone = createElement('section', 'scene-zone scene-zone-' + definition.key);
      zone.dataset.zone = definition.key;
      const heading = createElement('div', 'scene-zone-heading');
      const title = createElement('h3', '', definition.title);
      const count = createElement('span', 'zone-count', '0');
      heading.append(title, count);
      const status = createElement('p', 'zone-status', definition.empty);
      const list = createElement('div', 'scene-zone-list');
      const empty = createElement('p', 'zone-empty', definition.empty);
      list.append(empty);
      zone.append(heading, status, list);
      board.append(zone);
      zones.set(definition.key, { zone, title, count, status, list, empty, definition });
    });
    sceneRoot.replaceChildren(board);

    function ensureCard(id) {
      if (cards.has(id)) return cards.get(id);
      const card = createElement('article', 'process-card');
      card.dataset.process = id;
      const top = createElement('div', 'process-card-top');
      const processId = createElement('strong', 'process-id', id);
      const badge = createElement('span', 'process-badge');
      const state = createElement('span', 'process-state');
      top.append(processId, badge);
      card.append(top, state);
      cards.set(id, { card, processId, badge, state });
      return cards.get(id);
    }

    function cardStateLabel(zone, state, id) {
      if (zone === 'notArrived') return 'waiting for arrival';
      if (zone === 'tier1') {
        return state.algorithm === 'SJF' ? 'ready · order not recorded' : 'first-tier ready';
      }
      if (zone === 'tier2') return 'priority queue';
      if (zone === 'done') return 'finished';
      if (state.cpuMode === 'switching') return 'loading into CPU';
      if (state.cpuMode === 'idle') return 'CPU idle';
      return 'running now';
    }

    function updateCard(id, zone, priority, state, processMap, colorMap) {
      const record = ensureCard(id);
      const process = processMap.get(id) || { remaining: 0 };
      record.processId.textContent = id;
      record.card.dataset.zone = zone;
      record.card.dataset.color = String(colorMap.get(id) || 0);
      record.card.dataset.remaining = formatNumber(process.remaining);
      delete record.card.dataset.priority;
      if (zone === 'tier2') {
        record.badge.textContent = 'priority ' + priority;
        record.card.dataset.priority = String(priority);
      } else if (zone === 'done') {
        record.badge.textContent = 'complete';
      } else {
        record.badge.textContent = formatNumber(process.remaining) + ' left';
      }
      record.state.textContent = cardStateLabel(zone, state, id);
      return record.card;
    }

    function placementLists(state) {
      const lists = {
        notArrived: state.zones.notArrived.map(id => ({ id })),
        tier1: state.zones.tier1.map(id => ({ id })),
        cpu: state.zones.cpu.map(id => ({ id })),
        tier2: state.zones.tier2.map(entry => ({ id: entry.id, priority: entry.priority })),
        done: state.zones.done.map(id => ({ id }))
      };
      const tier1Ids = new Set(lists.tier1.map(item => item.id));
      state.zones.waiting.forEach(id => {
        if (!tier1Ids.has(id)) lists.tier1.push({ id, unrecorded: true });
      });
      return lists;
    }

    function animateMovedCards(previousRects) {
      if (reducedMotion || document.visibilityState !== 'visible' ||
          typeof Element.prototype.animate !== 'function') return;
      cards.forEach((record, id) => {
        const after = record.card.getBoundingClientRect();
        const before = previousRects.get(id);
        if (before) {
          const x = before.left - after.left;
          const y = before.top - after.top;
          if (Math.abs(x) > 1 || Math.abs(y) > 1) {
            const animation = record.card.animate([
              { transform: 'translate(' + x + 'px, ' + y + 'px)', zIndex: 3 },
              { transform: 'translate(0, 0)', zIndex: 3 }
            ], { duration: 360, easing: 'cubic-bezier(.2,.75,.25,1)' });
            root.setTimeout(() => animation.cancel(), 410);
          }
        }
      });
    }

    function renderBoard(state) {
      const lists = placementLists(state);
      const processMap = new Map(state.processes.map(process => [process.id, process]));
      const colorMap = new Map(state.processes.map((process, index) => [process.id, index % 8]));
      const nextSignature = zoneDefinitions.map(definition =>
        definition.key + ':' + lists[definition.key].map(item => item.id).join('|')).join(';');
      const placementChanged = placementSignature !== nextSignature;
      const previousRects = new Map();
      if (placementChanged) {
        cards.forEach((record, id) => previousRects.set(id, record.card.getBoundingClientRect()));
      }

      zoneDefinitions.forEach(definition => {
        const zoneRecord = zones.get(definition.key);
        const items = lists[definition.key];
        zoneRecord.count.textContent = String(items.length);
        items.forEach(item => {
          const card = updateCard(item.id, definition.key, item.priority, state, processMap, colorMap);
          if (placementChanged || card.parentElement !== zoneRecord.list) zoneRecord.list.append(card);
        });
        zoneRecord.empty.hidden = items.length !== 0;
      });

      const tier1 = zones.get('tier1');
      tier1.title.textContent = state.algorithm === 'SJF' ? 'Ready processes' : 'Tier 1 queue';
      tier1.status.textContent = state.algorithm === 'SJF'
        ? 'The SJF event schema does not expose heap order'
        : lists.tier1.length + (lists.tier1.length === 1 ? ' process queued' : ' processes queued');
      zones.get('notArrived').status.textContent = lists.notArrived.length
        ? 'Awaiting recorded admission' : 'All arrivals admitted';
      zones.get('tier2').status.textContent = lists.tier2.length
        ? 'Badges use the current snapshot priority' : 'No second-tier work';
      zones.get('done').status.textContent = lists.done.length
        ? lists.done.length + (lists.done.length === 1 ? ' process complete' : ' processes complete')
        : 'Nothing finished yet';

      const cpu = zones.get('cpu');
      if (state.cpuMode === 'running' && state.event) {
        cpu.status.textContent = state.event.process + ' running · [' +
          formatNumber(state.event.time) + ', ' + formatNumber(state.event.end) + ')';
      } else if (state.cpuMode === 'switching' && state.event) {
        cpu.status.textContent = 'Context switch · ' + state.event.from + ' → ' + state.event.to;
      } else if (state.cpuMode === 'idle' && state.event) {
        cpu.status.textContent = 'Idle · [' + formatNumber(state.event.time) + ', ' +
          formatNumber(state.event.end) + ')';
      } else {
        cpu.status.textContent = 'CPU is clear';
      }

      sceneRoot.dataset.eventIndex = String(state.eventIndex);
      sceneRoot.dataset.time = String(state.time);
      sceneRoot.dataset.playing = String(state.playing);
      sceneRoot.dataset.complete = String(state.complete);
      sceneRoot.dataset.algorithm = state.algorithm;

      if (placementChanged) {
        placementSignature = nextSignature;
        animateMovedCards(previousRects);
      }
    }

    function segmentLabel(interval) {
      if (interval.type === 'RUN') return interval.process;
      if (interval.type === 'CONTEXT_SWITCH') return 'CS';
      return 'Idle';
    }

    function segmentDescription(interval) {
      if (interval.type === 'RUN') {
        return interval.process + ' runs from ' + formatNumber(interval.start) + ' to ' +
          formatNumber(interval.recordedEnd);
      }
      if (interval.type === 'CONTEXT_SWITCH') {
        return 'Context switch from ' + interval.from + ' to ' + interval.to + ', ' +
          formatNumber(interval.start) + ' to ' + formatNumber(interval.recordedEnd);
      }
      return 'CPU idle from ' + formatNumber(interval.start) + ' to ' +
        formatNumber(interval.recordedEnd);
    }

    function renderGantt(state) {
      ganttRoot.replaceChildren();
      ganttRoot.dataset.time = String(state.time);
      ganttRoot.dataset.duration = String(state.duration);
      if (state.duration <= 0) {
        ganttRoot.append(createElement('p', 'gantt-empty', 'The recorded timeline has no elapsed interval.'));
        return;
      }

      const svg = createSvg('svg', {
        class: 'gantt-svg',
        viewBox: '0 0 1000 98',
        role: 'img',
        'aria-label': 'Gantt chart filled through time ' + formatNumber(state.time)
      });
      svg.append(createSvg('rect', {
        class: 'gantt-background', x: 0, y: 10, width: 1000, height: 42, rx: 7
      }));
      const colorByProcess = new Map(state.processes.map((process, index) => [process.id, index % 8]));

      state.intervals.forEach(interval => {
        const x = interval.start / state.duration * 1000;
        const width = Math.max(0, (interval.end - interval.start) / state.duration * 1000);
        const group = createSvg('g', { class: 'gantt-item' });
        group.dataset.index = String(interval.index);
        group.dataset.type = interval.type;
        group.dataset.start = String(interval.start);
        group.dataset.end = String(interval.end);
        group.dataset.recordedEnd = String(interval.recordedEnd);
        if (interval.process !== undefined) group.dataset.process = interval.process;
        const className = interval.type === 'RUN'
          ? 'gantt-segment gantt-run process-color-' + (colorByProcess.get(interval.process) || 0)
          : interval.type === 'CONTEXT_SWITCH'
            ? 'gantt-segment gantt-context-switch' : 'gantt-segment gantt-idle';
        const rectangle = createSvg('rect', {
          class: className, x, y: 10, width, height: 42, rx: 6
        });
        rectangle.append(createSvg('title'));
        rectangle.firstChild.textContent = segmentDescription(interval);
        group.append(rectangle);
        if (width >= 34) {
          const text = createSvg('text', {
            class: 'gantt-segment-label', x: x + width / 2, y: 36,
            'text-anchor': 'middle'
          });
          text.textContent = segmentLabel(interval);
          group.append(text);
        }
        svg.append(group);
      });

      svg.append(createSvg('line', {
        class: 'gantt-axis', x1: 0, y1: 66, x2: 1000, y2: 66
      }));
      const step = niceTickStep(state.duration);
      const ticks = [];
      for (let value = 0; value <= state.duration + 0.001; value += step) ticks.push(Math.min(value, state.duration));
      if (Math.abs(ticks[ticks.length - 1] - state.duration) > 0.001) ticks.push(state.duration);
      Array.from(new Set(ticks.map(value => Math.round(value * 1000) / 1000))).forEach(value => {
        const x = value / state.duration * 1000;
        svg.append(createSvg('line', {
          class: 'gantt-tick', x1: x, y1: 63, x2: x, y2: 71
        }));
        const label = createSvg('text', {
          class: 'gantt-tick-label', x, y: 88,
          'text-anchor': value === 0 ? 'start' : value === state.duration ? 'end' : 'middle'
        });
        label.textContent = formatNumber(value);
        svg.append(label);
      });

      const progressX = Math.min(state.time, state.duration) / state.duration * 1000;
      svg.append(createSvg('line', {
        class: 'gantt-progress', x1: progressX, y1: 4, x2: progressX, y2: 58
      }));
      ganttRoot.append(svg);
    }

    function render(state) {
      if (!settings.ganttOnly) renderBoard(state);
      renderGantt(state);
    }

    function destroy() {
      cards.forEach(record => record.card.getAnimations().forEach(animation => animation.cancel()));
      cards.clear();
      zones.clear();
      sceneRoot.replaceChildren();
      ganttRoot.replaceChildren();
    }

    return Object.freeze({ render, destroy });
  }

  return Object.freeze({ createScene2D });
});
