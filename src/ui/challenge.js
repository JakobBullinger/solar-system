/**
 * challenge.js — Shareable mission challenges: a finished Mission Designer
 * run becomes a link.
 *
 *   ?ch=<mission>,<jd>,<vx>,<vy>,<vz>,<stars>[,<t>,<mvx>,<mvy>,<mvz>]
 *
 * encodes the departure burn (integer micro-AU/day — ~0.002 km/s precision,
 * far inside every scoring boundary), the launch date and the stars earned;
 * a run with a mid-course burn appends its time-of-flight (days after
 * departure) and Δv vector in the same encoding. Six-field links from before
 * mid-course burns decode unchanged, and single-burn runs still emit them.
 * Opening the link replays that exact flight as a ghost run — no stars are
 * banked — under a "Beat this" banner, then hands the mission over for a
 * counter-attempt. Every mission win grows a "Copy challenge link" action.
 *
 * Best runs: each mission's best winning run (burns + departure jd) is kept
 * in localStorage beside the star bank; the mission brief grows a "Watch
 * best run" action that ghost-replays your own record through the same
 * machinery. Coexists with the classic ?jd/body/rate/play + #sb= permalinks.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Challenge = (function () {
  'use strict';

  var VEC_SCALE = 1e6;      // AU/day → integer micro-AU/day
  var BEST_KEY = 'orrery-mission-best';
  var incoming = null;      // challenge decoded from the URL, if any
  var replaying = false;    // ghost flight in progress: permalink holds off
  var ownReplay = false;    // the ghost is the player's own best run
  var best = {};            // mission key → best winning run
  var els = {};

  function starStr(n) { return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n); }

  function badVec(v) {
    // No mission burn exceeds ~0.013 AU/day; anything bigger is a bad link
    return [v.x, v.y, v.z].some(function (n) { return !isFinite(n) || Math.abs(n) > 0.05; });
  }

  function packVec(f, v) {
    f.push(Math.round(v.x * VEC_SCALE), Math.round(v.y * VEC_SCALE), Math.round(v.z * VEC_SCALE));
  }

  function unpackVec(f, i) {
    return {
      x: parseFloat(f[i]) / VEC_SCALE,
      y: parseFloat(f[i + 1]) / VEC_SCALE,
      z: parseFloat(f[i + 2]) / VEC_SCALE
    };
  }

  function encode(d) {
    var f = [d.key, d.jd.toFixed(4)];
    packVec(f, d.vec);
    f.push(d.stars);
    if (d.mid) {
      f.push(d.mid.t.toFixed(1));
      packVec(f, d.mid.vec);
    }
    return f.join(',');
  }

  function decode(s) {
    var f = s.split(',');
    if (f.length !== 6 && f.length !== 10) return null;
    var jd = parseFloat(f[1]);
    var v = unpackVec(f, 2);
    var stars = parseInt(f[5], 10);
    if (!isFinite(jd) || jd < 2000000 || jd > 3000000) return null;
    if (badVec(v)) return null;
    var d = {
      key: f[0],
      jd: jd,
      vec: v,
      stars: Math.min(3, Math.max(0, isFinite(stars) ? stars : 0)),
      mid: null
    };
    if (f.length === 10) {
      var t = parseFloat(f[6]);
      var mv = unpackVec(f, 7);
      // No mission outlives 20 years; a mid-burn after that is a bad link
      if (!isFinite(t) || t <= 0 || t > 7305 || badVec(mv)) return null;
      d.mid = { t: t, vec: mv };
    }
    return d;
  }

  // ---- Best-run bank -----------------------------------------------------------
  function loadBest() {
    try { best = JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); }
    catch (e) { best = {}; }
  }

  /** A non-ghost win: keep it if it out-stars — or out-thrifts — the record. */
  function recordRun(d) {
    var b = best[d.key];
    if (b && (b.stars > d.stars || (b.stars === d.stars && b.kms <= d.kms))) return;
    best[d.key] = {
      jd: d.jd, vec: d.vec, stars: d.stars, kms: d.kms,
      mid: d.midBurn ? { t: d.midBurn.t, vec: d.midBurn.vec } : null
    };
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch (e) { }
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
    var url = link({ key: d.key, jd: d.jd, vec: d.vec, stars: d.stars, mid: d.midBurn });
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
      if (ownReplay) {
        ownReplay = false;
        banner(d.won
          ? 'Your best run: <strong>' + starStr(d.stars) + '</strong> · Δv ' +
            d.kms.toFixed(1) + ' km/s. Hit <em>Fly it again</em> — top yourself.'
          : 'Your recorded run didn’t survive the replay — fly a fresh one to set a new record.');
      } else if (d.won) {
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
    if (d.won && !d.ghost) recordRun(d);
    if (d.won) injectCopy(d);
  }

  /** Called by missions.js after every HUD render: grow the best-run action. */
  function decorate(state, mission, hud) {
    if (state !== 'brief' || !mission || !best[mission.key]) return;
    var row = hud.querySelector('.ms-actions');
    if (!row || row.querySelector('.ch-best')) return;
    var b = best[mission.key];
    var btn = document.createElement('button');
    btn.className = 'ch-best';
    btn.textContent = 'Watch best run · ' + starStr(b.stars) + ' ' + b.kms.toFixed(1) + ' km/s';
    btn.addEventListener('click', function () {
      ownReplay = true;
      replaying = ORRERY.Missions.replayBurn(mission.key, b.jd, b.vec, b.mid);
      if (!replaying) ownReplay = false;
      else banner('Replaying your best <strong>' + mission.name + '</strong> run — ' +
        starStr(b.stars) + ' · Δv ' + b.kms.toFixed(1) + ' km/s.');
    });
    row.appendChild(btn);
  }

  // ---- Boot ----------------------------------------------------------------------
  function init() {
    loadBest();
    var q = new URLSearchParams(location.search);
    if (!q.has('ch')) return;
    incoming = decode(q.get('ch'));
    if (!incoming) return;
    replaying = ORRERY.Missions.replayBurn(incoming.key, incoming.jd, incoming.vec, incoming.mid);
    if (!replaying) { incoming = null; return; }
    banner('<strong>Beat this: ' + starStr(incoming.stars) +
      '</strong> by a friend — their ' + (incoming.mid ? 'two-burn ' : '') +
      'run is replaying now.');
  }

  return {
    init: init,
    onFinish: onFinish,
    decorate: decorate,
    get replaying() { return replaying; }
  };
})();
