import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchMembers } from './members.js';
import { Automation } from './automation.js';
import { PATIENT_ROLE_ID } from './state.js';

const page = (start, count) => new Map(Array.from({ length: count }, (_, i) => {
  const id = String(start + i);
  return [id, { id }];
}));

test('member listing uses REST and combines all pages including an exact full page', async () => {
  const calls = [];
  const pages = [page(1, 1000), page(1001, 1000), new Map()];
  const guild = { members: {
    fetch: () => { throw new Error('Request with opcode 8 was rate limited'); },
    list: async options => { calls.push(options); return pages.shift(); },
  } };
  const members = await fetchMembers(guild);
  assert.equal(members.size, 2000);
  assert.equal(members.get('2000').id, '2000');
  assert.deepEqual(calls, [{ limit: 1000 }, { limit: 1000, after: '1000' }, { limit: 1000, after: '2000' }]);
});

test('member listing fails closed on a later page error or a repeated page', async () => {
  let calls = 0;
  await assert.rejects(fetchMembers({ members: { list: async () => {
    if (calls++) throw new Error('Cannot read member list');
    return page(1, 1000);
  } } }), /Cannot read member list/);
  await assert.rejects(fetchMembers({ members: { list: async () => page(1, 1000) } }), /did not advance/);
});

test('daily reminder and streak backfill finish when gateway member fetches are rate limited', async () => {
  const member = { id: '123', user: { bot: false }, roles: { cache: new Map([[PATIENT_ROLE_ID, {}]]) } };
  let rosterReads = 0;
  const sent = [];
  const store = { data: { grants: {}, jobs: {}, missingStreaks: {}, lastClosedDay: '2026-10-18' }, save() {} };
  const automation = new Automation({
    guild: { id: 'guild', members: {
      fetch: async () => { throw new Error('Request with opcode 8 was rate limited'); },
      list: async () => { rosterReads++; return new Map([[member.id, member]]); },
    } },
    channel: { messages: { fetch: async () => new Map() } },
    reminder: { messages: { fetch: async () => new Map() }, send: async payload => { sent.push(payload); return { id: 'sent' }; } },
    store, timezone: 'Europe/Paris', botId: 'bot', now: () => Date.parse('2026-10-20T10:00:00Z'),
  });
  automation.syncToday = async () => {};
  await automation.tick();
  assert.equal(rosterReads, 10);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions.users, ['123']);
  assert.equal(store.data.missingStreaks['123'], 10);
  assert.equal(store.data.lastClosedDay, '2026-10-19');
  await automation.tick();
  assert.equal(sent.length, 1);
});
