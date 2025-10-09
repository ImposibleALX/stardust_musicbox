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

test('setCatalog resets cached faction playlists when new data arrives', () => {
  const audioEl = createAudioElementStub();
  let pauseCalls = 0;
  audioEl.pause = () => {
    audioEl.paused = true;
    pauseCalls += 1;
  };

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

  global.window.volumeController = { destroy() {} };

  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    delete require.cache[require.resolve('../js/main.js')];
    require('../js/main.js');

    const firstCatalog = [{
      id: 'old-track',
      folder: 'old',
      file: 'song-old.mp3',
      duration: 120,
      factions: ['uncf']
    }];
    const updatedCatalog = [{
      id: 'new-track',
      folder: 'new',
      file: 'song-new.mp3',
      duration: 150,
      factions: ['uncf']
    }];

    global.setCatalog(firstCatalog);
    global.__musicboxInternals.playFaction('uncf');

    assert.ok(
      audioEl.src.endsWith('/old/song-old.mp3'),
      'Initial playback should use the original catalog entries'
    );

    audioEl.currentTime = 42;
    const pauseCallsBeforeUpdate = pauseCalls;

    global.setCatalog(updatedCatalog);

    assert.strictEqual(
      pauseCalls,
      pauseCallsBeforeUpdate + 1,
      'Audio should pause when the catalog is replaced'
    );
    assert.strictEqual(audioEl.currentTime, 0, 'Replacing the catalog should reset playback position');

    global.__musicboxInternals.playFaction('uncf');

    assert.ok(
      audioEl.src.endsWith('/new/song-new.mp3'),
      'Playback should reflect the updated catalog after cache reset'
    );
  } finally {
    console.error = originalConsoleError;
    restore();
    delete global.initVolumeControl;
    delete global.setCatalog;
    delete global.volumeController;
    delete global.__musicboxInternals;
  }
  delete require.cache[require.resolve('../js/main.js')];
  require('../js/main.js');

  assert.strictEqual(typeof global.setCatalog, 'function');
  global.setCatalog([]);

  assert.ok(capturedOptions, 'initVolumeControl should be invoked after setting the catalog');
  assert.strictEqual(capturedOptions.bgEl, volumeBarBg, 'Volume control must target the slider background');
  assert.strictEqual(capturedOptions.audioEl, audioEl);
  assert.strictEqual(capturedOptions.barEl, volumeBar);
  assert.strictEqual(capturedOptions.labelEl, volumeValue);

  console.error = originalConsoleError;
  restore();
  delete global.initVolumeControl;
  delete global.setCatalog;
});
