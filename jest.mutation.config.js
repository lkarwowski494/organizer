/**
 * Testy mutacyjne (Stryker, stryker.config.json): tylko projekt „domain” z jest.config.js — logika ma własne testy,
 * a testy ekranów uruchamiane przy każdym mutancie wydłużały nocny przebieg ponad limit zadania GitHub Actions
 * (audyt 2, D-1: 1113 z 5207 mutantów po 60 min).
 */
const base = require('./jest.config');

module.exports = { projects: base.projects.filter((p) => p.displayName === 'domain') };
