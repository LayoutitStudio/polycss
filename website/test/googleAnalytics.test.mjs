import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { googleAnalyticsBootstrap } from '../src/googleAnalytics.mjs';

test('analytics loads only on the production hosts', () => {
  const local = runAnalyticsBootstrap('localhost');
  assert.equal(local.window['ga-disable-G-XV72TXWTM5'], true);
  assert.equal(local.appendedTags.length, 0);
  assert.equal(local.window.dataLayer, undefined);

  for (const hostname of ['polycss.com', 'www.polycss.com']) {
    const production = runAnalyticsBootstrap(hostname);
    assert.equal(production.window['ga-disable-G-XV72TXWTM5'], undefined);
    assert.equal(production.appendedTags.length, 1);
    assert.equal(production.appendedTags[0].async, true);
    assert.equal(production.appendedTags[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-XV72TXWTM5');
    assert.equal(production.window.dataLayer.length, 2);
  }
});

function runAnalyticsBootstrap(hostname) {
  const appendedTags = [];
  const window = { location: { hostname } };
  const document = {
    createElement: (tagName) => ({ tagName }),
    head: { appendChild: (tag) => appendedTags.push(tag) },
  };
  runInNewContext(googleAnalyticsBootstrap, { Date, document, encodeURIComponent, window });
  return { appendedTags, window };
}
