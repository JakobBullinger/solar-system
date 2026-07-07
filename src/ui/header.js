/**
 * header.js — the two-control header: [✦ Explore ▾] and [◉ View ▾].
 *
 * The redesign moved the old thirteen-chip toggle row into two menus, but
 * deliberately did NOT rewire any feature: every former chip keeps its
 * element ID (#opt-tour, #opt-missions, …) and lives in the template inside
 * a menu container. Feature modules bind to those IDs exactly as before;
 * this module only owns menu open/close, keyboard/outside-click handling,
 * and reflecting the buttons' aria-pressed state onto the two controls —
 * it observes that state (MutationObserver), it never sets it.
 *
 * Menus are in-flow accordion panels (each control's menu renders below it
 * inside a right-anchored flex row), so two open menus stack side by side
 * and never overlap each other or fight over z-order.
 *
 * The physics-overlay quick toggles are proxy buttons: each one forwards
 * its click to the corresponding .vz-head inside the vizpanel drawer and
 * mirrors that head's aria-pressed, so the drawer remains the single owner
 * of the overlay state. While the drawer is open it covers the top-right
 * corner; the header slides left (body.vz-open) to stay reachable.
 */
window.ORRERY = window.ORRERY || {};

ORRERY.Header = (function () {
  'use strict';

  var units = {};   // name -> { btn, menu }

  function setOpen(name, on) {
    var u = units[name];
    if (!u) return;
    u.btn.setAttribute('aria-expanded', String(on));
    u.btn.classList.toggle('open', on);
    u.menu.classList.toggle('open', on);
    u.menu.setAttribute('aria-hidden', String(!on));
  }

  function isOpen(name) {
    return !!(units[name] && units[name].menu.classList.contains('open'));
  }

  function closeAll() {
    setOpen('explore', false);
    setOpen('view', false);
  }

  // --- Control state reflection ------------------------------------------------
  // Active states must read when the menus are closed: the Explore control
  // renames itself after the active experience; the View control carries a
  // count of enabled toggles.

  function refreshExplore() {
    var u = units.explore;
    var text = document.getElementById('hdr-explore-text');
    var pressed = u.menu.querySelectorAll('.mi[aria-pressed="true"]');
    if (pressed.length) {
      var name = pressed[0].querySelector('strong').textContent;
      text.textContent = pressed.length > 1 ? name + ' +' + (pressed.length - 1) : name;
      u.btn.classList.add('active');
    } else {
      text.textContent = 'Explore';
      u.btn.classList.remove('active');
    }
  }

  function refreshView() {
    var u = units.view;
    var count = u.menu.querySelectorAll('.vt[aria-pressed="true"]').length;
    var badge = document.getElementById('hdr-view-count');
    badge.textContent = count ? String(count) : '';
  }

  // --- Physics-overlay proxies ----------------------------------------------------

  function buildOverlayProxies() {
    var grid = document.getElementById('vt-overlays');
    var heads = document.querySelectorAll('#vizpanel .vz-row .vz-head');
    if (!heads.length) {                       // vizpanel absent: hide the section
      grid.style.display = 'none';
      var sep = grid.previousElementSibling;
      if (sep) sep.style.display = 'none';
      return;
    }
    Array.prototype.forEach.call(heads, function (head) {
      var proxy = document.createElement('button');
      proxy.className = 'vt vt-viz';
      proxy.textContent = head.querySelector('.vz-title').textContent;
      proxy.setAttribute('aria-pressed', head.getAttribute('aria-pressed') || 'false');
      proxy.addEventListener('click', function () { head.click(); });
      new MutationObserver(function () {
        proxy.setAttribute('aria-pressed', head.getAttribute('aria-pressed'));
        refreshView();
      }).observe(head, { attributes: true, attributeFilter: ['aria-pressed'] });
      grid.appendChild(proxy);
    });
  }

  // --- Keyboard -----------------------------------------------------------------

  function menuKeys(u) {
    u.menu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var items = Array.prototype.filter.call(
        u.menu.querySelectorAll('button'),
        function (b) { return b.offsetParent !== null; }
      );
      var i = items.indexOf(document.activeElement);
      if (i === -1) return;
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    });
  }

  // --- Init -----------------------------------------------------------------------

  function init() {
    units.explore = {
      btn: document.getElementById('hdr-explore'),
      menu: document.getElementById('hdr-menu-explore')
    };
    units.view = {
      btn: document.getElementById('hdr-view'),
      menu: document.getElementById('hdr-menu-view')
    };

    Object.keys(units).forEach(function (name) {
      var u = units[name];
      u.btn.addEventListener('click', function () {
        var on = !isOpen(name);
        closeAll();                        // one menu at a time on user clicks
        setOpen(name, on);
        if (on) {
          var first = u.menu.querySelector('button');
          if (first && document.activeElement === u.btn) first.focus();
        }
      });
      menuKeys(u);
    });

    // Launching an experience closes the Explore menu (the control keeps its
    // name); View items stay open — toggles are combined, not chosen.
    units.explore.menu.addEventListener('click', function (e) {
      if (e.target.closest('.mi')) setOpen('explore', false);
    });

    // Outside = the scene itself. Chrome panels (vizpanel, HUDs, the deck)
    // are siblings a user works alongside an open menu, so they don't close it.
    document.getElementById('scene').addEventListener('pointerdown', closeAll);
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Escape' && (isOpen('explore') || isOpen('view'))) {
        closeAll();
        units.explore.btn.focus();
      }
    });

    buildOverlayProxies();

    // Reflect feature state onto the controls. Features own aria-pressed on
    // their original buttons; we only watch.
    new MutationObserver(refreshExplore).observe(units.explore.menu, {
      attributes: true, attributeFilter: ['aria-pressed'], subtree: true
    });
    new MutationObserver(refreshView).observe(units.view.menu, {
      attributes: true, attributeFilter: ['aria-pressed'], subtree: true
    });
    refreshExplore();
    refreshView();

    // The right-docked drawers (info panel, vizpanel — both 340px, top:0)
    // cover the top-right corner; slide the header clear (desktop only,
    // see CSS) while either is open.
    var drawers = [document.getElementById('panel'), document.getElementById('vizpanel')]
      .filter(Boolean);
    function refreshShift() {
      var busy = drawers.some(function (d) { return d.classList.contains('open'); });
      document.body.classList.toggle('drawer-open', busy);
    }
    drawers.forEach(function (d) {
      new MutationObserver(refreshShift)
        .observe(d, { attributes: true, attributeFilter: ['class'] });
    });
    refreshShift();

    // First visit ever (and no deep link): open Explore once so the
    // experiences stay findable now that the chips are folded away.
    var seen = null;
    try { seen = localStorage.getItem('orrery-explore-shown'); } catch (e) { }
    if (!seen && !(ORRERY.Permalink && ORRERY.Permalink.hasState)) {
      try { localStorage.setItem('orrery-explore-shown', '1'); } catch (e) { }
      setTimeout(function () {
        if (!document.body.classList.contains('touring')) setOpen('explore', true);
      }, 600);
    }
  }

  return { init: init, setOpen: setOpen, isOpen: isOpen, closeAll: closeAll };
})();
