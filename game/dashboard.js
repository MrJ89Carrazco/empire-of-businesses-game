(function () {
  'use strict';
  const C = window.EmpireCatalog, M = window.EmpireModel;
  const $ = id => document.getElementById(id);
  // A public/static copy must never try to contact this machine's local services.
  const localBridge = ['http:', 'https:'].includes(location.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    && document.documentElement.dataset.deployment !== 'static';
  const byBusiness = new Map(C.businesses.map(b => [b.id, b]));
  const byMission = new Map(C.missions.map(m => [m.id, m]));
  let state = M.initial(), selected = 'web', feed = null, feedFailed = false, feedLoading = false, storageOK = true;
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function announce(message) { $('announcement').textContent = message; $('announcement').hidden = false; }
  function load() {
    let raw;
    try { raw = localStorage.getItem(M.STORAGE_KEY); }
    catch (_) { storageOK = false; announce('Browser storage is unavailable. Export a save before leaving this session.'); }
    if (raw) { try { state = M.restore(raw); } catch (e) { announce('Your saved campaign could not be loaded. A fresh practice session is shown. ' + e.message); } }
    $('save-status').textContent = storageOK ? 'Saved on this browser' : 'Session only · export to keep';
  }
  function save() {
    try { localStorage.setItem(M.STORAGE_KEY, M.serialize(state)); storageOK = true; }
    catch (_) { storageOK = false; }
    $('save-status').textContent = storageOK ? 'Saved on this browser' : 'Session only · export to keep';
    return storageOK;
  }
  function saveNote(saved) { return saved ? ' Your progress is saved locally.' : ' Session only: browser storage is unavailable. Export a save before leaving.'; }
  function act(event) {
    try {
      // Read before every mutation so an older tab cannot award a completed mission twice.
      if (storageOK) { try { const raw = localStorage.getItem(M.STORAGE_KEY); if (raw) state = M.restore(raw); } catch (_) { /* current validated session remains playable */ } }
      state = M.transition(state, event); const saved = save(); renderPractice();
      if (event.type === 'next-day') announce('Practice day ' + state.day + '. Focus restored to 6.' + saveNote(saved));
      else {
        const m = byMission.get(event.id), b = byBusiness.get(m.business);
        announce(b.name + ': ' + m.title + ' completed in simulation.' + (state.completed.length === 18 ? ' Campaign complete! All nine practice delivery loops are connected.' : '') + saveNote(saved));
        $('mission-business').focus({ preventScroll: true });
      }
    } catch (e) { announce(e.message); renderPractice(); }
  }
  function renderPractice() {
    const complete = state.completed.length;
    const loops = C.businesses.filter(b => M.businessProgress(state, b.id) === 2).length;
    $('mission-count').textContent = complete;
    $('progress-bar').style.width = (complete / 18 * 100) + '%';
    $('loop-count').textContent = loops + ' / 9 delivery loops';
    $('xp-count').textContent = state.xp + ' XP';
    $('rank').textContent = complete === 18 ? 'EMPIRE BUILDER' : complete >= 10 ? 'NETWORK ARCHITECT' : complete >= 4 ? 'OPERATOR' : 'APPRENTICE';
    $('day-value').textContent = String(state.day).padStart(2, '0');
    $('focus-value').textContent = state.effort + ' / 6';
    $('credits-value').textContent = state.credits;
    $('next-day').disabled = state.effort === 6 || complete === 18;
    $('business-grid').replaceChildren(...C.businesses.map((b, i) => {
      const count = M.businessProgress(state, b.id);
      const button = el('button', 'business-card' + (selected === b.id ? ' selected' : ''));
      button.type = 'button'; button.dataset.business = b.id; button.setAttribute('aria-pressed', String(selected === b.id));
      const top = el('div', 'card-top'); top.append(el('span', 'business-icon', b.icon), el('span', 'business-index', String(i + 1).padStart(2, '0')));
      button.append(top, el('span', 'business-name', b.name), el('span', 'business-sector', b.sector));
      button.append(el('span', 'business-link', b.dependsOn.length ? '↳ ' + b.dependsOn.map(id => byBusiness.get(id).name).join(' + ') : '◆ Network foundation'));
      button.append(el('span', 'business-state' + (count === 2 ? ' complete' : ''), count === 2 ? '✓ DELIVERY LOOP COMPLETE' : count + ' / 2 MISSIONS · ' + b.god.toUpperCase()));
      button.addEventListener('click', () => { selected = b.id; renderPractice(); $('mission-business').focus({ preventScroll: true }); });
      return button;
    }));
    renderMissions(); renderLog();
  }
  function renderMissions() {
    const b = byBusiness.get(selected), panel = $('mission-panel');
    panel.replaceChildren(el('span', 'micro', 'YOUR NEXT DELIVERY LOOP'));
    const header = el('div', 'mission-heading'), titles = el('div');
    const title = el('h2', '', b.name); title.id = 'mission-business'; title.tabIndex = -1;
    titles.append(title, el('p', '', 'Assigned crew · ' + b.god)); header.append(el('span', 'business-icon', b.icon), titles);
    panel.append(header, el('p', 'mission-offer', b.offer));
    C.missions.filter(m => m.business === selected).forEach((m, index) => {
      const section = el('section', 'mission-item');
      section.append(el('span', 'mission-step', '0' + (index + 1) + ' / ' + (m.stage === 'plan' ? 'DESIGN THE ENGINE' : 'PRACTICE DELIVERY')), el('h3', '', m.title), el('p', '', m.description));
      if (state.completed.includes(m.id)) { section.append(el('div', 'done-label', '✓ Completed in simulation')); }
      else {
        const check = M.status(state, m.id);
        const cost = el('div', 'mission-cost'); cost.append(el('span', '', m.effort + ' focus'), el('span', '', m.cost + ' credits'), el('span', '', '+' + m.xp + ' XP')); section.append(cost);
        if (check.missing && check.missing.length) {
          section.append(el('div', 'locked-copy', 'Needs: ' + check.missing.map(id => { const required = byMission.get(id); return byBusiness.get(required.business).name + ' · ' + (required.stage === 'plan' ? 'blueprint' : 'delivery'); }).join('; ')));
        } else {
          const button = el('button', 'primary', m.stage === 'plan' ? 'Build practice blueprint →' : 'Focused trial · +50 credits →');
          button.type = 'button'; button.dataset.mission = m.id; button.dataset.strategy = 'focused'; button.disabled = !check.allowed;
          button.addEventListener('click', () => act({ type: 'mission', id: m.id, strategy: 'focused' })); section.append(button);
          if (m.stage === 'trial') {
            const crafted = el('button', 'secondary', 'Crafted trial · 3 focus · +65 credits');
            crafted.type = 'button'; crafted.dataset.mission = m.id; crafted.dataset.strategy = 'crafted'; crafted.disabled = !check.allowed || state.effort < 3;
            crafted.addEventListener('click', () => act({ type: 'mission', id: m.id, strategy: 'crafted' })); section.append(crafted);
            section.append(el('p', '', 'Trade one extra focus for +15 practice credits and +20 XP. All rewards are fictional.'));
          }
          if (!check.allowed) section.append(el('div', 'locked-copy', check.reason));
        }
      }
      panel.append(section);
    });
    panel.append(el('p', 'mission-footnote', 'Campaign progress never changes real project status or authorizes a business action. Operations has its own evidence view.'));
  }
  function renderLog() {
    let day = 1; const entries = [];
    state.events.forEach(e => { if (e.type === 'next-day') { day++; return; } const m = byMission.get(e.id); entries.push({ day, mission: m, strategy: e.strategy }); });
    if (!entries.length) { $('activity-list').replaceChildren(el('li', 'empty-log', 'Begin with Web Studio. Its blueprint becomes a shared capability for three other engines.')); return; }
    $('activity-list').replaceChildren(...entries.slice(-6).reverse().map(entry => { const li = el('li'); li.append(el('span', 'log-day', 'DAY ' + entry.day), el('b', '', byBusiness.get(entry.mission.business).name), document.createTextNode(' · ' + (entry.mission.stage === 'plan' ? 'Blueprint created' : entry.strategy === 'crafted' ? 'Crafted trial delivered' : 'Focused trial delivered') + ' · simulated')); return li; }));
  }
  function isStale() { return !feed || feedFailed || Date.now() - Date.parse(feed.generated_at) > 120000 || Date.parse(feed.generated_at) > Date.now() + 300000; }
  function renderOperations() {
    const stale = isStale();
    $('feed-status').textContent = !localBridge ? 'Static practice mode' : !feed ? feedFailed ? 'Unavailable' : 'Not checked' : stale ? 'Stale snapshot' : feed.mode === 'offline' ? 'Offline bridge' : feed.sources.every(s => s.status === 'ok') ? 'Read-only · observed' : 'Read-only · partial';
    $('feed-time').textContent = feed ? new Date(feed.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + (stale ? ' · stale' : '') : '—';
    $('source-list').replaceChildren(...(feed ? feed.sources.map(s => el('span', 'source-pill', s.id + ' / ' + (stale ? 'stale · last: ' : '') + s.status)) : []));
    $('operation-businesses').replaceChildren(...C.businesses.map(b => {
      const project = feed && feed.projects.find(p => p.id === b.component);
      const row = el('div', 'operation-row'), copy = el('div');
      copy.append(el('h3', '', b.name), el('p', '', 'Business: unverified · Revenue: not connected'));
      copy.append(el('p', '', project ? (stale ? 'Stale registry snapshot. ' : '') + project.evidence + ' (component: ' + project.id + ')' : 'Shared component: ' + b.component + ' · no registry observation yet'));
      const brief = el('button', 'quiet', 'Export planning brief ↗'); brief.type = 'button'; brief.dataset.brief = b.id; brief.addEventListener('click', () => exportBrief(b));
      row.append(copy, brief); return row;
    }));
  }
  async function refreshFeed() {
    if (!localBridge) { announce('This hosted copy is practice-only. Local operations require the downloaded local bridge.'); return; }
    if (feedLoading) return; feedLoading = true; $('refresh-feed').disabled = true; $('refresh-feed').textContent = 'Reading local state…';
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
    try {
      if (!['http:', 'https:'].includes(location.protocol)) throw Error('Open with the included Start Empire launcher to read local state.');
      const response = await fetch('api/empire-state', { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw Error('State bridge returned HTTP ' + response.status + '. Launch Start Empire for the local endpoint.');
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw Error('State bridge did not return JSON.');
      if (!response.body) throw Error('Empty state feed.');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > M.MAX_FEED_BYTES) { await reader.cancel(); throw Error('State feed exceeded the safe size limit.'); } chunks.push(part.value); }
      const bytes = new Uint8Array(size); let offset = 0; chunks.forEach(c => { bytes.set(c, offset); offset += c.length; });
      const candidate = JSON.parse(new TextDecoder().decode(bytes));
      if (candidate.read_only !== true) throw Error('Only a read-only state feed is supported.');
      feed = M.validateFeed(candidate); feedFailed = false;
      $('feed-explanation').textContent = feed.mode === 'offline' ? 'The bridge is running in offline mode. To observe your existing local services, close it and run Start Empire Connected.cmd. No local services were probed in offline mode.' : 'This is a bounded observation of local services. Registry status is a documentation claim; reachability only confirms an HTTP response. Real revenue and business completion are not verified.';
      announce(feed.mode === 'offline' ? 'Offline bridge checked. No real business integrations were contacted.' : 'Local read-only snapshot received. Business metrics remain unverified.');
    } catch (e) { feedFailed = true; $('feed-explanation').textContent = (e.name === 'AbortError' ? 'State request timed out.' : e.message) + ' Any earlier snapshot is stale; practice mode remains available.'; announce('State feed unavailable. Your practice campaign is unaffected.'); }
    finally { clearTimeout(timer); feedLoading = false; $('refresh-feed').disabled = false; $('refresh-feed').textContent = 'Refresh local state ↻'; renderOperations(); }
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type })); const a = el('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBrief(b) {
    const project = feed && feed.projects.find(p => p.id === b.component);
    const text = ['EMPIRE OF GODS — LOCAL PLANNING BRIEF', b.name, '', 'Purpose: ' + b.offer, 'Shared component: ' + b.component, 'Required planning artifact: ' + b.artifact, '', 'STATUS', 'This is a draft planning brief, not a completed task or an authorization.', 'Business activity and revenue: unverified.', 'Registry observation: ' + (project ? project.evidence : 'none'), 'Snapshot timestamp: ' + (feed ? feed.generated_at : 'none'), 'Snapshot stale: ' + isStale(), '', 'REVIEW BEFORE REAL WORK', '[ ] Confirm owner, scope, deliverable, and acceptance criteria.', '[ ] Verify source systems, actual access, and independent business evidence.', '[ ] Verify rights, privacy, service suitability, and qualified review where required.', '[ ] Obtain separate approval for spending, publishing, outreach, or sensitive data.', '[ ] Keep regulated transactions and decisions in qualified, authorized systems.', '[ ] Run a bounded test and record its evidence before promoting status.', '', 'No jobs executed. No messages sent. No funds spent.', 'Practice campaign progress is deliberately excluded.'].join('\n');
    download(b.id + '-planning-brief.txt', text, 'text/plain'); announce(b.name + ' planning brief exported locally. Nothing was sent or executed.');
  }
  function setView(operations, navigate) {
    $('practice-view').hidden = operations; $('operations-view').hidden = !operations;
    $('campaign-score').hidden = operations;
    $('page-title').replaceChildren(document.createTextNode(operations ? 'Know what is running.' : 'Build the businesses.'), el('br'), el('em', '', operations ? 'Keep the evidence honest.' : 'Play the connections.'));
    $('view-copy').textContent = operations ? 'Inspect the shared foundation, see which observations are current, and prepare a reviewed next step for each business engine.' : 'Turn a collection of ideas into a connected empire. Plan each engine, borrow capabilities from its neighbors, and complete a delivery loop.';
    $('practice-tab').classList.toggle('active', !operations); $('operations-tab').classList.toggle('active', operations);
    $('practice-tab').setAttribute('aria-pressed', String(!operations)); $('operations-tab').setAttribute('aria-pressed', String(operations));
    $('view-kicker').textContent = operations ? 'READ-ONLY OPERATIONS' : 'THE PRACTICE CAMPAIGN';
    const notice = $('mode-notice'); notice.querySelector('.notice-tag').textContent = operations ? 'READ ONLY' : 'SIMULATION';
    notice.querySelector('p').textContent = operations ? 'Observed service health and registry claims stay separate from business outcomes.' : 'Practice credits, XP, and completions are fictional. Real business status stays separate.';
    if (operations && !localBridge) {
      $('view-kicker').textContent = 'PRACTICE-ONLY PLANNING';
      $('view-copy').textContent = 'Review the business concepts and export planning briefs. Live operations are available only through the downloaded local bridge.';
      notice.querySelector('.notice-tag').textContent = 'PRACTICE ONLY';
      notice.querySelector('p').textContent = 'This static website has no business backend, live revenue feed, or workflow execution.';
    }
    $('save-status').hidden = operations;
    if (navigate && location.hash !== (operations ? '#operations' : '#practice')) history.pushState(null, '', operations ? '#operations' : '#practice');
    renderOperations();
  }
  $('practice-tab').addEventListener('click', () => setView(false, true));
  $('operations-tab').addEventListener('click', () => setView(true, true));
  window.addEventListener('popstate', () => setView(location.hash === '#operations', false));
  $('next-day').addEventListener('click', () => act({ type: 'next-day' }));
  $('export-save').addEventListener('click', () => download('empire-practice-save.json', M.serialize(state), 'application/json'));
  $('import-save').addEventListener('change', async event => {
    const input = event.target, file = input.files[0];
    try { if (!file) return; if (file.size > 50000) throw Error('Save exceeds the 50 KB limit.'); const next = M.restore(await file.text()); state = next; const saved = save(); renderPractice(); announce('Practice save imported into this session.' + saveNote(saved)); }
    catch (e) { announce('Save was not imported: ' + e.message); }
    finally { input.value = ''; }
  });
  $('reset-save').addEventListener('click', () => $('reset-dialog').showModal());
  $('cancel-reset').addEventListener('click', () => $('reset-dialog').close());
  $('confirm-reset').addEventListener('click', () => { state = M.initial(); const saved = save(); renderPractice(); $('reset-dialog').close(); announce('Practice campaign reset in this session.' + saveNote(saved)); });
  $('refresh-feed').addEventListener('click', refreshFeed);
  window.addEventListener('storage', event => { if (event.key !== M.STORAGE_KEY) return; if (!storageOK) { announce('Another tab changed its saved progress. Your unsaved session is preserved; export it before reloading.'); return; } try { state = event.newValue ? M.restore(event.newValue) : M.initial(); renderPractice(); announce('Practice progress updated from another tab.'); } catch (_) { announce('An invalid save from another tab was ignored.'); } });
  if (!localBridge) {
    $('hosting-notice').hidden = false;
    $('refresh-feed').disabled = true;
    $('refresh-feed').textContent = 'Local bridge required';
    $('feed-explanation').textContent = 'GitHub Pages and other static hosts run the fictional practice campaign only. This copy does not contact local services. Download the source and run Start Empire locally for the optional read-only bridge.';
  }
  load(); renderPractice(); renderOperations(); setView(location.hash === '#operations', false);
  setInterval(() => { if (!$('operations-view').hidden && feed) renderOperations(); }, 10000);
})();
