import { describe, it, expect } from '@jest/globals';
import {
  SANCTION_POLICY_MATRIX,
  POLICY_STRIKE_LEVELS,
  toStrikeLevel,
  calculatePolicySanction,
  checkActionPolicyCompliance,
} from '../../src/modules/safety/moderation-policy.rules.js';
import {
  calculateVelocity,
  calculatePattern,
  calculateCredibility,
  buildMonitoringSnapshot,
  withRestrictionOutcome,
  calculateCorroboration,
  incidentKeyOf,
  MIN_CORROBORATING_REPORTERS,
} from '../../src/modules/safety/enforcement-metrics.rules.js';
import {
  REPORT_CATEGORIES,
  REPORT_SEVERITY,
  REPORT_ACTION_TYPES,
} from '../../src/modules/safety/safety.constants.js';

const STRIKE_PRIOR_COUNTS = [0, 1, 2];

describe('moderation-policy.rules', () => {
  it('maps prior sanctions to strike levels', () => {
    expect(toStrikeLevel(0)).toBe(POLICY_STRIKE_LEVELS.FIRST);
    expect(toStrikeLevel(1)).toBe(POLICY_STRIKE_LEVELS.SECOND);
    expect(toStrikeLevel(2)).toBe(POLICY_STRIKE_LEVELS.THIRD_PLUS);
    expect(toStrikeLevel(9)).toBe(POLICY_STRIKE_LEVELS.THIRD_PLUS);
  });

  describe.each(Object.keys(SANCTION_POLICY_MATRIX))('category %s', (category) => {
    it.each(STRIKE_PRIOR_COUNTS)('returns the matrix rule for %i prior sanction(s)', (prior) => {
      const result = calculatePolicySanction(category, REPORT_SEVERITY.MEDIUM, prior);
      const rule = SANCTION_POLICY_MATRIX[category][toStrikeLevel(prior)];

      expect(result.strikeCount).toBe(prior + 1);
      expect(result.clause).toBe(SANCTION_POLICY_MATRIX[category].clause);
      expect(result.standardActions).toEqual(rule.actions);
      expect(result.allowedActionTypes).toEqual(rule.allowedTypes);
      // Every standard action is an allowed one
      result.standardActions.forEach((a) => expect(result.allowedActionTypes).toContain(a.type));
    });
  });

  it('falls back to the "other" rule for an unknown category', () => {
    const result = calculatePolicySanction('unknown', REPORT_SEVERITY.LOW, 0);
    expect(result.clause).toBe(SANCTION_POLICY_MATRIX[REPORT_CATEGORIES.OTHER].clause);
  });

  it('escalates a critical non child-safety report to clause 0.1', () => {
    const result = calculatePolicySanction(REPORT_CATEGORIES.SPAM, REPORT_SEVERITY.CRITICAL, 0);
    expect(result.clause).toContain('Điều 0.1');
    expect(result.allowedActionTypes).toContain(REPORT_ACTION_TYPES.BAN);
  });

  it('drops actions that do not fit the report target', () => {
    const result = calculatePolicySanction(REPORT_CATEGORIES.HARASSMENT, REPORT_SEVERITY.HIGH, 0, 'user');
    expect(result.allowedActionTypes).not.toContain(REPORT_ACTION_TYPES.DELETE_MESSAGE);
    expect(result.standardActions.every((a) => a.type !== REPORT_ACTION_TYPES.DELETE_MESSAGE)).toBe(true);
  });

  describe('checkActionPolicyCompliance', () => {
    const policy = calculatePolicySanction(REPORT_CATEGORIES.HARASSMENT, REPORT_SEVERITY.HIGH, 1, 'message');

    it('never requires an override without an assessment', () => {
      expect(checkActionPolicyCompliance(REPORT_ACTION_TYPES.BAN, null).isOverride).toBe(false);
    });

    it('requires an override for an action out of the matrix', () => {
      expect(checkActionPolicyCompliance(REPORT_ACTION_TYPES.BAN, policy).isOverride).toBe(true);
    });

    it('accepts a standard suspension of the standard length', () => {
      expect(checkActionPolicyCompliance(REPORT_ACTION_TYPES.SUSPEND, policy, 7).isOverride).toBe(false);
    });

    it('requires an override for a suspension of another length', () => {
      const result = checkActionPolicyCompliance(REPORT_ACTION_TYPES.SUSPEND, policy, 30);
      expect(result.isOverride).toBe(true);
      expect(result.reasonRequired).toBe(true);
    });
  });
});

describe('enforcement-metrics.rules', () => {
  const evidenceless = (reporterId) => ({ reporterId, targetMessageId: null, evidenceUrls: [] });

  it('counts unique reporters in the window, not the raw report count', () => {
    const velocity = calculateVelocity([evidenceless('a'), evidenceless('a'), evidenceless('b')]);
    expect(velocity.reportsIn30MinCount).toBe(3);
    expect(velocity.uniqueReportersCount).toBe(2);
    expect(velocity.riskLevel).toBe('medium');
    expect(velocity.isHighVelocityRisk).toBe(false);
  });

  it('flags 3+ reporters without direct evidence as coordinated', () => {
    const pattern = calculatePattern([evidenceless('a'), evidenceless('b'), evidenceless('c')]);
    expect(pattern.coordinatedSuspected).toBe(true);
  });

  it('gives a new account or one without confirmed reports normal credibility', () => {
    expect(calculateCredibility({ createdAt: new Date() }, { totalSubmitted: 3, confirmedCount: 2 }).level).toBe('normal');
    expect(calculateCredibility(null, { totalSubmitted: 1, confirmedCount: 0 }).level).toBe('normal');
    expect(calculateCredibility(null, { totalSubmitted: 4, confirmedCount: 2 }).level).toBe('high');
    expect(calculateCredibility(null, { totalSubmitted: 4, confirmedCount: 0, dismissedCount: 3 }).level).toBe('low');
  });

  it('never recommends a restriction on suspected brigading', () => {
    const snapshot = buildMonitoringSnapshot(
      { severity: REPORT_SEVERITY.MEDIUM },
      { reportsIn30Min: [evidenceless('a'), evidenceless('b'), evidenceless('c')] }
    );
    expect(snapshot.reporterCredibility.coordinatedSuspected).toBe(true);
    expect(snapshot.temporaryRestriction.applied).toBe(false);
  });

  it('recommends a restriction for 3+ independent reporters with evidence', () => {
    const withEvidence = (id, msg) => ({ reporterId: id, targetMessageId: msg, evidenceUrls: [] });
    const snapshot = buildMonitoringSnapshot(
      { severity: REPORT_SEVERITY.MEDIUM },
      { reportsIn30Min: [withEvidence('a', 'm1'), withEvidence('b', 'm2'), withEvidence('c', 'm3')] }
    );
    expect(snapshot.temporaryRestriction.applied).toBe(true);
  });

  it('clears a recommended restriction that was not enforced', () => {
    const snapshot = buildMonitoringSnapshot(
      { severity: REPORT_SEVERITY.CRITICAL },
      { reportsIn30Min: [] },
      { requiresTemporaryRestriction: true }
    );
    const settled = withRestrictionOutcome(snapshot, false);
    expect(settled.temporaryRestriction.applied).toBe(false);
    expect(settled.temporaryRestriction.steps).toEqual([]);
    expect(settled.investigationSteps.some((s) => s.includes('hạn chế nhắn tin'))).toBe(false);
    expect(withRestrictionOutcome(snapshot, true)).toBe(snapshot);
  });
});

describe('calculateCorroboration', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const report = (id, reporterId, extra = {}) => ({
    _id: id,
    reporterId,
    category: 'no_show',
    targetPlaydateId: `pd-${id}`,
    createdAt: new Date(now),
    ...extra,
  });

  it('needs the configured number of distinct parents', () => {
    expect(MIN_CORROBORATING_REPORTERS).toBe(3);
    const current = report('r3', 'p3');
    const result = calculateCorroboration(current, [report('r1', 'p1'), report('r2', 'p2'), current]);
    expect(result.isCorroborated).toBe(true);
    expect(result.reporterCount).toBe(3);
    expect(result.relatedReportIds).toEqual(['r1', 'r2']);
  });

  it('never counts the same parent twice', () => {
    const current = report('r3', 'p1');
    const result = calculateCorroboration(current, [report('r1', 'p1'), report('r2', 'p2')]);
    expect(result.reporterCount).toBe(2);
    expect(result.isCorroborated).toBe(false);
  });

  it('ignores other categories, reports out of the window, without evidence or from low-credibility parents', () => {
    const current = report('r0', 'p0');
    const result = calculateCorroboration(
      current,
      [
        report('a', 'p1', { category: 'spam' }),
        report('b', 'p2', { createdAt: new Date(now - 8 * DAY) }),
        report('c', 'p3', { targetPlaydateId: null }),
        report('d', 'p4'),
      ],
      { lowCredibilityReporterIds: ['p4'] }
    );
    expect(result.reporterCount).toBe(1);
    expect(result.relatedReportIds).toEqual([]);
  });

  it('counts reports filed after it too, when an older report is looked at again', () => {
    const current = report('r1', 'p1', { createdAt: new Date(now - 3 * DAY) });
    const result = calculateCorroboration(current, [
      report('r2', 'p2', { createdAt: new Date(now - 2 * DAY) }),
      report('r3', 'p3', { createdAt: new Date(now) }),
      report('r4', 'p4', { createdAt: new Date(now + 5 * DAY) }),
    ]);
    expect(result.reporterCount).toBe(3);
    expect(result.relatedReportIds).toEqual(['r2', 'r3']);
  });

  it('counts reports on the same playdate as one incident', () => {
    const current = report('r3', 'p3', { targetPlaydateId: 'same' });
    const result = calculateCorroboration(current, [
      report('r1', 'p1', { targetPlaydateId: 'same' }),
      report('r2', 'p2', { targetPlaydateId: 'same' }),
    ]);
    expect(result.isCorroborated).toBe(true);
    expect(result.incidentCount).toBe(1);
  });
});

describe('incidentKeyOf', () => {
  it('groups by playdate, then message, else the report itself', () => {
    expect(incidentKeyOf({ _id: 'r', targetPlaydateId: 'p' })).toBe('playdate:p');
    expect(incidentKeyOf({ _id: 'r', targetMessageId: 'm' })).toBe('message:m');
    expect(incidentKeyOf({ _id: 'r' })).toBe('report:r');
  });
});
