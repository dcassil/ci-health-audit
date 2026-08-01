import { describe, expect, it } from 'vitest';
import { evaluateGate, evaluateGateAll } from '../../src/gate/evaluate.js';
import {
  failAllMessage,
  failMessage,
  gateJson,
  passAllMessage,
  passMessage,
} from '../../src/gate/messages.js';

describe('evaluateGate — boundary and regression (TC-001)', () => {
  it('PASSES when newScore equals the floor', () => {
    const r = evaluateGate({ newScore: 5.4, lastScore: 7.4, threshold: -2 });
    expect(r.decision).toBe('pass');
    expect(r.floor).toBeCloseTo(5.4, 10);
    expect(r.seeded).toBe(false);
  });

  it('FAILS just below the floor', () => {
    const r = evaluateGate({ newScore: 5.3, lastScore: 7.4, threshold: -2 });
    expect(r.decision).toBe('fail');
    expect(r.seeded).toBe(false);
  });

  it('PASSES on improvement', () => {
    const r = evaluateGate({ newScore: 8.0, lastScore: 7.4, threshold: -2 });
    expect(r.decision).toBe('pass');
  });

  it('honors a -1 threshold: floor 6.4, 6.4 PASS, 6.3 FAIL', () => {
    expect(evaluateGate({ newScore: 6.4, lastScore: 7.4, threshold: -1 }).floor).toBeCloseTo(6.4, 10);
    expect(evaluateGate({ newScore: 6.4, lastScore: 7.4, threshold: -1 }).decision).toBe('pass');
    expect(evaluateGate({ newScore: 6.3, lastScore: 7.4, threshold: -1 }).decision).toBe('fail');
  });

  it('honors a -3 threshold: floor 4.4', () => {
    const r = evaluateGate({ newScore: 4.4, lastScore: 7.4, threshold: -3 });
    expect(r.floor).toBeCloseTo(4.4, 10);
    expect(r.decision).toBe('pass');
    expect(evaluateGate({ newScore: 4.3, lastScore: 7.4, threshold: -3 }).decision).toBe('fail');
  });
});

describe('evaluateGate — first-run seeding', () => {
  it('always PASSES with seeded=true when lastScore is 0, even for a low score', () => {
    const r = evaluateGate({ newScore: 0.1, lastScore: 0, threshold: -2 });
    expect(r.decision).toBe('pass');
    expect(r.seeded).toBe(true);
  });

  it('seeds even when newScore is also 0', () => {
    const r = evaluateGate({ newScore: 0, lastScore: 0, threshold: -2 });
    expect(r.decision).toBe('pass');
    expect(r.seeded).toBe(true);
  });
});

describe('evaluateGateAll — multi-project aggregation (CIHA-T-0017)', () => {
  it('overall PASS when every project passes, preserving order', () => {
    const r = evaluateGateAll([
      { name: 'core', newScore: 8.1, lastScore: 7.4, threshold: -2 },
      { name: 'cli', newScore: 6.0, lastScore: 7.0, threshold: -2 },
    ]);
    expect(r.decision).toBe('pass');
    expect(r.projects.map((p) => p.name)).toEqual(['core', 'cli']);
    expect(r.projects.every((p) => p.gate.decision === 'pass')).toBe(true);
  });

  it('overall FAIL when any project fails, naming it with floor and delta', () => {
    const r = evaluateGateAll([
      { name: 'core', newScore: 8.1, lastScore: 7.4, threshold: -2 },
      { name: 'cli', newScore: 4.5, lastScore: 7.0, threshold: -2 },
    ]);
    expect(r.decision).toBe('fail');

    const cli = r.projects.find((p) => p.name === 'cli');
    expect(cli?.gate.decision).toBe('fail');
    expect(cli?.gate.floor).toBeCloseTo(5.0, 10);
    // delta is derivable from the echoed scores.
    expect((cli?.gate.newScore ?? 0) - (cli?.gate.lastScore ?? 0)).toBeCloseTo(-2.5, 10);

    const core = r.projects.find((p) => p.name === 'core');
    expect(core?.gate.decision).toBe('pass');
  });

  it('applies the lastScore===0 seeding rule independently per project', () => {
    const r = evaluateGateAll([
      { name: 'fresh', newScore: 0.1, lastScore: 0, threshold: -2 },
      { name: 'established', newScore: 3.0, lastScore: 7.4, threshold: -2 },
    ]);
    // `fresh` seeds (pass), `established` regresses (fail) → overall fail.
    expect(r.decision).toBe('fail');
    const fresh = r.projects.find((p) => p.name === 'fresh');
    expect(fresh?.gate.decision).toBe('pass');
    expect(fresh?.gate.seeded).toBe(true);
    const established = r.projects.find((p) => p.name === 'established');
    expect(established?.gate.decision).toBe('fail');
    expect(established?.gate.seeded).toBe(false);
  });
});

describe('gate messages', () => {
  it('formats a PASS message at one decimal', () => {
    const r = evaluateGate({ newScore: 7.1, lastScore: 7.4, threshold: -2 });
    expect(passMessage(r)).toBe('PASS — score 7.1 ≥ floor 5.4 (last 7.4, threshold -2). Saved 7.1.');
  });

  it('formats a FAIL message at one decimal', () => {
    const r = evaluateGate({ newScore: 3, lastScore: 7.4, threshold: -2 });
    expect(failMessage(r)).toBe('FAIL — score 3.0 < floor 5.4 (last 7.4, threshold -2). Config not updated.');
  });

  it('builds the JSON gate object', () => {
    const r = evaluateGate({ newScore: 7.1, lastScore: 7.4, threshold: -2 });
    expect(gateJson(r)).toEqual({ decision: 'pass', floor: 5.4, lastScore: 7.4, threshold: -2 });
  });
});

describe('multi-project gate messages (CIHA-T-0018)', () => {
  it('passAllMessage summarizes count + saved baselines (plural)', () => {
    const r = evaluateGateAll([
      { name: 'core', newScore: 8.1, lastScore: 7.4, threshold: -2 },
      { name: 'cli', newScore: 6.0, lastScore: 7.0, threshold: -2 },
    ]);
    expect(passAllMessage(r)).toBe('PASS — all 2 projects held their floor. Saved 2 baselines.');
  });

  it('passAllMessage uses the singular for one project', () => {
    const r = evaluateGateAll([{ name: 'core', newScore: 8.1, lastScore: 7.4, threshold: -2 }]);
    expect(passAllMessage(r)).toBe('PASS — all 1 project held their floor. Saved 1 baselines.');
  });

  it('failAllMessage names each failing project with floor, actual, and delta', () => {
    const r = evaluateGateAll([
      { name: 'core', newScore: 8.1, lastScore: 7.4, threshold: -2 },
      { name: 'cli', newScore: 4.5, lastScore: 7.0, threshold: -2 },
    ]);
    const msg = failAllMessage(r);
    expect(msg).toContain('FAIL — 1 project regressed beyond its floor. Config not updated.');
    expect(msg).toContain('cli — score 4.5 < floor 5.0 (last 7.0, threshold -2, delta -2.5)');
    // Passing project is not listed.
    expect(msg).not.toContain('core —');
  });

  it('failAllMessage lists multiple failing projects and uses the plural header', () => {
    const r = evaluateGateAll([
      { name: 'core', newScore: 3.0, lastScore: 7.4, threshold: -2 },
      { name: 'cli', newScore: 4.5, lastScore: 7.0, threshold: -2 },
    ]);
    const msg = failAllMessage(r);
    expect(msg).toContain('FAIL — 2 projects regressed beyond their floor. Config not updated.');
    expect(msg).toContain('core — score 3.0 < floor 5.4');
    expect(msg).toContain('cli — score 4.5 < floor 5.0');
  });
});
