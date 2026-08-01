// Public API for apps/b — contains a deliberate 2-module import cycle so its
// health score is distinct from packages/a (makes the mean a real average).
export { alpha } from './lib/alpha.js';
export { beta } from './lib/beta.js';
