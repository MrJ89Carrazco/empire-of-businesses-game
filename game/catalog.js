/* Fictional business categories for a practice campaign. No live organizations are represented. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmpireCatalog = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const businesses = [
    { id: 'web', name: 'Web Studio', sector: 'Client delivery', god: 'Hephaestus', icon: '⌘', color: '#69d9df', component: 'client-services', dependsOn: [], offer: 'Recurring website care and delivery', artifact: 'Service scope and acceptance checklist', mission: 'Deliver a sample website care sprint' },
    { id: 'drywall', name: 'Home Services', sector: 'Local services', god: 'Hermes', icon: '▥', color: '#e1b878', component: 'client-services', dependsOn: ['web'], offer: 'Scheduling and customer intake for home services', artifact: 'Lead intake and qualification checklist', mission: 'Rehearse a qualified lead handoff' },
    { id: 'kdp', name: 'Publishing Studio', sector: 'Creative products', god: 'Apollo', icon: '▤', color: '#c1b2ff', component: 'content-studio', dependsOn: ['web'], offer: 'Books and publishing assets', artifact: 'Book concept and rights checklist', mission: 'Rehearse an editorial production sprint' },
    { id: 'affiliate', name: 'Review Desk', sector: 'Affiliate media', god: 'Athena', icon: '◈', color: '#89baa4', component: 'content-studio', dependsOn: ['web'], offer: 'Evidence-led affiliate content', artifact: 'Content outline and disclosure checklist', mission: 'Rehearse a reviewed comparison article' },
    { id: 'apparel', name: 'Apparel Studio', sector: 'Apparel', god: 'Ares', icon: '⚑', color: '#dca0b1', component: 'content-studio', dependsOn: ['affiliate'], offer: 'Apparel and print-on-demand concepts', artifact: 'Product brief and sample quality checklist', mission: 'Rehearse a sample product release' },
    { id: 'corporate', name: 'Research Services', sector: 'Research services', god: 'Hades', icon: '⬡', color: '#b6bfcf', component: 'operations-hub', dependsOn: ['drywall'], offer: 'Research and information services', artifact: 'Research intake and review checklist', mission: 'Rehearse a reviewed opportunity dossier' },
    { id: 'property', name: 'Property Research', sector: 'Property research', god: 'Poseidon', icon: '⌂', color: '#8db4e4', component: 'operations-hub', dependsOn: ['corporate'], offer: 'Property information research and review', artifact: 'Property research scope and review checklist', mission: 'Rehearse a property research handoff' },
    { id: 'housing', name: 'Community Programs', sector: 'Community operations', god: 'Hera', icon: '♜', color: '#baa4d6', component: 'operations-hub', dependsOn: ['property'], offer: 'Community event planning and operations', artifact: 'Program scope and qualified-review checklist', mission: 'Rehearse a program-readiness review' },
    { id: 'fitness', name: 'Fitness Studio', sector: 'Fitness', god: 'Artemis', icon: '△', color: '#c4ca8b', component: 'operations-hub', dependsOn: ['drywall'], offer: 'Fitness business and service planning', artifact: 'Service concept and qualified-review checklist', mission: 'Rehearse a service onboarding flow' }
  ];
  const missions = businesses.flatMap(b => [
    { id: b.id + ':plan', business: b.id, stage: 'plan', title: 'Build the operating blueprint', description: b.artifact + '. Define the offer, evidence needed, owner, and review boundary.', requires: b.dependsOn.map(id => id + ':plan'), effort: 1, cost: 10, xp: 20, reward: 0 },
    { id: b.id + ':trial', business: b.id, stage: 'trial', title: b.mission, description: 'Practice the delivery loop with fictional outcomes. No customers, publishing, outreach, or spending are involved.', requires: [b.id + ':plan', ...b.dependsOn.map(id => id + ':trial')], effort: 2, cost: 20, xp: 40, reward: 50 }
  ]);
  return { businesses, missions, version: '1.0.0' };
});
