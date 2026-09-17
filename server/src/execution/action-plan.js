const RISK_ORDER = Object.freeze({ R0: 0, R1: 1, R2: 2, R3: 3 });
const ACTIONS = new Set(['launch_app', 'open_url', 'click_text', 'click_id', 'tap', 'long_press', 'scroll', 'type_text', 'key_enter', 'home', 'back', 'recents', 'notifications', 'quick_settings']);

function riskFor(action) {
  if (['home', 'back', 'recents', 'notifications', 'quick_settings'].includes(action)) return 'R0';
  if (['launch_app', 'open_url', 'scroll', 'click_text', 'click_id', 'tap', 'long_press', 'key_enter'].includes(action)) return 'R1';
  if (action === 'type_text') return 'R2';
  return 'R3';
}

function normalizeStep(step) {
  if (!step || typeof step !== 'object' || !ACTIONS.has(step.action)) throw new Error('Ação não suportada');
  const risk = step.risk || riskFor(step.action);
  if (!(risk in RISK_ORDER)) throw new Error('Risco inválido');
  return {
    action: step.action,
    target: step.target == null ? undefined : String(step.target).slice(0, 500),
    value: step.value == null ? undefined : String(step.value).slice(0, 2000),
    risk,
    verification: step.verification && typeof step.verification === 'object' ? step.verification : null,
  };
}

function buildPlan(goal, steps, confirmation = false) {
  const normalized = Array.isArray(steps) ? steps.map(normalizeStep) : [];
  if (!String(goal || '').trim() || normalized.length === 0 || normalized.length > 20) throw new Error('Plano inválido');
  const maxRisk = normalized.reduce((m, s) => Math.max(m, RISK_ORDER[s.risk]), 0);
  return {
    goal: String(goal).trim().slice(0, 1000),
    risk: Object.keys(RISK_ORDER).find(k => RISK_ORDER[k] === maxRisk),
    requiresConfirmation: maxRisk >= RISK_ORDER.R2 && confirmation !== true,
    steps: normalized,
    stop_if: ['emergency_stop', 'unexpected_screen', 'verification_failed', 'lease_expired'],
  };
}

module.exports = { RISK_ORDER, ACTIONS, riskFor, normalizeStep, buildPlan };
