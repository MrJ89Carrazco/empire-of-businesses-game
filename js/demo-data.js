/* EMPIRE OF GODS demo — the DATA shim js/assets.js expects.
   One original atlas set per god, rendered by tools/artgen (all sets share one 130x150 logical frame
   and one body rig, so they share one scale and stand the same height on the floor). */
'use strict';

const DATA = { AGENT: {} };
DATA.SKINS = {};
['zeus', 'hera', 'athena', 'hermes', 'hephaestus', 'apollo', 'hades', 'dionysus',
  'poseidon', 'ares', 'artemis', 'aphrodite', 'demeter'].forEach(function (id) {
  DATA.SKINS[id] = { name: id.charAt(0).toUpperCase() + id.slice(1), set: id, scale: 0.32 };
});
DATA.DEFAULT_SKIN = 'zeus';
