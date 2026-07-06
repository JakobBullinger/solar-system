/**
 * labels.js — Screen-projected HTML labels for the planets.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Labels = (function () {
  'use strict';

  var items = [];
  var container = null;
  var visible = true;
  var v = null;

  function init(bodies, onSelect) {
    v = new THREE.Vector3();
    container = document.getElementById('labels');
    bodies.forEach(function (entry) {
      var el = document.createElement('button');
      el.className = 'planet-label' + (entry.userData.labelClass || '');
      el.textContent = entry.userData.body.name;
      el.style.setProperty('--dot', entry.userData.body.color);
      el.addEventListener('click', function () { onSelect(entry); });
      container.appendChild(el);
      items.push({ el: el, obj: entry });
    });
  }

  function setVisible(on) {
    visible = on;
    container.style.display = on ? '' : 'none';
  }

  function update(camera, width, height) {
    if (!visible) return;
    items.forEach(function (it) {
      var when = it.obj.userData.labelWhen;
      if (when && !when()) {
        it.el.style.display = 'none';
        return;
      }
      it.obj.getWorldPosition(v);
      v.project(camera);
      var behind = v.z > 1;
      if (behind || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) {
        it.el.style.display = 'none';
        return;
      }
      it.el.style.display = '';
      var x = (v.x * 0.5 + 0.5) * width;
      var y = (-v.y * 0.5 + 0.5) * height;
      it.el.style.transform =
        'translate(' + x.toFixed(1) + 'px,' + (y - 14).toFixed(1) + 'px) translate(-50%, -100%)';
    });
  }

  return { init: init, update: update, setVisible: setVisible };
})();
