(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SchedulerReplay = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (root) {
  'use strict';

  const EPSILON = 0.0001;
  const BASE_MILLISECONDS_PER_UNIT = 500;
  const INSTANT_EVENT_HOLD = 240;
  const INTERVAL_TYPES = new Set(['RUN', 'CONTEXT_SWITCH', 'IDLE']);

  function number(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function intervalEnd(event) {
    return event && event.end !== undefined ? number(event.end, number(event.time, 0)) : number(event && event.time, 0);
  }

  function addUnique(target, seen, value) {
    if (value === undefined || value === null || seen.has(value)) return;
    seen.add(value);
    target.push(value);
  }

  function processOrder(processes, events) {
    const ids = [];
    const seen = new Set();
    processes.forEach(process => addUnique(ids, seen, process.id));
    events.forEach(event => {
      const snapshot = event.snapshot || {};
      (snapshot.notArrived || []).forEach(id => addUnique(ids, seen, id));
      (snapshot.tier1 || []).forEach(id => addUnique(ids, seen, id));
      (snapshot.tier2 || []).forEach(entry => addUnique(ids, seen, entry.id));
      (snapshot.finished || []).forEach(id => addUnique(ids, seen, id));
      addUnique(ids, seen, snapshot.running);
      addUnique(ids, seen, event.process);
      addUnique(ids, seen, event.from);
      addUnique(ids, seen, event.to);
    });
    return ids;
  }

  function copySnapshot(snapshot, initialIds) {
    if (!snapshot) {
      return {
        tier1: [],
        tier2: [],
        notArrived: initialIds.slice(),
        finished: [],
        running: null
      };
    }
    return {
      tier1: (snapshot.tier1 || []).slice(),
      tier2: (snapshot.tier2 || []).map(entry => ({ id: entry.id, priority: entry.priority })),
      notArrived: (snapshot.notArrived || []).slice(),
      finished: (snapshot.finished || []).slice(),
      running: snapshot.running === undefined ? null : snapshot.running
    };
  }

  function createPlayer(options) {
    const settings = options || {};
    const events = Array.isArray(settings.events) ? settings.events.slice() : [];
    const suppliedProcesses = Array.isArray(settings.processes) ? settings.processes.slice() : [];
    const ids = processOrder(suppliedProcesses, events);
    const metadata = new Map(suppliedProcesses.map(process => [process.id, {
      id: process.id,
      burst: Math.max(0, number(process.burst, 0)),
      arrival: Math.max(0, number(process.arrival, 0)),
      priority: number(process.priority, 0)
    }]));
    ids.forEach(id => {
      if (!metadata.has(id)) metadata.set(id, { id, burst: 0, arrival: 0, priority: 0 });
    });

    const maximumTime = events.reduce((maximum, event) =>
      Math.max(maximum, number(event.time, 0), intervalEnd(event)), 0);
    const listeners = new Set();
    const requestFrame = typeof root.requestAnimationFrame === 'function'
      ? callback => root.requestAnimationFrame(callback)
      : callback => root.setTimeout(() => callback(Date.now()), 16);
    const cancelFrame = typeof root.cancelAnimationFrame === 'function'
      ? handle => root.cancelAnimationFrame(handle)
      : handle => root.clearTimeout(handle);

    let cursor = -1;
    let currentTime = 0;
    let speed = 1;
    let playing = false;
    let frameHandle;
    let lastFrame;
    let holdElapsed = 0;

    function consumedRuntime(processId) {
      let consumed = 0;
      for (let index = 0; index <= cursor; index++) {
        const event = events[index];
        if (event.type !== 'RUN' || event.process !== processId) continue;
        const start = number(event.time, 0);
        const end = intervalEnd(event);
        const visibleEnd = index < cursor ? end : Math.min(end, currentTime);
        consumed += Math.max(0, visibleEnd - start);
      }
      return consumed;
    }

    function buildState() {
      const event = cursor >= 0 ? events[cursor] : null;
      const snapshot = copySnapshot(event && event.snapshot, ids);
      const running = snapshot.running === null ? null : snapshot.running;
      const transit = event && event.type === 'CONTEXT_SWITCH' && running === null ? event.to : null;
      const occupied = new Set(snapshot.notArrived);
      snapshot.tier1.forEach(id => occupied.add(id));
      snapshot.tier2.forEach(entry => occupied.add(entry.id));
      snapshot.finished.forEach(id => occupied.add(id));
      if (running !== null) occupied.add(running);
      if (transit !== null && transit !== undefined) occupied.add(transit);
      const waiting = ids.filter(id => !occupied.has(id));

      const processes = ids.map(id => {
        const process = metadata.get(id);
        return {
          id,
          arrival: process.arrival,
          burst: process.burst,
          priority: process.priority,
          remaining: Math.max(0, process.burst - consumedRuntime(id))
        };
      });

      const intervals = [];
      for (let index = 0; index <= cursor; index++) {
        const item = events[index];
        if (!INTERVAL_TYPES.has(item.type) || item.end === undefined) continue;
        const start = number(item.time, 0);
        const end = Math.min(intervalEnd(item), currentTime);
        if (end <= start + EPSILON) continue;
        intervals.push({
          index,
          type: item.type,
          start,
          end,
          recordedEnd: intervalEnd(item),
          process: item.process,
          from: item.from,
          to: item.to
        });
      }

      return {
        algorithm: settings.algorithm || '',
        events,
        event,
        eventIndex: cursor,
        eventCount: events.length,
        time: Math.round(currentTime * 1000) / 1000,
        duration: maximumTime,
        speed,
        playing,
        complete: events.length > 0 && cursor === events.length - 1 &&
          currentTime >= maximumTime - EPSILON,
        snapshot,
        processes,
        intervals,
        cpuMode: running !== null ? 'running'
          : transit !== null && transit !== undefined ? 'switching'
            : event && event.type === 'IDLE' ? 'idle' : 'empty',
        zones: {
          notArrived: snapshot.notArrived.slice(),
          tier1: snapshot.tier1.slice(),
          cpu: running !== null ? [running]
            : transit !== null && transit !== undefined ? [transit] : [],
          tier2: snapshot.tier2.map(entry => ({ id: entry.id, priority: entry.priority })),
          done: snapshot.finished.slice(),
          waiting
        }
      };
    }

    function emit() {
      const state = buildState();
      listeners.forEach(listener => listener(state));
      return state;
    }

    function cancelScheduledFrame() {
      if (frameHandle === undefined) return;
      cancelFrame(frameHandle);
      frameHandle = undefined;
    }

    function pause(shouldEmit) {
      const changed = playing;
      playing = false;
      lastFrame = undefined;
      holdElapsed = 0;
      cancelScheduledFrame();
      if (shouldEmit !== false && changed) emit();
    }

    function restart() {
      pause(false);
      cursor = -1;
      currentTime = 0;
      emit();
    }

    function tick(timestamp) {
      if (!playing) return;
      const delta = lastFrame === undefined ? 0 : Math.min(1000, Math.max(0, timestamp - lastFrame));
      lastFrame = timestamp;
      let remainingMilliseconds = delta;
      let changed = false;
      let transitionsRemaining = events.length * 3 + 10;

      while (playing && transitionsRemaining-- > 0) {
        if (cursor < 0) {
          const first = events[0];
          if (!first) {
            playing = false;
            changed = true;
            break;
          }
          const firstTime = number(first.time, 0);
          if (currentTime + EPSILON < firstTime) {
            const millisecondsNeeded = (firstTime - currentTime) *
              BASE_MILLISECONDS_PER_UNIT / speed;
            if (remainingMilliseconds + EPSILON < millisecondsNeeded) {
              currentTime += remainingMilliseconds * speed / BASE_MILLISECONDS_PER_UNIT;
              remainingMilliseconds = 0;
              changed = delta > 0;
              break;
            }
            currentTime = firstTime;
            remainingMilliseconds = Math.max(0, remainingMilliseconds - millisecondsNeeded);
            changed = true;
          }
          cursor = 0;
          currentTime = Math.max(currentTime, firstTime);
          holdElapsed = 0;
          changed = true;
          if (remainingMilliseconds <= EPSILON) break;
          continue;
        }

        const current = events[cursor];
        const end = intervalEnd(current);
        if (current.end !== undefined && currentTime + EPSILON < end) {
          const millisecondsNeeded = (end - currentTime) * BASE_MILLISECONDS_PER_UNIT / speed;
          if (remainingMilliseconds + EPSILON < millisecondsNeeded) {
            currentTime += remainingMilliseconds * speed / BASE_MILLISECONDS_PER_UNIT;
            remainingMilliseconds = 0;
            changed = delta > 0;
            break;
          }
          currentTime = end;
          remainingMilliseconds = Math.max(0, remainingMilliseconds - millisecondsNeeded);
          changed = true;
          if (remainingMilliseconds <= EPSILON) break;
          continue;
        }

        if (cursor + 1 >= events.length) {
          playing = false;
          changed = true;
          break;
        }

        const next = events[cursor + 1];
        const nextTime = number(next.time, currentTime);
        if (currentTime + EPSILON < nextTime) {
          const millisecondsNeeded = (nextTime - currentTime) *
            BASE_MILLISECONDS_PER_UNIT / speed;
          if (remainingMilliseconds + EPSILON < millisecondsNeeded) {
            currentTime += remainingMilliseconds * speed / BASE_MILLISECONDS_PER_UNIT;
            remainingMilliseconds = 0;
            changed = delta > 0;
            break;
          }
          currentTime = nextTime;
          remainingMilliseconds = Math.max(0, remainingMilliseconds - millisecondsNeeded);
          changed = true;
          if (remainingMilliseconds <= EPSILON) break;
          continue;
        }

        const holdNeeded = Math.max(0, INSTANT_EVENT_HOLD / speed - holdElapsed);
        if (remainingMilliseconds + EPSILON < holdNeeded) {
          holdElapsed += remainingMilliseconds;
          remainingMilliseconds = 0;
          break;
        }
        remainingMilliseconds = Math.max(0, remainingMilliseconds - holdNeeded);
        holdElapsed = 0;
        cursor++;
        currentTime = Math.max(currentTime, nextTime);
        changed = true;
        if (remainingMilliseconds <= EPSILON) break;
      }

      if (changed) emit();
      if (playing) frameHandle = requestFrame(tick);
      else frameHandle = undefined;
    }

    function play() {
      if (!events.length || playing) return;
      if (cursor === events.length - 1 && currentTime >= maximumTime - EPSILON) {
        cursor = -1;
        currentTime = 0;
      }
      if (cursor < 0 && number(events[0].time, 0) <= currentTime + EPSILON) {
        cursor = 0;
        currentTime = number(events[0].time, 0);
      }
      playing = true;
      lastFrame = undefined;
      holdElapsed = 0;
      emit();
      frameHandle = requestFrame(tick);
    }

    function stepForward() {
      pause(false);
      if (cursor + 1 >= events.length) {
        emit();
        return;
      }
      cursor++;
      currentTime = number(events[cursor].time, currentTime);
      emit();
    }

    function stepBackward() {
      pause(false);
      if (cursor < 0) {
        emit();
        return;
      }
      const boundary = number(events[cursor].time, currentTime);
      cursor--;
      if (cursor < 0) currentTime = 0;
      else currentTime = Math.max(number(events[cursor].time, 0),
        Math.min(boundary, intervalEnd(events[cursor])));
      emit();
    }

    function seekTime(value) {
      pause(false);
      currentTime = clamp(number(value, 0), 0, maximumTime);
      cursor = -1;
      for (let index = 0; index < events.length; index++) {
        if (number(events[index].time, 0) <= currentTime + EPSILON) cursor = index;
        else break;
      }
      emit();
    }

    function setSpeed(value) {
      speed = clamp(number(value, 1), 0.25, 16);
      emit();
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Replay listener must be a function.');
      listeners.add(listener);
      listener(buildState());
      return () => listeners.delete(listener);
    }

    function destroy() {
      pause(false);
      listeners.clear();
    }

    return Object.freeze({
      play,
      pause: () => pause(true),
      restart,
      stepForward,
      stepBackward,
      seekTime,
      setSpeed,
      subscribe,
      getState: buildState,
      destroy
    });
  }

  return Object.freeze({ createPlayer });
});
