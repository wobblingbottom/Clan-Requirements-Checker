import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeoffDate, formatTimeoffDate } from './timeoff-date.js';

test('member dates use day and abbreviated month in the current local year', () => {
  assert.equal(parseTimeoffDate('16 Sep', '2026-09-16'), '2026-09-16');
  assert.equal(parseTimeoffDate(' 1 OCT ', '2026-09-16'), '2026-10-01');
  assert.equal(parseTimeoffDate('1 Jan', '2026-12-31'), '2026-01-01');
  assert.equal(parseTimeoffDate('2027-01-01', '2026-12-31'), '2027-01-01');
  assert.equal(formatTimeoffDate('2026-01-01'), '1 Jan');
});

test('reject impossible dates, unknown months and non-leap-year February 29', () => {
  for (const value of ['31 Apr', '0 Sep', '16 September', '12 Abc', '29 Feb']) {
    assert.throws(() => parseTimeoffDate(value, '2026-01-01'), /Enter a day/);
  }
  assert.equal(parseTimeoffDate('29 feb', '2028-01-01'), '2028-02-29');
});
