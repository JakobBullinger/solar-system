/**
 * challenge.test.js — ?ch= challenge-link encode/decode round trip.
 *
 * encode/decode are private to challenge.js, so the tests drive the real
 * code paths around them: onFinish() grows the "Copy challenge link" button
 * (whose title is the encoded URL), and init() decodes location.search and
 * hands the burn to Missions.replayBurn. Malformed links must be rejected
 * without ever reaching replayBurn.
 */
'use strict';

const { test, ok, eq, close } = require('./lib/harness');
const { load, makeDocument, makeElement, findByClass } = require('./lib/orrery-loader');

/** Fresh challenge module with a capturing Missions stub and a given URL. */
function boot(search, replayResult) {
  const calls = [];
  const doc = makeDocument();
  const O = load(['ui/challenge.js'], {
    document: doc,
    location: { search: search || '', origin: 'https://orrery.test', pathname: '/' },
    setup: function (ctx) {
      ctx.ORRERY = {
        Missions: {
          replayBurn: function (key, jd, vec) {
            calls.push({ key: key, jd: jd, vec: vec });
            return replayResult !== false;
          }
        }
      };
    }
  });
  return { O: O, calls: calls, doc: doc };
}

function bannerText(doc) {
  const banner = findByClass(doc.body, 'ch-banner');
  if (!banner) return null;
  const text = findByClass(banner, 'ch-text');
  return text ? text.innerHTML : null;
}

/** Encode via the real code path: the copy button's title is the link. */
function encodeViaCopyButton(d) {
  const b = boot('');
  const actions = makeElement('div');
  b.O.Challenge.onFinish({
    won: true, ghost: false, key: d.key, jd: d.jd, vec: d.vec, stars: d.stars,
    kms: 5, actions: actions
  });
  const btn = actions.children.filter(function (c) { return c.className === 'ch-copy'; })[0];
  ok(btn, 'copy-challenge-link button was injected');
  return btn.title;
}

test('encode → decode round trip preserves mission, date and burn vector', function () {
  const d = {
    key: 'jupiter-slingshot',
    jd: 2461234.6789,
    vec: { x: 0.0042317, y: -0.0088888, z: 0.0001234 },
    stars: 2
  };
  const url = encodeViaCopyButton(d);
  ok(url.indexOf('https://orrery.test/?ch=') === 0, 'link uses page origin, got ' + url);

  const b = boot(url.slice(url.indexOf('?')));
  b.O.Challenge.init();
  eq(b.calls.length, 1, 'replayBurn called exactly once');
  const c = b.calls[0];
  eq(c.key, d.key, 'mission key');
  close(c.jd, d.jd, 1e-4 + 1e-9, 'jd survives 4-decimal encoding');
  close(c.vec.x, d.vec.x, 6e-7, 'vx survives micro-AU/day quantization');
  close(c.vec.y, d.vec.y, 6e-7, 'vy');
  close(c.vec.z, d.vec.z, 6e-7, 'vz');
  ok(b.O.Challenge.replaying, 'ghost replay engaged');
  const banner = bannerText(b.doc);
  ok(banner && banner.indexOf('Beat this') !== -1, 'challenge banner shown');
  ok(banner.indexOf('★★☆') !== -1, 'star rating rendered, got: ' + banner);
});

test('negative and zero vector components round-trip too', function () {
  const d = { key: 'mars-hohmann', jd: 2460000.0001, vec: { x: -0.013, y: 0, z: -0.0000005 }, stars: 3 };
  const url = encodeViaCopyButton(d);
  const b = boot(url.slice(url.indexOf('?')));
  b.O.Challenge.init();
  eq(b.calls.length, 1);
  close(b.calls[0].vec.x, d.vec.x, 6e-7);
  close(b.calls[0].vec.y, 0, 6e-7);
  close(b.calls[0].vec.z, d.vec.z, 6e-7);
});

test('malformed links never reach replayBurn', function () {
  [
    ['?ch=', 'empty payload'],
    ['?ch=jupiter,2461000.5,100,100,100', 'five fields'],
    ['?ch=jupiter,2461000.5,100,100,100,2,9', 'seven fields'],
    ['?ch=jupiter,123,0,0,0,3', 'jd below the valid era'],
    ['?ch=jupiter,3456789,0,0,0,3', 'jd above the valid era'],
    ['?ch=jupiter,abc,0,0,0,3', 'non-numeric jd'],
    ['?ch=jupiter,2461000.5,99999999,0,0,3', 'oversized vx (>0.05 AU/day)'],
    ['?ch=jupiter,2461000.5,0,-60000,0,3', 'oversized vy'],
    ['?ch=jupiter,2461000.5,0,0,NaN,3', 'non-numeric vz'],
    ['?ch=jupiter,Infinity,0,0,0,3', 'infinite jd']
  ].forEach(function (caseDef) {
    const b = boot(caseDef[0]);
    b.O.Challenge.init();
    eq(b.calls.length, 0, 'rejected: ' + caseDef[1]);
    ok(!b.O.Challenge.replaying, 'not replaying after: ' + caseDef[1]);
    ok(!bannerText(b.doc), 'no banner after: ' + caseDef[1]);
  });
});

test('star count is clamped to 0–3 on decode', function () {
  let b = boot('?ch=jupiter,2461000.5,1000,0,0,9');
  b.O.Challenge.init();
  eq(b.calls.length, 1, 'oversized stars still a valid link');
  ok(bannerText(b.doc).indexOf('★★★') !== -1, 'stars=9 clamps to ★★★');

  b = boot('?ch=jupiter,2461000.5,1000,0,0,-2');
  b.O.Challenge.init();
  eq(b.calls.length, 1);
  ok(bannerText(b.doc).indexOf('☆☆☆') !== -1, 'stars=-2 clamps to ☆☆☆');
});

test('unknown mission key: replayBurn declines, challenge stands down', function () {
  const b = boot('?ch=no-such-mission,2461000.5,1000,0,0,2', false);
  b.O.Challenge.init();
  eq(b.calls.length, 1, 'decode passed it to Missions');
  ok(!b.O.Challenge.replaying, 'replay not engaged when Missions declines');
  ok(!bannerText(b.doc), 'no banner when Missions declines');
});

test('no ?ch= param: module boots inert', function () {
  const b = boot('?jd=2461000.5&body=saturn');
  b.O.Challenge.init();
  eq(b.calls.length, 0);
  ok(!b.O.Challenge.replaying);
});
