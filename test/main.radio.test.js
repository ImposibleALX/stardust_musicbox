const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createStubElement,
  createAudioElementStub,
  stubGlobalEnvironment
} = require('./helpers/domStubs');

test('chooseTrackStart clamps offsets for micro-duration tracks', () => {
  const audioEl = createAudioElementStub();
  const trackName = createStubElement('trackName');
  const factionName = createStubElement('factionName');
  const timeDisplay = createStubElement('timeDisplay');
  const volumeSliderContainer = createStubElement('volumeSliderContainer');
  const volumeBarBg = createStubElement('volumeBarBg');
  const volumeBar = createStubElement('volumeBar');
  const volumeValue = createStubElement('volumeValue');

  const restore = stubGlobalEnvironment({
    elementsById: {
      audioPlayer: audioEl,
      trackName,
      factionName,
      timeDisplay,
      volumeSliderContainer,
      volumeBarBg,
      volumeBar,
      volumeValue
    }
  });

  const originalConsoleError = console.error;
  console.error = () => {};

  global.initVolumeControl = () => ({ destroy() {} });

  delete require.cache[require.resolve('../js/main.js')];
  require('../js/main.js');

  const { chooseTrackStart } = global.__musicboxInternals;
  const tracks = [
    { id: 'micro', duration: 0.005, factions: ['micro'], folder: 'micro', file: 'track.ogg' }
  ];

  const result = chooseTrackStart(tracks, 0.005, 0.002);

  assert.strictEqual(result.index, 0);
  assert.strictEqual(result.offset, 0, 'offset should be clamped to zero for sub-10ms tracks');

  console.error = originalConsoleError;
  restore();
  delete global.initVolumeControl;
  delete global.setCatalog;
  delete global.volumeController;
  delete global.__musicboxInternals;
});
