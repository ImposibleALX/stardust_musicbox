const test = require('node:test');
const assert = require('node:assert/strict');

const { stubGlobalEnvironment } = require('./helpers/domStubs');

test('NetworkFeedback displays banner and handles online/offline status', () => {
  const restore = stubGlobalEnvironment();

  delete require.cache[require.resolve('../scripts/core/networkFeedback.js')];
  require('../scripts/core/networkFeedback.js');

  assert.ok(global.NetworkFeedback, 'NetworkFeedback should be defined globally');
  assert.strictEqual(typeof global.showNetworkNotice, 'function');
  assert.strictEqual(typeof global.hideNetworkNotice, 'function');

  // Trigger notice
  global.showNetworkNotice('Network offline test', 'warning');
  const banner = global.document.getElementById('networkFeedbackBanner');
  assert.ok(banner, 'networkFeedbackBanner element should be created');
  assert.ok(banner.classList.contains('visible'));
  assert.ok(banner.classList.contains('warning'));

  // Hide notice
  global.hideNetworkNotice();
  assert.ok(!banner.classList.contains('visible'));

  restore();
  delete global.NetworkFeedback;
  delete global.showNetworkNotice;
  delete global.hideNetworkNotice;
  delete global.isOnline;
});
