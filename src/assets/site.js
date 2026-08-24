/**
 * Plain Trade Desk: the whole of the client-side behaviour.
 *
 * Everything a reader sees is already in the markup when the page arrives. This
 * file only hides and unhides what is already there, which is why the pages work
 * with JavaScript switched off and why nothing here can leave a page half-built.
 *
 * It carries no copy and no facts. Every string it puts on screen comes from a
 * data attribute the build wrote.
 *
 * One file serves two layouts. On the site the four doors are separate pages and
 * this script only filters. In the offline single file all four doors and the
 * three standing pages are in one document, and this script also switches
 * between them. It tells the two apart by counting door panels.
 */
(function () {
  'use strict';

  var doc = document;
  var panels = doc.querySelectorAll('.doorpanel');
  var single = panels.length < 2;

  function activePanel() {
    for (var i = 0; i < panels.length; i++) if (!panels[i].hidden) return panels[i];
    return null;
  }

  function tagged(el, attr, value) {
    var list = el.getAttribute(attr);
    if (!list) return true;                       // untagged means it always applies
    return (' ' + list + ' ').indexOf(' ' + value + ' ') > -1;
  }

  /* ---------- filtering ---------- */

  function apply() {
    var p = activePanel();
    if (!p) return;

    var select = p.querySelector('.sector-select');
    var sector = select ? select.value : 'all';
    var season = doc.querySelector('input[name="season"]:checked');
    var lens = doc.getElementById('familyLens');
    var withFamily = !!(lens && lens.checked);
    var isPeople = p.getAttribute('data-door') === 'people';

    var cards = p.querySelectorAll('.cards .card');
    var shownCards = 0;
    for (var i = 0; i < cards.length; i++) {
      var showCard = sector === 'all' || tagged(cards[i], 'data-sectors', sector);
      cards[i].hidden = !showCard;
      if (showCard) shownCards++;
    }

    var acts = p.querySelectorAll('.actions .action');
    var shownActs = 0;
    for (var j = 0; j < acts.length; j++) {
      var a = acts[j];
      var show = sector === 'all' || tagged(a, 'data-sectors', sector);
      if (show && isPeople) {
        if (a.getAttribute('data-family') === 'true' && !withFamily) show = false;
        else if (season && !tagged(a, 'data-seasons', season.value)) show = false;
      }
      a.hidden = !show;
      if (show) shownActs++;
    }

    var sc = p.querySelector('.shock-count');
    if (sc) sc.textContent = sc.getAttribute('data-template')
      .replace('{shown}', shownCards).replace('{total}', cards.length);
    var ac = p.querySelector('.action-count');
    if (ac) ac.textContent = ac.getAttribute(shownActs === 1 ? 'data-one' : 'data-many')
      .replace('{shown}', shownActs);

    var hint = doc.getElementById('seasonHint');
    if (hint && season) hint.textContent = season.getAttribute('data-hint') || '';
  }

  var selects = doc.querySelectorAll('.sector-select');
  for (var s = 0; s < selects.length; s++) selects[s].addEventListener('change', apply);
  var form = doc.getElementById('seasons');
  if (form) form.addEventListener('change', apply);

  /* ---------- door and standing-page switching, offline file only ---------- */

  if (!single) {
    var view = doc.getElementById('pageview');
    var desk = doc.getElementById('doorview');
    var doors = doc.querySelectorAll('.door');
    var standing = doc.querySelectorAll('.standing');
    var opening = activePanel();
    var currentDoor = opening ? opening.getAttribute('data-door') : null;

    var showDoor = function (id, scroll) {
      currentDoor = id;
      for (var i = 0; i < panels.length; i++) {
        panels[i].hidden = panels[i].getAttribute('data-door') !== id;
      }
      for (var d = 0; d < doors.length; d++) {
        doors[d].setAttribute('aria-selected',
          doors[d].getAttribute('data-door') === id ? 'true' : 'false');
      }
      view.hidden = true;
      desk.hidden = false;
      apply();
      if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    var showPage = function (id) {
      var found = false;
      for (var i = 0; i < standing.length; i++) {
        var match = standing[i].getAttribute('data-page') === id;
        standing[i].hidden = !match;
        if (match) found = true;
      }
      if (!found) return false;
      desk.hidden = true;
      view.hidden = false;
      for (var d = 0; d < doors.length; d++) doors[d].setAttribute('aria-selected', 'false');
      view.scrollIntoView({ block: 'start' });
      return true;
    };

    for (var d = 0; d < doors.length; d++) {
      doors[d].addEventListener('click', function (e) {
        e.preventDefault();
        showDoor(this.getAttribute('data-door'), true);
      });
    }
    var links = doc.querySelectorAll('.pagelink');
    for (var l = 0; l < links.length; l++) {
      links[l].addEventListener('click', function (e) {
        e.preventDefault();
        showPage(this.getAttribute('data-page'));
      });
    }
    var backs = doc.querySelectorAll('.back');
    for (var b = 0; b < backs.length; b++) {
      backs[b].addEventListener('click', function (e) {
        e.preventDefault();
        showDoor(currentDoor, false);
      });
    }
    // Everything arrives visible so that the file still reads top to bottom
    // with scripting off. The first thing this does is put it into the state the
    // prototype started in.
    showDoor(currentDoor, false);

    // Opening the file at #promise should land on that page, so that the
    // commitment page can be pointed at even inside the single file.
    var hash = (window.location.hash || '').replace('#', '');
    if (hash) showPage(hash);
  }

  apply();
})();
