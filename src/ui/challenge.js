/**
 * challenge.js — Shareable mission challenges: a finished Mission Designer
 * run becomes a link.
 *
 *   ?ch=<mission>,<jd>,<vx>,<vy>,<vz>,<stars>
 *
 * encodes the departure burn (integer micro-AU/day — ~0.002 km/s precision,
 * far inside every scoring boundary), the launch date and the stars earned.
 * Opening the link replays that exact flight as a ghost run — no stars are
 * banked — under a "Beat this" banner, then hands the mission over for a
 * counter-attempt. Every mission win grows a "Copy challenge link" action.
 * Coexists with the classic ?jd/body/rate/play + #sb= permalinks.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Challenge = (function () {
  'use strict';

  var VEC_SCALE = 1e6;      // AU/day → integer micro-AU/day
  var incoming = null;      // challenge decoded from the URL, if any
  var replaying = false;    // ghost flight in progress: permalink holds off
  var els = {};

  function starStr(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n); }

  function encode(d) {
    return [
      d.key,
      d.jd.toFixed(4),
      Math.round(d.vec.x * VEC_SCALE),
      Math.round(d.vec.y * VEC_SCALE),
      Math.round(d.vec.z * VEC_SCALE),
      d.stars
    ].join(',');
  }

  function decode(s) {
    var f = s.split(',');
    if (f.length !== 6) return null;
    var jd = parseFloat(f[1]);
    var v = [parseFloat(f[2]), parseFloat(f[3]), parseFloat(f[4])]
      .map(function (n) { return n / VEC_SCALE; });
    var stars = parseInt(f[5], 10);
    if (!isFinite(jd) || jd < 2000000 || jd > 3000000) return null;
    // No mission burn exceeds ~0.013 AU/day; anything bigger is a bad link
    if (v.some(function (n) { return !isFinite(n) || Math.abs(n) > 0.05; })) return null;
    return {
      key: f[0],
      jd: jd,
      vec: { x: v[0], y: v[1], z: v[2] },
      stars: Math.min(3, Math.max(0, isFinite(stars) ? stars : 0))
    };
  }

  function link(d) {
    return location.origin + location.pathname + '?ch=' + encode(d);
  }

  // ---- Banner ----------------------------------------------------------------
  function banner(html) {
    if (!els.banner) {
      els.banner = document.createElement('div');
      els.banner.className = 'ch-banner';
      els.banner.innerHTML =
        '<span class="ch-text"></span><button class="ch-close" aria-label="Dismiss">✕</button>';
      els.banner.querySelector('.ch-close').addEventListener('click', function () {
        els.banner.classList.remove('show');
      });
      document.body.appendChild(els.banner);
      els.text = els.banner.querySelector('.ch-text');
    }
    els.text.innerHTML = html;
    els.banner.classList.add('show');
  }

  // ---- Copy action -------------------------------------------------------------
  function copy(text, btn) {
    function done() {
      btn.textContent = 'Link copied ✓';
      setTimeout(function () { btn.textContent = 'Copy challenge link'; }, 1600);
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta);
      if (ok) done();
      else window.prompt('Copy this challenge link:', text);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  /** Grow a "Copy challenge link" button in the result screen's action row. */
  function injectCopy(d) {
    if (!d.actions || d.actions.querySelector('.ch-copy')) return;
    var url = link({ key: d.key, jd: d.jd, vec: d.vec, stars: d.stars });
    var btn = document.createElement('button');
    btn.className = 'ch-copy';
    btn.textContent = 'Copy challenge link';
    btn.title = url;
    btn.addEventListener('click', function () { copy(url, btn); });
    d.actions.appendChild(btn);
  }

  // ---- Missions hook ------------------------------------------------------------
  /** Called by missions.js after every result screen renders. */
  function onFinish(d) {
    if (d.ghost) {
      replaying = false;
      if (d.won) {
        banner('Their run: <strong>' + starStr(d.stars) + '</strong> · Δv ' +
          d.kms.toFixed(1) + ' km/s. Hit <em>Fly it again</em> — beat it with less.');
      } else {
        banner('Their run didn’t survive the replay — the record is open. ' +
          '<em>Fly it again</em> and claim it.');
      }
    } else if (d.won && incoming && d.key === incoming.key) {
      banner(d.stars > incoming.stars
        ? 'Beaten! Your <strong>' + starStr(d.stars) + '</strong> tops their ' +
          starStr(incoming.stars) + ' — share it back.'
        : (d.stars === incoming.stars
          ? 'Matched at <strong>' + starStr(d.stars) + '</strong> — shave the Δv and share it back.'
          : 'Made it — but their ' + starStr(incoming.stars) + ' still stands over your ' +
            starStr(d.stars) + '.'));
    }
    if (d.won) injectCopy(d);
  }

  // ---- Boot ----------------------------------------------------------------------
  function init() {
    var q = new URLSearchParams(location.search);
    if (!q.has('ch')) return;
    incoming = decode(q.get('ch'));
    if (!incoming) return;
    replaying = ORRERY.Missions.replayBurn(incoming.key, incoming.jd, incoming.vec);
    if (!replaying) { incoming = null; return; }
    banner('<strong>Beat this: ' + starStr(incoming.stars) +
      '</strong> by a friend — their run is replaying now.');
  }

  return {
    init: init,
    onFinish: onFinish,
    get replaying() { return replaying; }
  };
})();
