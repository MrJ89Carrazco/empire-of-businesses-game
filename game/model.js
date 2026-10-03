(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'));
  else root.EmpireModel = factory(root.EmpireCatalog);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (catalog) {
  'use strict';
  const MAX_EVENTS = 150;
  const MAX_FEED_BYTES = 1024 * 1024;
  const STORAGE_KEY = 'eog.connected.practice.v1';
  const missionById = new Map(catalog.missions.map(m => [m.id, m]));
  function initial() { return { version: 1, day: 1, effort: 6, credits: 120, xp: 0, completed: [], events: [] }; }
  function status(state, id) {
    const mission = missionById.get(id);
    if (!mission) return { allowed: false, reason: 'Unknown mission.' };
    if (state.completed.includes(id)) return { allowed: false, reason: 'Already completed. Rewards cannot be claimed twice.' };
    const missing = mission.requires.filter(req => !state.completed.includes(req));
    if (missing.length) return { allowed: false, reason: 'Complete the linked prerequisites first.', missing };
    if (state.effort < mission.effort) return { allowed: false, reason: 'Not enough focus. Start the next practice day.' };
    if (state.credits < mission.cost) return { allowed: false, reason: 'Not enough practice credits.' };
    return { allowed: true, reason: 'Ready to practice.' };
  }
  function transition(state, event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw Error('Invalid action.');
    if (state.events.length >= MAX_EVENTS) throw Error('Campaign limit reached. Export your progress, then reset.');
    const next = { ...state, completed: [...state.completed], events: [...state.events] };
    if (event.type === 'next-day') {
      if (state.effort === 6) throw Error('Complete a mission before advancing the day.');
      if (state.completed.length === catalog.missions.length) throw Error('Campaign complete.');
      next.day += 1; next.effort = 6;
      next.events.push({ type: 'next-day' });
      return next;
    }
    if (event.type !== 'mission') throw Error('Unknown action.');
    const check = status(state, event.id);
    if (!check.allowed) throw Error(check.reason);
    const mission = missionById.get(event.id);
    const strategy = event.strategy || 'focused';
    if (!['focused', 'crafted'].includes(strategy)) throw Error('Unknown strategy.');
    if (mission.stage === 'plan' && strategy !== 'focused') throw Error('Blueprints use the focused strategy.');
    const extra = strategy === 'crafted' ? 1 : 0;
    if (state.effort < mission.effort + extra) throw Error('Crafted delivery needs one more focus.');
    next.effort -= mission.effort + extra;
    next.credits += mission.reward + extra * 15 - mission.cost;
    next.xp += mission.xp + extra * 20;
    next.completed.push(event.id);
    next.events.push({ type: 'mission', id: event.id, strategy });
    return next;
  }
  function serialize(state) { return JSON.stringify({ version: 1, mode: 'simulation', events: state.events }); }
  function restore(raw) {
    if (typeof raw !== 'string' || raw.length > 50000) throw Error('Save is too large or invalid.');
    let payload;
    try { payload = JSON.parse(raw); } catch (_) { throw Error('Save is not valid JSON.'); }
    if (!payload || payload.version !== 1 || payload.mode !== 'simulation' || !Array.isArray(payload.events) || payload.events.length > MAX_EVENTS) throw Error('Unsupported save format.');
    return payload.events.reduce((s, e) => transition(s, e), initial());
  }
  function businessProgress(state, id) { return state.completed.filter(m => m.startsWith(id + ':')).length; }
  function validateFeed(value) {
    // Strict display-only contract. Reject malformed feeds rather than upgrading claims.
    if (!value || value.read_only !== true || value.schema_version !== 1 || typeof value.generated_at !== 'string' || !Number.isFinite(Date.parse(value.generated_at))) throw Error('Unrecognized state-feed contract.');
    if (!['offline', 'connected'].includes(value.mode) || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 8 || !Array.isArray(value.projects) || value.projects.length > 100) throw Error('Invalid state-feed bounds.');
    const safe = s => typeof s === 'string' && Array.from(s).length <= 180 && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(s);
    const ids = new Set();
    value.sources.forEach(s => {
      if (!s || !['local-registry', 'local-runtime'].includes(s.id) || ids.has(s.id) || !['offline', 'ok', 'unavailable', 'invalid'].includes(s.status)) throw Error('Invalid source status.');
      ids.add(s.id);
    });
    const projectIds = new Set();
    const projects = value.projects.map(p => {
      if (!p || !safe(p.id) || !p.id || projectIds.has(p.id) || !safe(p.name) || !safe(p.evidence) || !Array.isArray(p.prerequisites) || p.prerequisites.length > 30 || p.prerequisites.some(s => !safe(s))) throw Error('Invalid project record.');
      projectIds.add(p.id);
      return { id: p.id, name: p.name, evidence: p.evidence, prerequisites: [...p.prerequisites] };
    });
    return { schema_version: 1, generated_at: value.generated_at, mode: value.mode, sources: value.sources.map(s => ({ id: s.id, status: s.status })), projects };
  }
  return { initial, status, transition, serialize, restore, businessProgress, validateFeed, STORAGE_KEY, MAX_FEED_BYTES };
});
