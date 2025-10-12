const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createStubElement,
  createAudioElementStub,
  stubGlobalEnvironment,
  createPointerEvent
} = require('./helpers/domStubs');

function loadVolumeControl() {
  delete require.cache[require.resolve('../public/scripts/core/volumeControl.js')];
  require('../public/scripts/core/volumeControl.js');
  return global.initVolumeControl;
}

test('initVolumeControl throws if required elements are missing', () => {
  const bgEl = createStubElement('volumeBarBg');
  const barEl = createStubElement('volumeBar');
  const labelEl = createStubElement('volumeValue');
  const restore = stubGlobalEnvironment();
  const initVolumeControl = loadVolumeControl();

  assert.throws(() => initVolumeControl({ audioEl: null, bgEl, barEl, labelEl }), /faltan elementos/);

  restore();
  delete global.initVolumeControl;
});

test('pointer interactions update audio volume and UI extremes correctly', async () => {
  const audioEl = createAudioElementStub();
  const bgEl = createStubElement('volumeBarBg', { top: 100, height: 120 });
  const barEl = createStubElement('volumeBar');
  const labelEl = createStubElement('volumeValue');
  const restore = stubGlobalEnvironment();
  const initVolumeControl = loadVolumeControl();

  const controller = initVolumeControl({ audioEl, bgEl, barEl, labelEl, initial: 0.5, step: 0.1 });

  const pointerDown = bgEl.listeners.pointerdown?.[0];
  assert.ok(pointerDown, 'pointerdown handler should be registered on the background element');

  // Click at the very bottom of the slider -> 0%
  pointerDown(createPointerEvent({ clientY: 220, target: bgEl, pointerId: 1 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(audioEl.volume, 0, 'audio volume should be muted when clicking at the bottom');
  assert.strictEqual(barEl.style.height, '0%');
  assert.strictEqual(labelEl.textContent, '0%');

  // Click at the very top of the slider -> 100%
  pointerDown(createPointerEvent({ clientY: 100, target: bgEl, pointerId: 2 }));
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(audioEl.volume, 1, 'audio volume should be maxed when clicking at the top');
  assert.strictEqual(barEl.style.height, '100%');
  assert.strictEqual(labelEl.textContent, '100%');

  // Mute/unmute helpers keep track of previous value
  controller.mute();
  assert.strictEqual(audioEl.volume, 0);
  controller.unmute();
  assert.ok(audioEl.volume > 0, 'unmute should restore a non-zero volume');

  restore();
  delete global.initVolumeControl;
});

test('setVolume clamps values within [0,1]', () => {
  const audioEl = createAudioElementStub();
  const bgEl = createStubElement('volumeBarBg', { top: 0, height: 100 });
  const barEl = createStubElement('volumeBar');
  const labelEl = createStubElement('volumeValue');
  const restore = stubGlobalEnvironment();
  const initVolumeControl = loadVolumeControl();

  const controller = initVolumeControl({ audioEl, bgEl, barEl, labelEl, initial: 0.5 });
  controller.setVolume(5);
  assert.strictEqual(audioEl.volume, 1);
  controller.setVolume(-3);
  assert.strictEqual(audioEl.volume, 0);

  restore();
  delete global.initVolumeControl;
});
