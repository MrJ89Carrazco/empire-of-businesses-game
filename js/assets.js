/* EMPIRE OF GODS demo — assets.js : sprite ATLAS loading + drawBody.
 *
 * Forked from the full game's frontend/js/assets.js (MIT, (c) Andrew Sims) and owned by the demo since
 * B10: the pantheon ships one atlas sheet per god (assets/sprites/<god>.png) described by
 * window.EOG_MANIFEST v2, instead of one PNG per frame. Kept from upstream: 8-direction render facing with
 * weighted turns + pivot stepping, distance-phased walk cycle, blink, talk, the directional contact shadow.
 * New: trimmed atlas frames, manifest-supplied foot line / stride / head line (no pixel readback, so
 * file:// anchors correctly too), an `emote` one-shot track, a `sleep` track, and manual (sequenced)
 * loading so the demo can stream gods in nearest-first instead of all at once.
 */
'use strict';

const SPRITES = (() => {
  let ready = false;
  let loading = false;
  let man = null;
  const frames = {};          // "zeus.walk.east" -> [frame]
  const setJobs = {};
  const loadedSets = new Set();
  const loadTimes = {};       // set -> ms from request to usable (perf report)
  let tracksBySet = null;

  function setOf(b) {
    return (DATA.SKINS[b && b.skin] && DATA.SKINS[b.skin].set) || DATA.SKINS[DATA.DEFAULT_SKIN].set;
  }
  function drawScaleFor(set) {
    return (DATA.SKINS[set] && DATA.SKINS[set].scale) || (man && man.scale) || 0.3;
  }
  function metaFor(set) { return (man && man.meta && man.meta[set]) || { fw: 130, fh: 150, foot: 13, head: 50, cycle: 44 }; }
  function bodyScale(b) { return drawScaleFor(setOf(b)); }

  /* ---------- deck contact and directional body shadow (upstream, unchanged) ---------- */
  const SHADOW_RINGS = Array.from({ length: 12 }, (_, i) => {
    const t = i / 11;
    return [1 - t * 0.82, 0.016 + t * 0.043];
  });
  const SHADOW_SQUASH = 0.38;
  function groundShadow(ctx, cx, cy, rx, opts) {
    const o = opts || {};
    const lift = Math.max(0, o.lift || 0);
    const k = 1 - Math.min(0.5, lift * 0.14);
    const spread = rx * k * (o.spread || 1);
    if (!(spread > 0.5)) return;
    const a0 = ctx.globalAlpha, ink = ctx.fillStyle;
    const fade = k * (o.alpha != null ? o.alpha : 1);
    ctx.fillStyle = o.color || '#080d19';
    try {
      for (const [radius, alpha] of SHADOW_RINGS) {
        const reach = o.color ? 0.08 : 0.48 * radius * radius;
        ctx.globalAlpha = a0 * alpha * fade * (o.color ? 1.2 : 1);
        ctx.beginPath();
        ctx.ellipse(cx + spread * reach * (o.direction ? o.direction.x : -1),
          cy + spread * reach * (o.direction ? o.direction.y : 0.62),
          spread * radius * (o.color ? 1 : 1.14), spread * radius * SHADOW_SQUASH,
          o.color ? 0 : -0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!o.color) {
        ctx.globalAlpha = a0 * 0.22 * fade * k;
        ctx.beginPath();
        ctx.ellipse(cx, cy, spread * 0.42, spread * 0.115, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } finally { ctx.globalAlpha = a0; ctx.fillStyle = ink; }
  }

  /* pick best available animation key for a body state */
  function pick(set, names, dir) {
    for (const n of names) {
      const exact = set + '.' + n + '.' + dir;
      if (frames[exact]) return exact;
    }
    for (const n of names) {
      for (const d of ['south', 'east', 'west', 'north']) {
        const k = set + '.' + n + '.' + d;
        if (frames[k]) return k;
      }
    }
    return frames[set + '.rot.south'] ? set + '.rot.south' : null;
  }

  /* ---------- 8-direction render facing with weighted turns (upstream) ---------- */
  const DIR8_A = {
    east: 0, 'south-east': Math.PI / 4, south: Math.PI / 2, 'south-west': 3 * Math.PI / 4,
    west: Math.PI, 'north-west': -3 * Math.PI / 4, north: -Math.PI / 2, 'north-east': -Math.PI / 4
  };
  const TURN_MAX = 9, TURN_ACCEL = 55, TURN_STEP_W = 1.2, TURN_STEP_FRAMES = 4 / Math.PI, DIR8_HYST = 0.10;
  const ang = a => Math.atan2(Math.sin(a), Math.cos(a));
  function renderDir8(b, dir, nowMs) {
    const want = (b.state === 'walk' && b.faceA != null) ? ang(b.faceA) : DIR8_A[dir];
    if (want == null) return dir;
    const dt = Math.max(0, Math.min(100, nowMs - (b._rAt || 0)));
    b._rAt = nowMs;
    if (b._rA == null) { b._rA = want; b._rW = 0; b._turnAng = 0; }
    else {
      const turn = ang(want - b._rA), remain = Math.abs(turn);
      const s = dt / 1000;
      const target = Math.min(TURN_MAX, Math.sqrt(2 * TURN_ACCEL * remain));
      const cur = b._rW || 0;
      b._rW = cur < target ? Math.min(target, cur + TURN_ACCEL * s) : Math.max(target, cur - TURN_ACCEL * s);
      const swept = Math.min(remain, b._rW * s);
      b._rA = ang(b._rA + Math.sign(turn) * swept);
      b._turnAng = (b._turnAng || 0) + swept;
    }
    const cur = b._rD8;
    if (cur && DIR8_A[cur] != null && Math.abs(ang(b._rA - DIR8_A[cur])) < Math.PI / 8 + DIR8_HYST) return cur;
    let best = dir, bd = Infinity;
    for (const d in DIR8_A) {
      const t = Math.abs(ang(b._rA - DIR8_A[d]));
      if (t < bd) { bd = t; best = d; }
    }
    return (b._rD8 = best);
  }
  function pick8(set, names, dir8, dir) {
    if (dir8 !== dir) {
      for (const n of names) {
        const k = set + '.' + n + '.' + dir8;
        if (frames[k]) return k;
      }
    }
    return pick(set, names, dir);
  }

  /* resolve the track + frame index a body shows right now (shared by drawBody and the portrait) */
  function resolve(b, nowMs, reduced) {
    const set = setOf(b);
    const dir = b.dir || 'south';
    const aph = (b.aph != null ? b.aph : (b.phase || 0));
    const dir8 = renderDir8(b, dir, nowMs);
    let key = null, fps = 8, fixedIdx = null, turnStep = false;
    const emoting = b.emote && b.emote.until > nowMs && frames[set + '.emote.south'];
    if (emoting) {
      key = set + '.emote.south';
      const n = frames[key].length;
      fixedIdx = Math.min(n - 1, Math.max(0, Math.floor((nowMs - b.emote.start) / (b.emote.frameMs || 125))));
    } else if (b.state === 'walk') {
      key = pick8(set, ['walk'], dir8, dir); fps = 10;
    } else if (b.sleeping) {
      key = pick(set, ['sleep', 'rot'], dir); fps = 1.6;
    } else if (b.speaking) {
      key = pick(set, ['talk', 'rot'], dir); fps = 7;
    } else {
      key = pick8(set, ['rot'], dir8, dir);
      if ((b._rW || 0) > TURN_STEP_W) {
        const wk = pick8(set, ['walk'], dir8, dir);
        if (wk) { key = wk; turnStep = true; }
      }
      // idle blink, staggered per body; keyed off the resolved direction
      if (!reduced && key && key.indexOf('.rot.') !== -1) {
        const bk = set + '.blink.' + key.slice(key.lastIndexOf('.') + 1);
        if (frames[bk] && (nowMs + aph * 900) % 3300 < 130) key = bk;
      }
    }
    return { set, key, fps, fixedIdx, turnStep, aph };
  }

  function frameIndex(b, r, fr, nowMs, sc) {
    if (r.fixedIdx != null) return r.fixedIdx;
    if (r.turnStep) return Math.floor((b._turnAng || 0) * TURN_STEP_FRAMES * (fr.length / 6) + r.aph);
    if (r.key.indexOf('.walk.') !== -1 && b.odo != null) {
      const stride = metaFor(r.set).cycle * sc / fr.length;
      if (stride > 0) return Math.floor(b.odo / stride + r.aph);
    }
    return Math.floor(nowMs / (1000 / r.fps) + r.aph * 3);
  }

  /* main draw: foot-anchored at (b.px, b.py) */
  function drawBody(ctx, b, nowMs, appearance) {
    const reduced = !!(appearance && appearance.reducedMotion);
    const set = setOf(b);
    if (!loadedSets.has(set)) { if (!api.manualLoad) loadSet(set); return null; }
    const r = resolve(b, nowMs, reduced);
    if (!r.key) return null;
    b._pose = r.key;
    const fr = frames[r.key];
    if (!fr || !fr.length) return null;
    const sc = drawScaleFor(set);
    const meta = metaFor(set);
    const idx = frameIndex(b, r, fr, nowMs, sc);
    const f = fr[((idx % fr.length) + fr.length) % fr.length];
    const dw = meta.fw * sc, dh = meta.fh * sc;
    const _m = ctx.getTransform ? ctx.getTransform() : null;
    const zs = (_m && _m.a > 0) ? _m.a : 1;
    const snap = v => Math.round(v * zs) / zs;
    const GROUND_BITE = -1.5;
    const pad = meta.foot * sc;
    const x = snap(b.px - dw / 2);
    const y = snap(b.py - dh + GROUND_BITE + pad);
    const shR = Math.max(4.5, 7.2);
    if (!b.noShadow && !(appearance && appearance.skipGroundShadow)) groundShadow(ctx, b.px, b.py, shR, {});
    // crisp pixels once an art pixel covers ~2 device pixels; smooth resampling below that
    const prevSmooth = ctx.imageSmoothingEnabled;
    const crisp = sc * zs >= 1.75;
    ctx.imageSmoothingEnabled = !crisp;
    if (!crisp && 'imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    try { ctx.drawImage(f.img, f.sx, f.sy, f.w, f.h, x + f.ox * sc, y + f.oy * sc, f.w * sc, f.h * sc); }
    finally { ctx.imageSmoothingEnabled = prevSmooth; }
    return { top: y + meta.head * sc, w: Math.round(dw * 0.5), h: dh, x: x, y: y, sc: sc };
  }

  /* draw the body's CURRENT frame (talk/emote/blink included) into any 2D context, e.g. the dialogue
     portrait. (dx,dy) = where the logical frame's (0,0) lands, k = pixels per art pixel; crisp. */
  function drawFrameTo(ctx, b, nowMs, dx, dy, k) {
    const set = setOf(b);
    if (!loadedSets.has(set)) return false;
    const r = resolve(Object.assign({}, b, { state: 'idle', _rA: undefined, _rW: 0, _rAt: nowMs }), nowMs, false);
    const fr = r.key && frames[r.key];
    if (!fr) return false;
    const f = fr[((frameIndex(b, r, fr, nowMs, 1) % fr.length) + fr.length) % fr.length];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f.img, f.sx, f.sy, f.w, f.h, dx + f.ox * k, dy + f.oy * k, f.w * k, f.h * k);
    return true;
  }

  /* ---------- loading: one atlas image per set ---------- */
  function loadImage(path) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = path;
    });
  }

  function loadSet(set) {
    const key = String(set || '').trim();
    if (!key || !tracksBySet || !man) return Promise.resolve(false);
    if (setJobs[key]) return setJobs[key];
    const sheet = man.sheets && man.sheets[key];
    const tracks = tracksBySet[key] || [];
    if (!sheet || !tracks.length) return Promise.resolve(false);
    const t0 = performance.now();
    setJobs[key] = loadImage('assets/sprites/' + sheet).then(img => {
      if (!img) return false;
      const m = metaFor(key);
      const cache = {};
      for (const [track, refs] of tracks) {
        frames[track] = refs.map(ref => {
          const ck = ref.join(',');
          return cache[ck] || (cache[ck] = { img, sx: ref[0], sy: ref[1], w: ref[2], h: ref[3], ox: ref[4], oy: ref[5], width: m.fw, height: m.fh });
        });
      }
      loadedSets.add(key);
      loadTimes[key] = Math.round(performance.now() - t0);
      ready = true;
      return true;
    });
    return setJobs[key];
  }

  function ensureSkin(skin) { return loadSet((DATA.SKINS[skin] && DATA.SKINS[skin].set) || ''); }
  function isSkinReady(skin) { return loadedSets.has((DATA.SKINS[skin] && DATA.SKINS[skin].set) || ''); }

  async function init() {
    loading = true;
    try {
      man = window.EOG_MANIFEST;   // injected by assets/sprites/manifest.js (no fetch -> works on file://)
      if (!man || !man.sprites) return;
      tracksBySet = SpriteLoadPlan.groupTracks(man.sprites);
    } catch (e) { console.warn('[SPRITES] manifest missing', e); }
    finally { loading = false; }
  }

  const api = {
    init, drawBody, drawFrameTo, groundShadow, ensureSkin, isSkinReady, bodyScale, metaFor,
    manualLoad: false,
    loadStats: () => ({ loaded: Array.from(loadedSets), ms: Object.assign({}, loadTimes) }),
    get ready() { return ready; }, get loading() { return loading; }
  };
  return api;
})();
