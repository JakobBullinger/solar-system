/**
 * permalink.js — Deep links: the address bar IS the share button.
 *
 * On load, state is applied from the URL:
 *   ?jd=2461443.5&body=encke&rate=4&play=0     clock, selection, speed
 *   #sb=x,y,z,vx,vy,vz,rrggbb;…                sandbox bodies (AU, AU/day)
 *
 * While running, the URL is rewritten (debounced, replaceState — no history
 * spam) whenever the view differs from the default, so copying the address
 * bar at any moment captures it: a comet at perihelion, a paused conjunction,
 * or a whole sandbox creation.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Permalink = (function () {
  'use strict';

  var DEFAULT_RATE = 4;
  var api = null;
  var lastUrl = null;

  function apply() {
    var q = new URLSearchParams(location.search);
    var TB = ORRERY.TimeBar;
    if (q.has('jd')) {
      var jd = parseFloat(q.get('jd'));
      if (isFinite(jd)) TB.jd = jd;
    }
    if (q.has('rate')) {
      var rate = parseFloat(q.get('rate'));
      if (isFinite(rate) && rate > 0) TB.rate = rate;
    }
    if (q.get('play') === '0') TB.playing = false;
    if (q.has('body') && api.registry[q.get('body')]) {
      api.select(api.registry[q.get('body')]);
    }

    if (location.hash.indexOf('#sb=') === 0) {
      decodeURIComponent(location.hash.slice(4)).split(';').forEach(function (s) {
        var f = s.split(',');
        if (f.length < 6) return;
        var nums = f.slice(0, 6).map(parseFloat);
        if (nums.some(function (n) { return !isFinite(n); })) return;
        ORRERY.Sandbox.addBody(
          { x: nums[0], y: nums[1], z: nums[2] },
          { x: nums[3], y: nums[4], z: nums[5] },
          f[6] ? '#' + f[6] : null
        );
      });
    }
  }

  function build() {
    var TB = ORRERY.TimeBar;
    var body = api.selectedKey();
    var sb = ORRERY.Sandbox.serialize();
    var offRate = Math.abs(TB.rate - DEFAULT_RATE) > 1e-9;

    var url = location.pathname;
    if (body || !TB.playing || offRate || sb.length) {
      var parts = ['jd=' + TB.jd.toFixed(4)];
      if (body) parts.push('body=' + body);
      if (offRate) parts.push('rate=' + (+TB.rate.toPrecision(6)));
      if (!TB.playing) parts.push('play=0');
      url += '?' + parts.join('&');
    }
    if (sb.length) {
      url += '#sb=' + sb.map(function (p) {
        return p.pos.map(function (n) { return n.toFixed(3); }).join(',') + ',' +
               p.vel.map(function (n) { return n.toFixed(6); }).join(',') + ',' +
               p.color.replace('#', '');
      }).join(';');
    }
    return url;
  }

  function write() {
    if (ORRERY.Tour.active) return;   // the tour's time-travel isn't the user's state
    var url = build();
    if (url === lastUrl) return;
    lastUrl = url;
    try {
      history.replaceState(null, '', url);
    } catch (e) { /* some contexts forbid rewriting; links still apply on load */ }
  }

  function init(hooks) {
    api = hooks;
    apply();
    setInterval(write, 1200);
  }

  return {
    init: init,
    get hasState() { return location.search !== '' || location.hash.indexOf('#sb=') === 0; }
  };
})();
