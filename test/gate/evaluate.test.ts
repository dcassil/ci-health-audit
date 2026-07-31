import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../../src/gate/evaluate.js';
import { failMessage, gateJson, passMessage } from '../../src/gate/messages.js';

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
