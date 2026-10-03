/* EMPIRE OF GODS — keyless public demo engine.
 *
 * A self-contained "living diorama": one station room, the 13-god pantheon walking it on the sprite
 * engine (js/assets.js — atlas fork), a scripted banter director (data/banter.js), click-to-talk
 * dialogue trees (data/dialogue.js), a tiny station sim (power / morale / ambrosia) with random events
 * (data/events.js), and a 3-minute day/night cycle. There is NO backend, NO API key, NO network:
 * nothing here calls fetch/XHR/WebSocket, and the page's CSP (connect-src 'none') would refuse it if
 * anything tried. Nothing is persisted.
 */
(function () {
  'use strict';

  /* ---------- config ---------- */
  var PLAY_URL = 'empire.html';
  var PLAY_LABEL = 'Business Command';
  var GITHUB_URL = 'https://github.com/MrJ89Carrazco/empire-of-businesses-game';

  var T = 12;                                  // world tile, in world units
  var COLS = 28, ROWS = 16;
  var WW = COLS * T, WH = ROWS * T;
  var WALL_ROWS = 3;                           // top wall depth in tiles
  var SPEED = 28;                              // walk speed, world units / s
  var MAX_CONVOS = 2;
  var DAY_MS = 180000;                         // one station day = 3 minutes
  var FIRST_EVENT_MS = 20000, EVENT_MIN = 45000, EVENT_MAX = 90000, EVENT_TIMEOUT = 30000;

  var BANTER = window.EOG_BANTER;
  var DIALOGUE = window.EOG_DIALOGUE || {};
  var EVENTS = (window.EOG_EVENTS && window.EOG_EVENTS.events) || [];
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var params = new URLSearchParams(location.search);

  /* ---------- seeded RNG (?seed=N for a reproducible run) ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var seedParam = Number(params.get('seed'));
  var SEED = Number.isFinite(seedParam) && seedParam ? seedParam : (Date.now() % 2147483647);
  var rand = mulberry32(SEED);
  function rnd(a, b) { return a + rand() * (b - a); }
  function pickOne(arr) { return arr[Math.floor(rand() * arr.length)]; }
  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function bag(items) {
    var q = [];
    return function next(accept) {
      for (var tries = 0; tries < 2; tries++) {
        if (!q.length) q = shuffled(items);
        for (var i = 0; i < q.length; i++) if (!accept || accept(q[i])) return q.splice(i, 1)[0];
        q = [];
      }
      return null;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- station layout ---------- */
  var IMG = {};
  var imgsLoaded = 0;
  function img(src) {
    if (IMG[src]) return IMG[src];
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () { imgsLoaded++; staticDirty = true; };
    im.src = src;
    return (IMG[src] = im);
  }
  function ok(im) { return im && im.complete && im.naturalWidth > 0; }

  /* props: x,y,w,h = floor footprint in tiles. Art is scaled to the footprint width (x fit) and anchored
     bottom-centre; `floor` props draw under everything and never block. `anim` = frame count of the
     artgen strip <art>_anim.png (pre-rendered into offscreen canvases per resize). */
  var ANIM = { tank: 8, rack: 4, desk: 4, desk2: 4, bigscreen: 4, core: 6, jukebox: 4, arcade: 4, coffee: 4, secconsole: 4, hydro: 4 };
  var ANIM_FPS = { tank: 6, rack: 3, desk: 2, desk2: 2.5, bigscreen: 2, core: 8, jukebox: 5, arcade: 6, coffee: 3, secconsole: 1.5, hydro: 1.2 };
  var PROPS = [
    { art: 'bigscreen', x: 11, y: 0, w: 6, h: 2, wall: true, fit: 1.0 },
    { art: 'core',      x: 1,  y: 3, w: 1, h: 1, fit: 1.3, light: '90,208,255' },
    { art: 'core',      x: 26, y: 3, w: 1, h: 1, fit: 1.3, light: '90,208,255' },
    { art: 'telescope', x: 3,  y: 3, w: 1, h: 1, fit: 1.25 },
    { art: 'rack',      x: 6,  y: 3, w: 2, h: 1 },
    { art: 'tank',      x: 9,  y: 3, w: 2, h: 1, light: '80,170,255' },
    { art: 'hydro',     x: 13, y: 3, w: 2, h: 1, light: '200,120,255' },
    { art: 'coffee',    x: 17, y: 3, w: 1, h: 1, fit: 1.4 },
    { art: 'rack',      x: 20, y: 3, w: 2, h: 1 },
    { art: 'secconsole', x: 23, y: 3, w: 2, h: 1, light: '255,90,74' },
    { art: 'desk',      x: 2,  y: 5, w: 3, h: 2, light: '90,208,255' },
    { art: 'chair',     x: 3,  y: 7, w: 1, h: 1, fit: 1.2 },
    { art: 'desk2',     x: 23, y: 5, w: 3, h: 2, light: '255,95,168' },
    { art: 'chair',     x: 24, y: 7, w: 1, h: 1, fit: 1.2 },
    { art: 'holotable', x: 11, y: 7, w: 5, h: 2 },
    { art: 'rug',       x: 3,  y: 10, w: 6, h: 4, floor: true },
    { art: 'couch',     x: 4,  y: 12, w: 4, h: 2 },
    { art: 'plant',     x: 1,  y: 13, w: 1, h: 1, fit: 1.3 },
    { art: 'bar',       x: 13, y: 13, w: 4, h: 1 },
    { art: 'jukebox',   x: 20, y: 12, w: 2, h: 2, light: '255,95,168' },
    { art: 'arcade',    x: 23, y: 12, w: 2, h: 2, light: '90,120,255' },
    { art: 'crate',     x: 26, y: 13, w: 1, h: 1, fit: 1.2 },
    { art: 'boxes',     x: 26, y: 11, w: 1, h: 1, fit: 1.4 },
    { art: 'plant',     x: 9,  y: 13, w: 1, h: 1, fit: 1.3 },
  ];
  PROPS.forEach(function (p) {
    if (ANIM[p.art]) { p.n = ANIM[p.art]; p.fps = ANIM_FPS[p.art]; }
    p.ph = rand() * 10;
  });
  var HOLO = PROPS.filter(function (p) { return p.art === 'holotable'; })[0];
  var HOLO_STRIP = null, FLOOR = null, WALL = null, GRIME = null;
  /* Prop + texture images are requested only AFTER the god atlases are queued: a static server answers
     requests roughly in order, and 36 small prop files ahead of the sheets delayed every god by seconds. */
  function loadPropImages() {
    FLOOR = img('assets/industrial/floor.png');
    WALL = img('assets/industrial/wall.png');
    GRIME = img('assets/industrial/grime.png');
    PROPS.forEach(function (p) {
      p.im = img('assets/furniture/' + p.art + '.png');
      if (p.n) p.strip = img('assets/furniture/' + p.art + '_anim.png');
    });
    HOLO_STRIP = img('assets/furniture/holo_anim.png');
  }

  /* walkable grid: floor is cols 1..COLS-2, rows WALL_ROWS..ROWS-2 */
  var blocked = [];
  for (var gy = 0; gy < ROWS; gy++) {
    blocked.push([]);
    for (var gx = 0; gx < COLS; gx++) blocked[gy].push(gx < 1 || gx > COLS - 2 || gy < WALL_ROWS || gy > ROWS - 2);
  }
  PROPS.forEach(function (p) {
    if (p.floor || p.wall) return;
    for (var y = p.y; y < p.y + p.h; y++) for (var x = p.x; x < p.x + p.w; x++) if (blocked[y]) blocked[y][x] = true;
  });
  function free(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS && !blocked[y][x]; }
  var FREE = [];
  for (var fy = 0; fy < ROWS; fy++) for (var fx = 0; fx < COLS; fx++) if (free(fx, fy)) FREE.push([fx, fy]);

  function tileCenter(tx, ty) { return { x: (tx + 0.5) * T, y: (ty + 0.5) * T + 3 }; }
  function tileOf(px, py) { return [clamp(Math.floor(px / T), 0, COLS - 1), clamp(Math.floor((py - 3) / T), 0, ROWS - 1)]; }
  function nearestFree(t) {
    var best = FREE[0], bd = 1e9;
    FREE.forEach(function (f) { var d = (f[0] - t[0]) * (f[0] - t[0]) + (f[1] - t[1]) * (f[1] - t[1]); if (d < bd) { bd = d; best = f; } });
    return best;
  }

  /* BFS on the tile grid (8-way, no corner cutting) -> list of world waypoints */
  function findPath(from, to) {
    if (!free(to[0], to[1])) return null;
    var key = function (x, y) { return y * COLS + x; };
    var prev = new Map(); prev.set(key(from[0], from[1]), -1);
    var q = [from], qi = 0;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (qi < q.length) {
      var c = q[qi++];
      if (c[0] === to[0] && c[1] === to[1]) break;
      for (var i = 0; i < dirs.length; i++) {
        var nx = c[0] + dirs[i][0], ny = c[1] + dirs[i][1];
        if (!free(nx, ny) || prev.has(key(nx, ny))) continue;
        if (dirs[i][0] && dirs[i][1] && (!free(c[0] + dirs[i][0], c[1]) || !free(c[0], c[1] + dirs[i][1]))) continue;
        prev.set(key(nx, ny), key(c[0], c[1]));
        q.push([nx, ny]);
      }
    }
    if (!prev.has(key(to[0], to[1]))) return null;
    var out = [], k = key(to[0], to[1]);
    while (k !== -1) { out.push(tileCenter(k % COLS, Math.floor(k / COLS))); k = prev.get(k); }
    out.reverse();
    out.shift();
    return out;
  }

  /* ---------- the crew ---------- */
  var CAST = {};
  var bodies = [];
  var NIGHT_OWLS = { artemis: true };          // awake at night, asleep (on shift-off) by day
  BANTER.cast.forEach(function (c, i) {
    CAST[c.id] = c;
    DATA.AGENT[c.id] = { id: c.id, color: c.color };
    var home = nearestFree(c.home || pickOne(FREE));
    var start = home;
    for (var k = 0; k < 8; k++) {   // spawn near home, not stacked on it
      var cand = [home[0] + Math.round(rnd(-3, 3)), home[1] + Math.round(rnd(-2, 2))];
      if (free(cand[0], cand[1])) { start = cand; break; }
    }
    var p = tileCenter(start[0], start[1]);
    bodies.push({
      id: c.id, skin: c.skin, cast: c, home: home,
      px: p.x, py: p.y, dir: pickOne(['south', 'east', 'west']), state: 'idle',
      odo: 0, faceA: null, aph: rnd(0, Math.PI * 2), phase: i,
      speaking: false, path: null, idleUntil: rnd(300, 2500), pace: rnd(0.9, 1.12),
      convo: null, arrived: true, wantDir: null, mood: 0, loaded: false, sleeping: false, goingToBed: false
    });
  });
  var byId = {};
  bodies.forEach(function (b) { byId[b.id] = b; });
  var PAIRS = {};
  (BANTER.pairs || []).forEach(function (p) { PAIRS[p.a + '|' + p.b] = PAIRS[p.b + '|' + p.a] = p; });

  function walkTo(b, tile, faceDir) {
    var path = findPath(tileOf(b.px, b.py), tile);
    if (!path) return false;
    b.path = path; b.state = path.length ? 'walk' : 'idle'; b.arrived = !path.length; b.wantDir = faceDir || null;
    if (!path.length && faceDir) b.dir = faceDir;
    return true;
  }
  function awake(b) { return !b.sleeping && !b.goingToBed; }
  function available(b) { return b.loaded && awake(b) && !b.convo && !b.inDialog && !(b.emote && b.emote.until > clock.now); }

  function stepBody(b, dt, now) {
    if (b.inDialog) return;
    if (b.state === 'walk' && b.path && b.path.length) {
      var tgt = b.path[0];
      var dx = tgt.x - b.px, dy = tgt.y - b.py, d = Math.hypot(dx, dy);
      var step = SPEED * b.pace * (1 + 0.04 * b.mood) * dt;
      if (d <= step) { b.px = tgt.x; b.py = tgt.y; b.odo += d; b.path.shift(); }
      else { b.px += dx / d * step; b.py += dy / d * step; b.odo += step; }
      if (d > 0.01) {
        b.faceA = Math.atan2(dy, dx);
        b.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
      }
      if (!b.path.length) {
        b.state = 'idle'; b.arrived = true; b.path = null;
        if (b.wantDir) b.dir = b.wantDir;
        b.idleUntil = now + rnd(1800, 5200);
        if (b.goingToBed) { b.goingToBed = false; b.sleeping = true; b.dir = 'south'; }
      }
      return;
    }
    if (b.sleeping || b.goingToBed || b.convo) return;
    if (now >= b.idleUntil) {
      // wander: mostly around their own post, sometimes across the deck
      var tries = 0, moved = false;
      while (tries++ < 6 && !moved) {
        var t = rand() < 0.7 ? [b.home[0] + Math.round(rnd(-5, 5)), b.home[1] + Math.round(rnd(-3, 3))] : pickOne(FREE);
        moved = free(t[0], t[1]) && walkTo(b, t, pickOne(['south', 'south', 'east', 'west', 'north']));
      }
      if (b.state !== 'walk') b.idleUntil = now + rnd(1000, 3000);
      else if (b.mood >= 2 && rand() < 0.15) b.idleUntil = now;   // happy gods pace about
    }
  }

  /* ---------- bubbles + comms feed ---------- */
  var bubbles = [];          // { b, text, until, born }
  var lastQuote = null;
  var feedList = document.getElementById('feed-list');

  function feed(whoName, color, text, sys) {
    var li = document.createElement('li');
    if (sys) li.className = 'sys';
    var who = document.createElement('span');
    who.className = 'who'; who.style.color = color; who.textContent = whoName.toUpperCase() + ': ';
    li.appendChild(who);
    li.appendChild(document.createTextNode(text));
    feedList.appendChild(li);
    while (feedList.children.length > 4) feedList.removeChild(feedList.firstChild);
  }
  function say(b, text, now, opts) {
    var dur = Math.max(2400, Math.min(5600, 1500 + text.length * 55));
    bubbles = bubbles.filter(function (x) { return x.b !== b; });
    bubbles.push({ b: b, text: text, until: now + dur, born: now });
    b.speaking = true;
    b.speakUntil = now + dur;
    lastQuote = { id: b.id, name: b.cast.name, title: b.cast.title, color: b.cast.color, line: text };
    stats.linesSpoken++;
    if (!(opts && opts.nofeed)) feed(b.cast.name, b.cast.color, text);
    return dur;
  }

  /* ---------- banter director ---------- */
  var nextConvo = bag(BANTER.convos);
  var nextSolo = bag(BANTER.solo);
  var convos = [];           // active: { lines, ids, i, phase:'gather'|'talk', at, deadline, pair }
  var convoAt = 2500, soloAt = 1200;

  function participants(lines) {
    var s = [];
    lines.forEach(function (l) { if (s.indexOf(l.who) < 0) s.push(l.who); });
    return s;
  }
  function startConvo(now) {
    var lines = nextConvo(function (ls) {
      return participants(ls).every(function (id) { return byId[id] && available(byId[id]); });
    });
    if (!lines) return;
    var ids = participants(lines);
    var a = byId[ids[0]], b = byId[ids[1]];
    // a meeting spot near the first speaker: two free tiles with one between them
    var spot = null, base = tileOf(a.px, a.py);
    for (var tries = 0; tries < 40 && !spot; tries++) {
      var t = tries < 25 ? [base[0] + Math.round(rnd(-4, 4)), base[1] + Math.round(rnd(-3, 3))] : pickOne(FREE);
      if (free(t[0], t[1]) && free(t[0] + 2, t[1]) && free(t[0] + 1, t[1])) spot = t;
    }
    if (!spot) return;
    if (!walkTo(a, spot, 'east') || !walkTo(b, [spot[0] + 2, spot[1]], 'west')) {
      a.state = 'idle'; a.path = null; b.state = 'idle'; b.path = null; return;
    }
    a.convo = b.convo = lines;
    convos.push({ lines: lines, ids: ids, i: 0, phase: 'gather', at: 0, deadline: now + 10000, pair: PAIRS[ids[0] + '|' + ids[1]] || null, born: now });
  }
  function endConvo(cv, now) {
    cv.ids.forEach(function (id) { var m = byId[id]; if (m.convo === cv.lines) { m.convo = null; m.idleUntil = now + rnd(800, 2600); } });
    var k = convos.indexOf(cv);
    if (k >= 0) convos.splice(k, 1);
  }
  function stepConvos(now) {
    for (var c = convos.length - 1; c >= 0; c--) {
      var cv = convos[c];
      var members = cv.ids.map(function (id) { return byId[id]; });
      if (members.some(function (m) { return m.inDialog || !awake(m); })) { endConvo(cv, now); continue; }
      if (cv.phase === 'gather') {
        var here = members.every(function (m) { return m.arrived; });
        if (here || now > cv.deadline) { cv.phase = 'talk'; cv.at = now + 250; }
        continue;
      }
      if (now < cv.at) continue;
      if (cv.i >= cv.lines.length) { endConvo(cv, now); continue; }
      var ln = cv.lines[cv.i++];
      var sp = byId[ln.who];
      var other = members.filter(function (m) { return m !== sp; })[0];
      if (other && sp.state !== 'walk') sp.dir = other.px >= sp.px ? 'east' : 'west';
      cv.at = now + say(sp, ln.line, now) + 350;
      bump({ morale: 0.4 }, true);
    }
  }
  function stepDirector(now) {
    if (now >= convoAt) {
      if (convos.length < MAX_CONVOS && !dayInfo.night) startConvo(now);
      convoAt = now + rnd(5500, 9500);
    }
    if (now >= soloAt) {
      var line = nextSolo(function (l) {
        var b = byId[l.who];
        return b && available(b) && !bubbles.some(function (x) { return x.b === b; });
      });
      if (line) say(byId[line.who], line.line, now);
      soloAt = now + rnd(3200, 6000) * (dayInfo.night ? 1.6 : 1);
    }
  }

  /* ---------- station sim: power / morale / ambrosia ---------- */
  var sim = { power: 72, morale: 58, ambrosia: 120 };
  var simShown = { power: -1, morale: -1, ambrosia: -1 };
  var simFlash = {};
  // what each god's shift does to the station, per second, while awake (Apollo's sun only by day)
  var WORK = {
    hephaestus: { power: 0.30 }, apollo: { power: 0.34, day: true }, demeter: { power: 0.10, morale: 0.03 },
    dionysus: { morale: 0.12, ambrosia: -0.06 }, hermes: { ambrosia: 0.30 }, zeus: { power: -0.12, morale: 0.04 },
    poseidon: { power: -0.08 }, aphrodite: { morale: 0.10 }, athena: { ambrosia: 0.10 }, hera: { ambrosia: 0.06, morale: 0.02 },
    hades: { power: 0.08 }, ares: { morale: -0.02 }, artemis: { power: 0.30, night: true }
  };
  function bump(fx, quiet) {
    if (!fx) return;
    ['power', 'morale', 'ambrosia'].forEach(function (k) {
      if (!fx[k]) return;
      sim[k] = k === 'ambrosia' ? Math.max(0, sim[k] + fx[k]) : clamp(sim[k] + fx[k], 0, 100);
      if (!quiet) simFlash[k] = { dir: fx[k] > 0 ? 'up' : 'down', until: performance.now() + 900 };
    });
  }
  var simAt = 0;
  function stepSim(now) {
    if (now < simAt) return;
    var dt = simAt ? 1 : 0;
    simAt = now + 1000;
    if (!dt) return;
    var d = { power: -0.36, morale: -0.07, ambrosia: 0 };
    bodies.forEach(function (b) {
      var w = WORK[b.id];
      if (!w || !awake(b) || !b.loaded) return;
      if (w.day && dayInfo.night) return;
      if (w.night && !dayInfo.night) return;
      ['power', 'morale', 'ambrosia'].forEach(function (k) { if (w[k]) d[k] += w[k] * (1 + 0.1 * b.mood); });
    });
    if (d.power > 0) d.power *= Math.max(0.15, 1 - sim.power / 115);   // diminishing returns near full
    bump(d, true);
    if (sim.power < 15 && !simWarned) { simWarned = true; toast('Low power! Ask Hephaestus to boost the reactor.'); }
    if (sim.power > 30) simWarned = false;
  }
  var simWarned = false;
  var statEls = {};
  ['power', 'morale', 'ambrosia'].forEach(function (k) {
    var el = document.querySelector('.stat[data-k="' + k + '"]');
    statEls[k] = { el: el, val: el.querySelector('.val'), bar: el.querySelector('.bar i') };
  });
  var clockEl = document.getElementById('clock');
  function renderStats(now) {
    ['power', 'morale', 'ambrosia'].forEach(function (k) {
      var v = Math.round(sim[k]);
      var e = statEls[k];
      if (v !== simShown[k]) {
        simShown[k] = v;
        e.val.textContent = v;
        if (e.bar) e.bar.style.width = v + '%';
        e.el.classList.toggle('low', k !== 'ambrosia' && v < 20);
      }
      var f = simFlash[k];
      var on = f && performance.now() < f.until;
      e.el.classList.toggle('up', !!(on && f.dir === 'up'));
      e.el.classList.toggle('down', !!(on && f.dir === 'down'));
    });
    var label = 'DAY ' + dayInfo.day + ' · ' + dayInfo.hhmm;
    if (clockEl.textContent !== label) clockEl.textContent = label;
    clockEl.classList.toggle('night', dayInfo.night);
  }

  /* ---------- day / night ---------- */
  var CLOCK0 = params.has('clock') ? clamp(Number(params.get('clock')) || 0, 0, 0.999) : 0.10;   // 0 = 06:00
  var dayInfo = { frac: CLOCK0, day: 1, hhmm: '08:24', night: false, dark: 0, dusk: 0 };
  var simStart = null;
  function stepDay(now) {
    var first = simStart == null;
    if (first) simStart = now;
    var total = CLOCK0 + (now - simStart) / DAY_MS;
    var frac = total - Math.floor(total);
    var mins = Math.floor((6 * 60 + frac * 1440) % 1440);
    var hh = Math.floor(mins / 60), mm = mins % 60;
    var wasNight = dayInfo.night;
    dayInfo.frac = frac;
    dayInfo.day = Math.floor(total) + 1;
    dayInfo.hhmm = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    dayInfo.night = frac >= 0.583 && frac < 0.958;                          // 20:00 .. 05:00
    // darkness ramps over dusk (18:00-20:00) and dawn (05:00-06:00)
    dayInfo.dark = frac < 0.5 ? 0 : frac < 0.6 ? (frac - 0.5) / 0.1 : frac < 0.94 ? 1 : 1 - (frac - 0.94) / 0.06;
    dayInfo.dusk = Math.max(0, 1 - Math.abs(frac - 0.54) / 0.07);
    if (first) applyShift(now, dayInfo.night);
    else if (dayInfo.night !== wasNight) onNightChange(now, dayInfo.night);
  }
  function bedtime(b, now) {
    var cv = convos.filter(function (c) { return c.ids.indexOf(b.id) >= 0; })[0];
    if (cv) endConvo(cv, now);
    b.goingToBed = true;
    if (!walkTo(b, b.home, 'south') || b.state !== 'walk') { b.goingToBed = false; b.sleeping = true; b.dir = 'south'; b.state = 'idle'; }
  }
  function wake(b, now) { b.sleeping = false; b.goingToBed = false; b.idleUntil = now + rnd(300, 2000); }
  function applyShift(now, night) {
    bodies.forEach(function (b) {
      var owl = !!NIGHT_OWLS[b.id];
      if (night ? !owl : owl) { if (!b.inDialog) bedtime(b, now); }
      else wake(b, now);
    });
  }
  function onNightChange(now, night) {
    applyShift(now, night);
    if (night) feed('Station', '#ffd45a', 'Lights down. Artemis has the night shift. Everyone else: desk naps.', true);
    else { feed('Station', '#ffd45a', 'Good morning, Olympus! Day ' + dayInfo.day + '. Apollo is back on solar.', true); bump({ morale: 3 }); }
  }

  /* ---------- events ---------- */
  var nextEvent = bag(EVENTS);
  var eventAt = FIRST_EVENT_MS, activeEvent = null, eventsFired = 0;
  var evEl = document.getElementById('event'), evText = document.getElementById('ev-text');
  var evWho = document.getElementById('ev-who'), evChoices = document.getElementById('ev-choices');
  var evTimer = evEl.querySelector('.ev-timer i');
  function fmtFx(fx) {
    var out = [];
    var sym = { power: '⚡', morale: '☺', ambrosia: '◉' };
    ['power', 'morale', 'ambrosia'].forEach(function (k) { if (fx && fx[k]) out.push(sym[k] + (fx[k] > 0 ? '+' : '') + fx[k]); });
    return out.join(' ');
  }
  function fireEvent(now) {
    var ev = nextEvent();
    if (!ev) return;
    activeEvent = { ev: ev, born: now };
    eventsFired++;
    var lead = byId[ev.who];
    evWho.textContent = lead ? '· ' + lead.cast.name.toUpperCase() : '';
    evWho.style.color = lead ? lead.cast.color : '';
    evText.textContent = ev.text;
    evChoices.innerHTML = '';
    ev.choices.forEach(function (ch, i) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'choice';
      btn.innerHTML = '';
      btn.appendChild(document.createTextNode(ch.label));
      var s = document.createElement('span'); s.className = 'fx'; s.textContent = fmtFx(ch.fx);
      btn.appendChild(s);
      btn.addEventListener('click', function () { resolveEvent(i, false); });
      evChoices.appendChild(btn);
    });
    evEl.hidden = false;
    feed('Station', '#ffb02e', ev.text, true);
    if (lead && lead.loaded && !lead.inDialog) {
      lead.emote = { start: now, until: now + 1100 };
      lead.path = null; lead.state = 'idle'; lead.dir = 'south';
      if (lead.sleeping) wake(lead, now);
    }
  }
  function resolveEvent(i, auto) {
    if (!activeEvent) return;
    var ch = activeEvent.ev.choices[i];
    bump(ch.fx);
    feed('Station', '#ffd45a', (auto ? '(no call made, the crew voted) ' : '') + ch.log, true);
    stats.eventsResolved++;
    var lead = byId[activeEvent.ev.who];   // an off-shift lead god goes back to their nap
    if (lead && !lead.inDialog && (dayInfo.night ? !NIGHT_OWLS[lead.id] : !!NIGHT_OWLS[lead.id])) bedtime(lead, clock.now);
    activeEvent = null;
    evEl.hidden = true;
    eventAt = clock.now + rnd(EVENT_MIN, EVENT_MAX);
  }
  function stepEvents(now) {
    if (activeEvent) {
      var left = 1 - (now - activeEvent.born) / EVENT_TIMEOUT;
      evTimer.style.width = Math.max(0, left * 100) + '%';
      if (left <= 0) resolveEvent(Math.floor(rand() * 2), true);
      return;
    }
    if (now >= eventAt) fireEvent(now);
  }

  /* ---------- dialogue cards ---------- */
  var dlg = null;
  var dlgEl = document.getElementById('dialog');
  var dlgName = document.getElementById('dlg-name'), dlgTitle = document.getElementById('dlg-title');
  var dlgMood = document.getElementById('dlg-mood'), dlgText = document.getElementById('dlg-text');
  var dlgChoices = document.getElementById('dlg-choices');
  var portrait = document.getElementById('dlg-portrait'), pctx = portrait.getContext('2d');
  var MOODS = ['FURIOUS', 'GRUMPY', 'MEH', 'FINE', 'GOOD', 'GREAT', 'ECSTATIC'];
  function moodLabel(m) {
    return 'MOOD ' + MOODS[m + 3] + ' ' + (m > 0 ? '+' + m : m);
  }
  function openDialog(b, now) {
    if (!b.loaded) { toast(b.cast.name + ' is still warping in...'); return; }
    if (dlg) closeDialog(now);
    var cv = convos.filter(function (c) { return c.ids.indexOf(b.id) >= 0; })[0];
    if (cv) endConvo(cv, now);
    var tree = DIALOGUE[b.id];
    if (!tree) return;
    var wasAsleep = b.sleeping || b.goingToBed;
    b.inDialog = true; b.path = null; b.state = 'idle'; b.dir = 'south'; b.sleeping = false; b.goingToBed = false;
    b.emote = { start: now, until: now + 1050 };
    bubbles = bubbles.filter(function (x) { if (x.b === b) b.speaking = false; return x.b !== b; });
    dlg = { b: b, tree: tree, wasAsleep: wasAsleep };
    dlgEl.style.borderLeftColor = b.cast.color;
    dlgName.textContent = b.cast.name.toUpperCase(); dlgName.style.color = b.cast.color;
    dlgTitle.textContent = b.cast.title;
    dlgEl.hidden = false;
    stats.dialogsOpened++;
    showNode('start', now + 1000, wasAsleep);
  }
  function showNode(id, startAt, wasAsleep) {
    var node = dlg.tree[id];
    if (!node) { closeDialog(clock.now); return; }
    dlg.node = node;
    dlg.full = (wasAsleep ? '*yawn* ' : '') + node.text;
    dlg.typeStart = startAt || clock.now;
    dlgText.textContent = '';
    dlgMood.textContent = moodLabel(dlg.b.mood);
    dlgChoices.innerHTML = '';
    var choices = node.choices || [{ label: 'BACK TO WORK', close: true }];
    choices.forEach(function (ch) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'choice';
      btn.appendChild(document.createTextNode('▸ ' + ch.label));
      if (ch.fx) { var s = document.createElement('span'); s.className = 'fx'; s.textContent = fmtFx(ch.fx); btn.appendChild(s); }
      btn.addEventListener('click', function () { choose(ch); });
      dlgChoices.appendChild(btn);
    });
  }
  function choose(ch) {
    if (!dlg) return;
    var b = dlg.b, now = clock.now;
    if (ch.close) { closeDialog(now); return; }
    if (ch.mood) {
      b.mood = clamp(b.mood + ch.mood, -3, 3);
      if (ch.mood > 0) b.emote = { start: now, until: now + 1050 };
      moodPops.push({ b: b, up: ch.mood > 0, born: now });
    }
    if (ch.fx) bump(ch.fx);
    stats.choicesMade++;
    var next = dlg.tree[ch.to];
    if (next) feed(b.cast.name, b.cast.color, next.text);
    showNode(ch.to, now + (ch.mood > 0 ? 900 : 0));
  }
  function closeDialog(now) {
    if (!dlg) return;
    var b = dlg.b;
    b.inDialog = false; b.speaking = false; b.idleUntil = now + 1500;
    if ((dayInfo.night && !NIGHT_OWLS[b.id]) || (!dayInfo.night && NIGHT_OWLS[b.id])) bedtime(b, now);
    dlg = null;
    dlgEl.hidden = true;
  }
  dlgEl.querySelector('.dialog-x').addEventListener('click', function () { closeDialog(clock.now); });
  function stepDialog(now) {
    if (!dlg) return;
    var shown = now < dlg.typeStart ? 0 : Math.min(dlg.full.length, Math.floor((now - dlg.typeStart) / 24));
    if (dlgText.textContent.length !== shown) dlgText.textContent = dlg.full.slice(0, shown);
    dlg.b.speaking = shown > 0 && shown < dlg.full.length;
    // the portrait: the god's own live frame (talk / emote / blink), cropped to head + shoulders
    var meta = SPRITES.metaFor(dlg.b.skin);
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(0, 0, portrait.width, portrait.height);
    var k = 2;
    SPRITES.drawFrameTo(pctx, { id: dlg.b.id, skin: dlg.b.skin, dir: 'south', speaking: dlg.b.speaking, emote: dlg.b.emote,
      aph: dlg.b.aph, state: 'idle' }, now, 64 - (meta.fw / 2) * k, 8 - meta.head * k, k);
  }
  var moodPops = [];

  /* ---------- rendering ---------- */
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  var dpr = 1, vw = 0, vh = 0, cam = { s: 1, ox: 0, oy: 0 };
  var stars = [], winStars = [];
  var HUD_TOP = 48;
  var staticLayer = document.createElement('canvas'), staticDirty = true;

  function resize() {
    vw = window.innerWidth; vh = window.innerHeight;
    // PERF GUARD: cap DPR at 2 and the backing store at ~4.2 MP (phones with DPR 3 render at <= 2)
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (vw * vh * dpr * dpr > 4.2e6) dpr = Math.max(1, Math.sqrt(4.2e6 / (vw * vh)));
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    HUD_TOP = vw <= 640 ? 76 : 48;
    var availH = vh - HUD_TOP - 8;
    cam.s = Math.min(vw / (WW + 16), availH / (WH + 8));
    cam.ox = (vw - WW * cam.s) / 2;
    cam.oy = HUD_TOP + (availH - WH * cam.s) / 2;
    stars = [];
    var n = Math.round(vw * vh / 5000);
    for (var i = 0; i < n; i++) stars.push({ x: rand() * vw, y: rand() * vh, r: rand() < 0.1 ? 1.6 : 0.8, tw: rand() * 6.28 });
    winStars = [];
    for (var L = 0; L < 3; L++) {
      for (var j = 0; j < 70 + L * 30; j++) winStars.push({ x: rand() * WW, y: rand() * WALL_ROWS * T, L: L, tw: rand() * 6.28,
        c: rand() < 0.15 ? '#ffd8a0' : (rand() < 0.2 ? '#a8c8ff' : '#e8f4ff') });
    }
    staticDirty = true;
    PROPS.forEach(function (p) { p.cache = null; });
    holoCache = null;
  }
  window.addEventListener('resize', resize);

  function toScreen(x, y) { return { x: cam.ox + x * cam.s, y: cam.oy + y * cam.s }; }
  function toWorld(sx, sy) { return { x: (sx - cam.ox) / cam.s, y: (sy - cam.oy) / cam.s }; }

  function drawSpace(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var g = ctx.createRadialGradient(vw / 2, vh / 2, 0, vw / 2, vh / 2, Math.max(vw, vh) * 0.7);
    g.addColorStop(0, '#0b1630'); g.addColorStop(1, '#02040a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
    ctx.fillStyle = '#cfe6ff';
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = reduced ? 0.6 : 0.35 + 0.35 * Math.sin(now / 900 + s.tw);
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  /* the view out of the windows: three star layers drifting at different speeds (parallax) as the
     station turns. The wall art has transparent glass, so this only shows through the windows. */
  function drawWindowStars(now) {
    var bandH = WALL_ROWS * T;
    ctx.fillStyle = '#03060f'; ctx.fillRect(0, 0, WW, bandH);
    var t = reduced ? 0 : now / 1000;
    var speeds = [1.2, 3.0, 7.0], sizes = [0.35, 0.5, 0.8];
    for (var i = 0; i < winStars.length; i++) {
      var s = winStars[i];
      var x = (s.x - t * speeds[s.L]) % WW; if (x < 0) x += WW;
      ctx.globalAlpha = (0.45 + 0.25 * s.L) * (reduced ? 1 : 0.75 + 0.25 * Math.sin(now / 700 + s.tw));
      ctx.fillStyle = s.c;
      ctx.fillRect(x, s.y, sizes[s.L], sizes[s.L]);
    }
    // a slow planet limb drifting past
    var px = WW - ((t * 2.2) % (WW + 120));
    var g = ctx.createRadialGradient(px, bandH * 1.9, 4, px, bandH * 1.9, 46);
    g.addColorStop(0, 'rgba(90,140,255,0.55)'); g.addColorStop(0.85, 'rgba(40,70,160,0.35)'); g.addColorStop(1, 'rgba(40,70,160,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(px - 50, 0, 100, bandH);
  }

  /* everything that never moves (hull, floor, grime, walls, rug, sign) is drawn ONCE per resize into an
     offscreen canvas at device resolution, then blitted each frame */
  function buildStatic() {
    var pad = 8;
    var w = Math.ceil((WW + pad * 2) * cam.s * dpr), h = Math.ceil((WH + pad * 2) * cam.s * dpr);
    staticLayer.width = w; staticLayer.height = h;
    var c = staticLayer.getContext('2d');
    c.setTransform(cam.s * dpr, 0, 0, cam.s * dpr, pad * cam.s * dpr, pad * cam.s * dpr);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#10151d'; c.fillRect(-6, -6, WW + 12, WH + 12);
    c.strokeStyle = 'rgba(90,208,255,0.35)'; c.lineWidth = 0.6; c.strokeRect(-6, -6, WW + 12, WH + 12);
    var fx = T, fy = WALL_ROWS * T, fw = WW - 2 * T, fh = WH - (WALL_ROWS + 1) * T;
    if (ok(FLOOR)) {
      var pat = c.createPattern(FLOOR, 'repeat');
      if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(96 / FLOOR.naturalWidth));
      c.fillStyle = pat;
    } else c.fillStyle = '#1b1f26';
    c.fillRect(fx, fy, fw, fh);
    if (ok(GRIME)) c.drawImage(GRIME, fx, fy, fw, fh);
    c.fillStyle = 'rgba(20,40,70,0.16)'; c.fillRect(fx, fy, fw, fh);
    // back wall (windows are transparent: the parallax stars are drawn behind this layer)
    c.clearRect(0, 0, WW, WALL_ROWS * T);
    if (ok(WALL)) {
      var sh = WALL.naturalHeight * 0.55, dh = WALL_ROWS * T, dw = WALL.naturalWidth * dh / sh;
      c.save(); c.beginPath(); c.rect(0, 0, WW, dh); c.clip();
      for (var x = 0; x < WW; x += dw) c.drawImage(WALL, 0, 0, WALL.naturalWidth, sh, x, 0, dw, dh);
      c.restore();
    }
    var wg = c.createLinearGradient(0, fy, 0, fy + 10);
    wg.addColorStop(0, 'rgba(0,0,0,0.55)'); wg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = wg; c.fillRect(fx, fy, fw, 10);
    c.fillStyle = '#1a1f28';
    c.fillRect(0, fy, T, WH - fy); c.fillRect(WW - T, fy, T, WH - fy); c.fillRect(0, WH - T, WW, T);
    c.fillStyle = 'rgba(255,176,46,0.5)';
    c.fillRect(T - 0.8, fy, 0.8, fh); c.fillRect(WW - T, fy, 0.8, fh); c.fillRect(T, WH - T, fw, 0.8);
    // hazard stripes along the front wall + deck numbers
    for (var sx = T; sx < WW - T; sx += 4) { c.fillStyle = (sx / 4) % 2 ? 'rgba(255,176,46,0.35)' : 'rgba(20,20,26,0.5)'; c.fillRect(sx, WH - T + 1.5, 4, 1.4); }
    c.font = '6px "VT323", monospace'; c.fillStyle = 'rgba(143,166,191,0.55)'; c.textAlign = 'left';
    c.fillText('DECK 1 // OLYMPUS STATION // CREW 13', T + 2, WH - 3.5);
    PROPS.forEach(function (p) { if (p.floor) drawPropTo(c, p, p.im); });
    staticDirty = false;
    staticImgs = imgsLoaded;
  }
  var staticImgs = -1;

  function propRect(p, im) {
    var w = p.w * T * (p.fit || 1);
    var h = im.naturalHeight * w / (p.strip && im === p.strip ? im.naturalWidth / p.n : im.naturalWidth);
    var cx = (p.x + p.w / 2) * T;
    var by = p.wall ? (p.y + p.h) * T + 6 : (p.y + p.h) * T;
    return { x: cx - w / 2, y: by - h, w: w, h: h };
  }
  function drawPropTo(c, p, im) {
    if (!im || !ok(im)) return;
    var r = propRect(p, im);
    c.drawImage(im, r.x, r.y, r.w, r.h);
  }
  /* animated props: each strip frame pre-rendered once into a device-resolution offscreen canvas */
  function propFrames(p) {
    if (p.cache) return p.cache;
    if (!p.strip || !ok(p.strip)) return null;   // (null until loadPropImages ran)
    var r = propRect(p, p.strip);
    var fw = p.strip.naturalWidth / p.n, fh = p.strip.naturalHeight;
    var dw = Math.max(1, Math.round(r.w * cam.s * dpr)), dh = Math.max(1, Math.round(r.h * cam.s * dpr));
    p.cache = [];
    for (var i = 0; i < p.n; i++) {
      var cv = document.createElement('canvas'); cv.width = dw; cv.height = dh;
      var g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(p.strip, i * fw, 0, fw, fh, 0, 0, dw, dh);
      p.cache.push(cv);
    }
    p.cacheRect = r;
    return p.cache;
  }
  function drawProp(p, now) {
    var frames = !reduced && propFrames(p);
    if (frames) {
      var i = Math.floor(now / 1000 * p.fps + p.ph) % p.n;
      var r = p.cacheRect;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(frames[i], Math.round((cam.ox + r.x * cam.s) * dpr), Math.round((cam.oy + r.y * cam.s) * dpr));
      ctx.restore();
      return;
    }
    ctx.imageSmoothingEnabled = false;
    drawPropTo(ctx, p, p.im);
  }
  var holoCache = null;
  function drawHolo(now) {
    if (!ok(HOLO_STRIP)) return;
    var n = 12;
    if (!holoCache) {
      var fw = HOLO_STRIP.naturalWidth / n, fh = HOLO_STRIP.naturalHeight;
      var w = 50, h = w * fh / fw;
      var dw = Math.round(w * cam.s * dpr), dh = Math.round(h * cam.s * dpr);
      holoCache = { w: w, h: h, frames: [] };
      for (var i = 0; i < n; i++) {
        var cv = document.createElement('canvas'); cv.width = dw; cv.height = dh;
        var g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        g.drawImage(HOLO_STRIP, i * fw, 0, fw, fh, 0, 0, dw, dh);
        holoCache.frames.push(cv);
      }
    }
    var cx = (HOLO.x + HOLO.w / 2) * T, top = (HOLO.y + HOLO.h) * T - 16 - holoCache.h;
    var f = reduced ? 0 : Math.floor(now / 140) % n;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = reduced ? 0.8 : 0.72 + 0.12 * Math.sin(now / 300);
    ctx.drawImage(holoCache.frames[f], Math.round((cam.ox + (cx - holoCache.w / 2) * cam.s) * dpr), Math.round((cam.oy + (top + (reduced ? 0 : Math.sin(now / 900))) * cam.s) * dpr));
    ctx.restore();
  }

  var glowSprite = null;
  function lightPools(now) {
    // night: emissive props bloom into the dark; holotable pool always
    var dark = dayInfo.dark;
    var hc = { x: (HOLO.x + HOLO.w / 2) * T, y: (HOLO.y + HOLO.h / 2) * T };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var lg = ctx.createRadialGradient(hc.x, hc.y, 2, hc.x, hc.y, 70);
    lg.addColorStop(0, 'rgba(90,208,255,' + ((reduced ? 0.15 : 0.12 + 0.04 * Math.sin(now / 500)) * (1 + dark)) + ')');
    lg.addColorStop(1, 'rgba(90,208,255,0)');
    ctx.fillStyle = lg; ctx.fillRect(hc.x - 70, hc.y - 70, 140, 140);
    if (dark > 0.05) {
      PROPS.forEach(function (p) {
        if (!p.light) return;
        var x = (p.x + p.w / 2) * T, y = (p.y + p.h) * T - 6;
        var R = 26 + p.w * 6;
        var g = ctx.createRadialGradient(x, y, 1, x, y, R);
        g.addColorStop(0, 'rgba(' + p.light + ',' + (0.30 * dark) + ')');
        g.addColorStop(1, 'rgba(' + p.light + ',0)');
        ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2);
      });
      var h = byId.hades;
      if (h && h.loaded) {   // Hades' soul lantern lights his corner
        var g2 = ctx.createRadialGradient(h.px, h.py - 8, 1, h.px, h.py - 8, 22);
        g2.addColorStop(0, 'rgba(127,232,255,' + (0.28 * dark) + ')'); g2.addColorStop(1, 'rgba(127,232,255,0)');
        ctx.fillStyle = g2; ctx.fillRect(h.px - 22, h.py - 30, 44, 44);
      }
    }
    ctx.restore();
  }

  var stats = { booted: false, frames: 0, bodiesDrawn: 0, bubblesVisible: 0, linesSpoken: 0, splashGone: false,
    dialogsOpened: 0, choicesMade: 0, eventsResolved: 0 };
  var geo = {};

  function render(now) {
    drawSpace(now);
    if (staticDirty || staticImgs !== imgsLoaded) buildStatic();
    ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.ox, dpr * cam.oy);
    drawWindowStars(now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(staticLayer, Math.round((cam.ox - 8 * cam.s) * dpr), Math.round((cam.oy - 8 * cam.s) * dpr));
    ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.ox, dpr * cam.oy);
    // the wall light strip breathes
    ctx.fillStyle = 'rgba(90,208,255,' + (reduced ? 0.5 : 0.4 + 0.15 * Math.sin(now / 700)) + ')';
    ctx.fillRect(0, WALL_ROWS * T - 0.8, WW, 0.8);
    PROPS.forEach(function (p) { if (p.wall) drawProp(p, now); });
    ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.ox, dpr * cam.oy);
    // selection ring under the god you're talking to
    if (dlg) {
      var sb = dlg.b;
      ctx.strokeStyle = sb.cast.color; ctx.lineWidth = 0.7; ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now / 200);
      ctx.beginPath(); ctx.ellipse(sb.px, sb.py, 9, 3.2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // painter's order: props and bodies by their floor line
    var items = [];
    PROPS.forEach(function (p) { if (!p.floor && !p.wall) items.push({ y: (p.y + p.h) * T - 0.5, p: p }); });
    bodies.forEach(function (b) { items.push({ y: b.py, b: b }); });
    items.sort(function (a, b) { return a.y - b.y; });
    var drawn = 0;
    geo = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.p) {
        drawProp(it.p, now);
        ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.ox, dpr * cam.oy);
        if (it.p === HOLO) drawHolo(now);
        ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.ox, dpr * cam.oy);
        continue;
      }
      var b = it.b;
      var g = b.loaded ? SPRITES.drawBody(ctx, b, now, { reducedMotion: reduced }) : null;
      if (g) { drawn++; geo[b.id] = g; warpFlash(b, now); }
      else warpBeam(b, now);
    }
    stats.bodiesDrawn = drawn;
    // lighting: dusk tint + night darkness over the room, then emissive pools
    if (dayInfo.dark > 0.01 || dayInfo.dusk > 0.01) {
      ctx.fillStyle = 'rgba(255,120,50,' + (0.10 * dayInfo.dusk) + ')';
      ctx.fillRect(0, 0, WW, WH);
      ctx.fillStyle = 'rgba(6,10,36,' + (0.48 * dayInfo.dark) + ')';
      ctx.fillRect(-8, -8, WW + 16, WH + 16);
    }
    lightPools(now);
    drawOverlays(now);
  }

  /* placeholder while a god's atlas streams in: a cyan teleport column, then a flash when they land */
  function warpBeam(b, now) {
    var a = reduced ? 0.4 : 0.25 + 0.15 * Math.sin(now / 180 + b.aph);
    var g = ctx.createLinearGradient(0, b.py - 30, 0, b.py);
    g.addColorStop(0, 'rgba(90,208,255,0)'); g.addColorStop(1, 'rgba(90,208,255,' + a + ')');
    ctx.fillStyle = g; ctx.fillRect(b.px - 4, b.py - 30, 8, 30);
    ctx.fillStyle = 'rgba(200,244,255,' + a + ')'; ctx.fillRect(b.px - 0.5, b.py - 28, 1, 28);
    ctx.beginPath(); ctx.ellipse(b.px, b.py, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  function warpFlash(b, now) {
    if (!b.landedAt || reduced) return;
    var t = (now - b.landedAt) / 600;
    if (t > 1) return;
    ctx.strokeStyle = 'rgba(160,236,255,' + (1 - t) + ')'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(b.px, b.py, 4 + t * 14, 1.5 + t * 5, 0, 0, Math.PI * 2); ctx.stroke();
  }

  /* name tags, bubbles, relationship icons, zzz, mood pops — SCREEN space so text stays crisp */
  var FONT = '"VT323", "Courier New", monospace';
  function wrap(text, maxW) {
    var words = text.split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function topOf(b) { return geo[b.id] ? geo[b.id].top : b.py - 26; }
  var ICONS = {
    heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
    spark: ['...#...', '..###..', '#######', '..###..', '...#...'],
    clash: ['...##', '..##.', '.####', '..##.', '.##..', '##...'],
    sweat: ['..#..', '.###.', '#####', '#####', '.###.']
  };
  var ICON_COL = { heart: '#ff5a8a', spark: '#ffe45a', clash: '#ff6a3a', sweat: '#7fd8ff' };
  function pixelIcon(kind, x, y, k) {
    var rows = ICONS[kind];
    ctx.fillStyle = '#140c22';
    for (var pass = 0; pass < 2; pass++) {
      for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c] !== '#') continue;
        if (pass === 0) ctx.fillRect(x + (c - rows[r].length / 2) * k - k * 0.5, y + r * k - k * 0.5, k * 2, k * 2);
        else ctx.fillRect(x + (c - rows[r].length / 2) * k, y + r * k, k, k);
      }
      ctx.fillStyle = ICON_COL[kind];
    }
  }
  function drawOverlays(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var ui = Math.max(0.8, Math.min(1.3, cam.s / 3.6));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = Math.round(13 * ui) + 'px ' + FONT;
    bodies.forEach(function (b) {
      var s = toScreen(b.px, b.py + 2);
      var label = b.loaded ? b.cast.name.toUpperCase() : b.cast.name.toUpperCase() + ' · WARPING IN';
      var w = ctx.measureText(label).width + 8;
      ctx.fillStyle = b === hover ? 'rgba(20,34,60,0.9)' : 'rgba(3,6,13,0.66)';
      ctx.fillRect(s.x - w / 2, s.y, w, 14 * ui);
      ctx.fillStyle = b.loaded ? b.cast.color : '#5ad0ff'; ctx.fillText(label, s.x, s.y + 1);
      if (b.sleeping && !reduced) {   // zzz
        var top = toScreen(b.px, topOf(b));
        ctx.fillStyle = 'rgba(200,220,255,0.85)';
        for (var z = 0; z < 3; z++) {
          var t = ((now / 1400 + z / 3 + b.aph) % 1);
          ctx.globalAlpha = Math.sin(t * Math.PI);
          ctx.font = Math.round((11 + z * 3) * ui) + 'px ' + FONT;
          ctx.fillText('z', top.x + 8 * ui + t * 10 * ui, top.y - t * 18 * ui);
        }
        ctx.globalAlpha = 1;
        ctx.font = Math.round(13 * ui) + 'px ' + FONT;
      }
    });
    // relationship icons over conversing pairs
    convos.forEach(function (cv) {
      if (!cv.pair || cv.phase !== 'talk') return;
      var a = byId[cv.ids[0]], b = byId[cv.ids[1]];
      var mx = (a.px + b.px) / 2, my = Math.min(topOf(a), topOf(b)) - 2;
      var s = toScreen(mx, my);
      var bob = reduced ? 0 : Math.sin(now / 260) * 2;
      var k = Math.max(2, Math.round(2 * ui));
      pixelIcon(cv.pair.kind, s.x, s.y - 14 * ui + bob, k);
      stats.pairIcons = (stats.pairIcons || 0) + 1;
    });
    // mood pops (+ / -) after dialogue choices
    moodPops = moodPops.filter(function (m) { return now - m.born < 1400; });
    moodPops.forEach(function (m) {
      var t = (now - m.born) / 1400;
      var s = toScreen(m.b.px, topOf(m.b));
      ctx.globalAlpha = 1 - t;
      pixelIcon(m.up ? 'heart' : 'clash', s.x + 14 * ui, s.y - 4 - t * 22 * ui, Math.max(2, Math.round(2 * ui)));
      ctx.globalAlpha = 1;
    });
    // bubbles: expire, then lay out top-down nudging overlaps upward
    bubbles = bubbles.filter(function (x) {
      if (now < x.until) return true;
      x.b.speaking = false; return false;
    });
    var fs = Math.round(17 * ui);
    ctx.font = fs + 'px ' + FONT;
    var placed = [];
    var order = bubbles.slice().sort(function (a, b) { return b.b.py - a.b.py; });
    order.forEach(function (bb) {
      var b = bb.b;
      var anchor = toScreen(b.px, topOf(b) - 3);
      var lines = wrap(bb.text, 210 * ui);
      var lh = fs * 0.95, pad = 7 * ui;
      ctx.font = Math.round(13 * ui) + 'px ' + FONT;
      var head = b.cast.name.toUpperCase() + ' · ' + b.cast.title.toUpperCase();
      var headW = ctx.measureText(head).width;
      ctx.font = fs + 'px ' + FONT;
      var w = Math.max(headW, Math.max.apply(null, lines.map(function (l) { return ctx.measureText(l).width; }))) + pad * 2;
      var h = lines.length * lh + 14 * ui + pad * 1.6;
      var x = Math.max(6, Math.min(vw - w - 6, anchor.x - w / 2));
      var y = anchor.y - h - 8 * ui;
      for (var k = 0; k < placed.length; k++) {
        var o = placed[k];
        if (x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y) y = o.y - h - 4;
      }
      y = Math.max(HUD_TOP, y);
      placed.push({ x: x, y: y, w: w, h: h });
      var age = now - bb.born, life = bb.until - now;
      ctx.globalAlpha = reduced ? 1 : Math.min(1, age / 160, life / 220);
      ctx.fillStyle = '#f4f8ff';
      ctx.beginPath();
      var tx = Math.max(x + 10, Math.min(x + w - 10, anchor.x));
      ctx.moveTo(tx - 6 * ui, y + h - 1); ctx.lineTo(tx + 6 * ui, y + h - 1); ctx.lineTo(anchor.x, anchor.y);
      ctx.closePath(); ctx.fill();
      roundRect(x, y, w, h, 5 * ui);
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = b.cast.color; ctx.stroke();
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = Math.round(13 * ui) + 'px ' + FONT;
      ctx.fillStyle = shade(b.cast.color);
      ctx.fillText(head, x + pad, y + pad * 0.6);
      ctx.font = fs + 'px ' + FONT;
      ctx.fillStyle = '#0b1220';
      for (var li = 0; li < lines.length; li++) ctx.fillText(lines[li], x + pad, y + pad * 0.6 + 14 * ui + li * lh);
      ctx.globalAlpha = 1;
    });
    stats.bubblesVisible = placed.length;
  }
  function shade(hex) {
    var n = parseInt(hex.slice(1), 16);
    var f = function (v) { return Math.round(v * 0.55); };
    return 'rgb(' + f((n >> 16) & 255) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }

  /* ---------- input: click / tap a god ---------- */
  var hover = null;
  function bodyAt(clientX, clientY) {
    var w = toWorld(clientX, clientY);
    var best = null;
    bodies.forEach(function (b) {
      var top = topOf(b) - 2;
      if (w.x > b.px - 9 && w.x < b.px + 9 && w.y > top && w.y < b.py + 3) {
        if (!best || b.py > best.py) best = b;
      }
    });
    return best;
  }
  canvas.addEventListener('click', function (e) {
    if (!stats.splashGone) return;
    var b = bodyAt(e.clientX, e.clientY);
    if (b) openDialog(b, clock.now);
  });
  canvas.addEventListener('pointermove', function (e) {
    hover = bodyAt(e.clientX, e.clientY);
    canvas.style.cursor = hover ? 'pointer' : 'default';
  });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDialog(clock.now); });

  /* ---------- sprite streaming: nearest gods first ---------- */
  var perf = { t0: 0, first6Ms: null, allMs: null, frameMs: 16.7, fpsSamples: [], dpr: 1 };
  function markLoaded(b) {
    b.loaded = true;
    b.landedAt = clock.now;
  }
  function startLoading() {
    SPRITES.manualLoad = true;
    perf.t0 = performance.now();
    var cx = WW / 2, cy = (WALL_ROWS * T + WH) / 2;
    var order = bodies.slice().sort(function (a, b) { return Math.hypot(a.px - cx, a.py - cy) - Math.hypot(b.px - cx, b.py - cy); });
    var first = order.slice(0, 6), rest = order.slice(6);
    var load = function (b) { return SPRITES.ensureSkin(b.skin).then(function (okk) { if (okk) markLoaded(b); }); };
    Promise.all(first.map(load)).then(function () {
      perf.first6Ms = Math.round(performance.now() - perf.t0);
      // stream the rest two at a time so the first six keep the main thread
      var i = 0;
      function next() {
        if (i >= rest.length) return Promise.resolve();
        var batch = rest.slice(i, i + 2); i += 2;
        return Promise.all(batch.map(load)).then(next);
      }
      return next();
    }).then(function () { perf.allMs = Math.round(performance.now() - perf.t0); });
  }

  /* ---------- main loop ---------- */
  var clock = { now: 0 };
  var last = 0;
  function frame(now) {
    var dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    if (last) {
      perf.frameMs = perf.frameMs * 0.95 + (now - last) * 0.05;
      perf.fpsSamples.push(now - last); if (perf.fpsSamples.length > 240) perf.fpsSamples.shift();
    }
    last = now;
    clock.now = now;
    if (stats.splashGone || now > 900) {
      stepDay(now);
      for (var i = 0; i < bodies.length; i++) {
        var b = bodies[i];
        if (b.speaking && now > b.speakUntil && !(dlg && dlg.b === b)) b.speaking = false;
        stepBody(b, dt, now);
      }
      stepDirector(now);
      stepConvos(now);
      stepSim(now);
      stepEvents(now);
      stepDialog(now);
      renderStats(now);
    }
    render(now);
    stats.frames++;
    requestAnimationFrame(frame);
  }

  /* ---------- UI: splash, badge, upsell, toast ---------- */
  var splash = document.getElementById('splash');
  function dismissSplash() {
    if (stats.splashGone) return;
    stats.splashGone = true;
    splash.classList.add('gone');
    setTimeout(function () { splash.style.display = 'none'; }, 700);
  }
  splash.addEventListener('click', dismissSplash);
  window.addEventListener('keydown', dismissSplash, { once: true });
  setTimeout(dismissSplash, 1400);

  var upsell = document.getElementById('upsell');
  var upsellShown = false;
  function openUpsell() { upsell.hidden = false; upsellShown = true; }
  document.getElementById('demo-badge').addEventListener('click', openUpsell);
  document.getElementById('btn-full').addEventListener('click', openUpsell);
  upsell.querySelector('.upsell-x').addEventListener('click', function () { upsell.hidden = true; });
  setTimeout(function () { if (!upsellShown && !dlg) openUpsell(); }, 75000);
  var gh = document.getElementById('link-github');
  if (/TODO/.test(GITHUB_URL)) {
    gh.classList.add('disabled'); gh.removeAttribute('href'); gh.textContent = 'GITHUB: LINK COMING SOON';
  } else gh.href = GITHUB_URL;
  document.getElementById('link-play').href = PLAY_URL;

  var toastEl = document.getElementById('toast'), toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 4200);
  }

  /* ---------- SHARE CARD ---------- */
  function buildShareCard() {
    render(performance.now());
    var W = 1200, H = 630, BAND = 168;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#03060d'; x.fillRect(0, 0, W, H);
    var sx = cam.ox * dpr, sy = cam.oy * dpr, sw = WW * cam.s * dpr, sh = WH * cam.s * dpr;
    var areaH = H - BAND, k = Math.max(W / sw, areaH / sh);
    var cw = W / k, ch = areaH / k;
    x.imageSmoothingEnabled = true;
    x.drawImage(canvas, sx + (sw - cw) / 2, sy + (sh - ch) / 2, cw, ch, 0, 0, W, areaH);
    x.fillStyle = 'rgba(3,6,13,0.78)'; x.fillRect(18, 16, 330, 44);
    x.fillStyle = '#ffffff'; x.font = '34px ' + FONT; x.textBaseline = 'middle';
    x.fillText('EMPIRE OF GODS', 30, 39);
    // station status chip: day + the three stats
    var chip = 'DAY ' + dayInfo.day + ' ' + dayInfo.hhmm + '   ⚡' + Math.round(sim.power) + '   ☺' + Math.round(sim.morale) + '   ◉' + Math.round(sim.ambrosia);
    x.font = '28px ' + FONT;
    var cwid = x.measureText(chip).width + 28;
    x.fillStyle = 'rgba(3,6,13,0.78)'; x.fillRect(W - cwid - 18, 16, cwid, 44);
    x.fillStyle = '#ffd45a'; x.textAlign = 'right'; x.fillText(chip, W - 32, 39); x.textAlign = 'left';
    var bandY = H - BAND;
    var bg = x.createLinearGradient(0, bandY, 0, H);
    bg.addColorStop(0, '#0b1630'); bg.addColorStop(1, '#03060d');
    x.fillStyle = bg; x.fillRect(0, bandY, W, BAND);
    var q = lastQuote || { name: 'Zeus', title: 'CEO', color: '#ffd45a', line: "I don't do stand-ups. I do thunder-ups." };
    x.fillStyle = q.color; x.fillRect(0, bandY, W, 4);
    x.textBaseline = 'top'; x.fillStyle = '#ffffff'; x.font = '40px ' + FONT;
    var words = ('“' + q.line + '”').split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (x.measureText(t).width > W - 80 && cur) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    lines.push(cur);
    lines = lines.slice(0, 2);
    lines.forEach(function (l, n) { x.fillText(l, 40, bandY + 18 + n * 38); });
    x.font = '30px ' + FONT; x.fillStyle = q.color;
    x.fillText('— ' + q.name + ', ' + q.title, 40, bandY + 22 + lines.length * 38);
    x.font = '26px ' + FONT; x.fillStyle = '#8fa6bf'; x.textAlign = 'right';
    x.fillText('Empire of Gods — play free: ' + PLAY_LABEL, W - 30, H - 36);
    return c;
  }
  function share() {
    var c = buildShareCard();
    try {
      c.toBlob(function (blob) {
        if (!blob) { toast('Could not render the share card.'); return; }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'empire-of-gods-day' + dayInfo.day + '-' + Date.now() + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        toast('Share card saved — post it anywhere!');
      }, 'image/png');
    } catch (e) {
      toast('Share cards need the hosted page (' + PLAY_LABEL + ') — browsers block image export from file://.');
    }
  }
  document.getElementById('btn-share').addEventListener('click', share);

  /* read-only hook for the headless proof (tools/proof.mjs) */
  window.__eogdemo = {
    seed: SEED,
    stats: function () {
      return {
        booted: stats.booted, frames: stats.frames, bodies: bodies.length, bodiesDrawn: stats.bodiesDrawn,
        bodiesLoaded: bodies.filter(function (b) { return b.loaded; }).length,
        bubblesVisible: stats.bubblesVisible, linesSpoken: stats.linesSpoken, splashGone: stats.splashGone,
        walking: bodies.filter(function (b) { return b.state === 'walk'; }).length,
        sleeping: bodies.filter(function (b) { return b.sleeping; }).length,
        activeConvos: convos.length, lastQuote: lastQuote,
        dialogOpen: !!dlg, dialogGod: dlg ? dlg.b.id : null, dialogsOpened: stats.dialogsOpened, choicesMade: stats.choicesMade,
        eventsFired: eventsFired, eventActive: activeEvent ? activeEvent.ev.id : null, eventsResolved: stats.eventsResolved,
        sim: { power: Math.round(sim.power), morale: Math.round(sim.morale), ambrosia: Math.round(sim.ambrosia) },
        day: dayInfo.day, clock: dayInfo.hhmm, night: dayInfo.night, pairIcons: stats.pairIcons || 0
      };
    },
    /* screen-space centre of a god's drawn body (so the proof can click it like a user) */
    bodyScreen: function (id) {
      var b = byId[id];
      if (!b) return null;
      var s = toScreen(b.px, (topOf(b) + b.py) / 2);
      return { x: s.x, y: s.y, loaded: b.loaded };
    },
    perf: function () {
      var s = perf.fpsSamples.slice().sort(function (a, b) { return a - b; });
      return { avgFps: Math.round(1000 / perf.frameMs), p95FrameMs: s.length ? Math.round(s[Math.floor(s.length * 0.95)]) : null,
        dpr: dpr, first6Ms: perf.first6Ms, allMs: perf.allMs, sheets: SPRITES.loadStats() };
    },
    shareCardDataURL: function () { return buildShareCard().toDataURL('image/png'); }
  };

  /* ---------- boot ---------- */
  resize();
  SPRITES.init().then(function () {
    startLoading();          // god atlases first (nearest six in parallel) ...
    loadPropImages();        // ... then the furniture
    stats.booted = true;
  });
  requestAnimationFrame(frame);
})();
