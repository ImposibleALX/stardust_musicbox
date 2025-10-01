const savedGlobals = () => ({
  window: global.window,
  document: global.document,
  requestAnimationFrame: global.requestAnimationFrame,
  cancelAnimationFrame: global.cancelAnimationFrame,
  performance: global.performance,
  Event: global.Event,
  getComputedStyle: global.getComputedStyle
});

function createClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach(n => set.add(n)),
    remove: (...names) => names.forEach(n => set.delete(n)),
    contains: name => set.has(name)
  };
}

function createStubElement(id, rect = { top: 0, height: 100 }) {
  let boundingRect = {
    top: rect.top ?? 0,
    height: rect.height ?? 0,
    left: rect.left ?? 0,
    width: rect.width ?? 0,
    right: rect.right ?? 0,
    bottom: rect.bottom ?? ((rect.top ?? 0) + (rect.height ?? 0))
  };
  const listeners = {};
  const element = {
    id,
    style: {},
    textContent: '',
    attributes: {},
    classList: createClassList(),
    listeners,
    getBoundingClientRect() { return { ...boundingRect }; },
    setBoundingClientRect(newRect) {
      boundingRect = { ...boundingRect, ...newRect };
    },
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    removeEventListener(type, handler) {
      const arr = listeners[type];
      if (!arr) return;
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(event) {
      event.target = event.target || element;
      (listeners[event.type] || []).forEach(fn => fn.call(element, event));
      return true;
    },
    setAttribute(name, value) { element.attributes[name] = value; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(element.attributes, name); },
    removeAttribute(name) { delete element.attributes[name]; },
    focus() {},
    blur() {},
    setPointerCapture() {},
    releasePointerCapture() {}
  };
  return element;
}

function createAudioElementStub(id = 'audioPlayer') {
  const element = createStubElement(id);
  element._events = {};
  element.volume = 1;
  element.currentTime = 0;
  element.paused = false;
  element.play = () => {
    element.paused = false;
    return Promise.resolve();
  };
  element.pause = () => {
    element.paused = true;
  };
  element.load = () => {};
  element.addEventListener = function(type, handler, options = {}) {
    const once = typeof options === 'object' && options?.once === true;
    (element._events[type] = element._events[type] || []).push({ handler, once });
  };
  element.removeEventListener = function(type, handler) {
    const arr = element._events[type];
    if (!arr) return;
    const idx = arr.findIndex(entry => entry.handler === handler);
    if (idx >= 0) arr.splice(idx, 1);
  };
  element.dispatchEvent = function(event) {
    event.target = event.target || element;
    const listeners = element._events[event.type] || [];
    for (let i = 0; i < listeners.length; i++) {
      const entry = listeners[i];
      entry.handler.call(element, event);
      if (entry.once) {
        listeners.splice(i, 1);
        i--;
      }
    }
    return true;
  };
  Object.defineProperty(element, 'ontimeupdate', {
    set(fn) {
      element._onTimeUpdate = fn;
    },
    get() {
      return element._onTimeUpdate;
    }
  });
  return element;
}

function stubGlobalEnvironment({ elementsById = {}, documentExtensions = {}, performanceNow = () => 0 } = {}) {
  const previous = savedGlobals();

  const docListeners = {};
  const documentStub = {
    body: { dataset: {} },
    getElementById(id) {
      return elementsById[id] || null;
    },
    addEventListener(type, handler) {
      (docListeners[type] = docListeners[type] || []).push(handler);
    },
    removeEventListener(type, handler) {
      const arr = docListeners[type];
      if (!arr) return;
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(event) {
      (docListeners[event.type] || []).forEach(fn => fn.call(documentStub, event));
    },
    createElement(tag) {
      return createStubElement(tag);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...documentExtensions
  };
  documentStub.__listeners = docListeners;

  global.window = global;
  global.document = documentStub;
  global.getComputedStyle = global.getComputedStyle || (() => ({ position: 'static' }));
  global.window.getComputedStyle = global.getComputedStyle;
  global.requestAnimationFrame = cb => {
    const id = setImmediate(() => cb(performanceNow()));
    return id;
  };
  global.cancelAnimationFrame = id => clearImmediate(id);
  global.performance = { now: performanceNow, timeOrigin: 0 };
  global.Event = class {
    constructor(type) {
      this.type = type;
    }
  };

  return () => {
    global.window = previous.window;
    global.document = previous.document;
    global.requestAnimationFrame = previous.requestAnimationFrame;
    global.cancelAnimationFrame = previous.cancelAnimationFrame;
    global.performance = previous.performance;
    global.Event = previous.Event;
    if (previous.window && previous.window.getComputedStyle) {
      global.getComputedStyle = previous.window.getComputedStyle;
      if (global.window) global.window.getComputedStyle = previous.window.getComputedStyle;
    } else {
      global.getComputedStyle = previous.getComputedStyle;
      if (global.window) global.window.getComputedStyle = previous.getComputedStyle;
    }
  };
}

function createPointerEvent({ type = 'pointerdown', clientY = 0, button = 0, pointerId = 1, target } = {}) {
  return {
    type,
    clientY,
    button,
    pointerId,
    target,
    preventDefault() {},
    stopPropagation() {},
    cancelable: true,
    setPointerCapture() {},
    releasePointerCapture() {}
  };
}

function flushAsyncOperations() {
  const scheduleImmediate = cb => (typeof setImmediate === 'function' ? setImmediate(cb) : setTimeout(cb, 0));

  const nextFrame = new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      scheduleImmediate(resolve);
    }
  });

  const afterMacrotask = new Promise(resolve => scheduleImmediate(resolve));

  return Promise.all([nextFrame, afterMacrotask]).then(() => undefined);
}

module.exports = {
  createStubElement,
  createAudioElementStub,
  stubGlobalEnvironment,
  createPointerEvent,
  flushAsyncOperations
};
