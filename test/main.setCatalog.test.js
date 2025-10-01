const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createStubElement,
  createAudioElementStub,
  stubGlobalEnvironment
} = require('./helpers/domStubs');

test('setCatalog wires the volume control to the slider background element', () => {
  const audioEl = createAudioElementStub();
  const volumeBarBg = createStubElement('volumeBarBg');
  const volumeBar = createStubElement('volumeBar');
  const volumeValue = createStubElement('volumeValue');
  const trackName = createStubElement('trackName');
  const factionName = createStubElement('factionName');
  const timeDisplay = createStubElement('timeDisplay');
  const volumeSliderContainer = createStubElement('volumeSliderContainer');

  const restore = stubGlobalEnvironment({
    elementsById: {
      volumeBarBg,
      volumeBar,
      volumeValue,
      audioPlayer: audioEl,
      trackName,
      factionName,
      timeDisplay,
      volumeSliderContainer
    }
  });

  global.window.volumeController = null;
  let capturedOptions = null;
  global.initVolumeControl = options => {
    capturedOptions = options;
    return { destroy() {} };
  };

  // Silence console output invoked during module load in the test environment
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    delete require.cache[require.resolve('../js/main.js')];
    require('../js/main.js');

    assert.strictEqual(typeof global.setCatalog, 'function');
    global.setCatalog([]);

    assert.ok(capturedOptions, 'initVolumeControl should be invoked after setting the catalog');
    assert.strictEqual(capturedOptions.bgEl, volumeBarBg, 'Volume control must target the slider background');
    assert.strictEqual(capturedOptions.audioEl, audioEl);
    assert.strictEqual(capturedOptions.barEl, volumeBar);
    assert.strictEqual(capturedOptions.labelEl, volumeValue);
  } finally {
    console.error = originalConsoleError;
    restore();
    delete global.initVolumeControl;
    delete global.setCatalog;
    delete global.volumeController;
  }
});
