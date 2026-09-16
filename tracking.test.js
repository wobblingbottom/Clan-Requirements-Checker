import test from 'node:test';
import assert from 'node:assert/strict';
import { dayAt, validDay, hasImage, collectSubmissions, latestScreenshot } from './tracking.js';

test('Paris calendar dates cross UTC midnight and daylight saving boundaries', () => {
  assert.equal(dayAt(Date.parse('2026-09-14T22:05:00Z'), 'Europe/Paris'), '2026-09-15');
  assert.equal(dayAt(Date.parse('2026-01-14T23:05:00Z'), 'Europe/Paris'), '2026-01-15');
  assert.equal(dayAt(Date.parse('2026-03-29T01:05:00Z'), 'Europe/Paris'), '2026-03-29');
  assert.equal(validDay('2026-02-30'), false);
  assert.equal(validDay('2024-02-29'), true);
});
const screenshot = { contentType: 'image/png', width: 800, height: 600 };
const msg = (id, timestamp, author = 'member', attachment = screenshot) => ({
  id, createdTimestamp: Date.parse(timestamp), author: { id: author, bot: author === 'bot' },
  attachments: new Map(attachment ? [['a', attachment]] : []), url: `https://discord.com/channels/1/2/${id}`,
});

test('latest screenshot searches earlier pages and selects the newest matching image', async () => {
  const calls = [];
  const channel = { messages: { async fetch(options) {
    calls.push(options);
    if (!options.before) return new Map(Array.from({ length: 100 }, (_, i) => {
      const id = String(300 - i);
      return [id, msg(id, '2026-09-16', 'other')];
    }));
    return new Map([
      ['100', msg('100', '2026-08-01')],
      ['101', msg('101', '2026-08-02')],
      ['102', msg('102', '2026-08-03', 'member', null)],
      ['103', { ...msg('103', '2026-08-04'), webhookId: 'webhook' }],
    ]);
  } } };
  assert.equal((await latestScreenshot(channel, 'member')).url, 'https://discord.com/channels/1/2/101');
  assert.equal(calls[1].before, '201');
  assert.deepEqual(await latestScreenshot(channel, 'member', 1), { status: 'limit' });
});

test('latest screenshot distinguishes missing proof from unreadable history', async () => {
  assert.deepEqual(await latestScreenshot({ messages: { fetch: async () => new Map() } }, 'member'), { status: 'not-found' });
  await assert.rejects(latestScreenshot({ messages: { fetch: async () => { throw new Error('Missing access'); } } }, 'member'), /Missing access/);
});
test('only image attachments with image metadata count', () => {
  assert.equal(hasImage(msg('1', '2026-09-14', 'member', { contentType: 'application/pdf' })), false);
  assert.equal(hasImage(msg('1', '2026-09-14', 'member', null)), false);
  assert.equal(hasImage(msg('1', '2026-09-14')), true);
});
test('history pagination filters local day, deduplicates users and ignores bots', async () => {
  const first = Array.from({ length: 100 }, (_, i) => [String(200 - i), msg(String(200 - i), '2026-09-14T15:00:00Z')]);
  const second = [
    ['100', msg('100', '2026-09-13T22:30:00Z', 'other')],
    ['99', msg('99', '2026-09-13T21:30:00Z', 'yesterday')],
    ['98', msg('98', '2026-09-14T12:00:00Z', 'bot')],
  ];
  let calls = 0;
  const channel = { messages: { fetch: async options => {
    if (calls === 1) assert.equal(options.before, '101');
    return new Map([first, second][calls++]);
  } } };
  const result = await collectSubmissions(channel, '2026-09-14', 'Europe/Paris');
  assert.deepEqual([...result.keys()], ['member', 'other']);
  assert.equal(calls, 2);
});
test('history errors reject the report instead of marking everyone missing', async () => {
  const channel = { messages: { fetch: async () => { throw new Error('Forbidden'); } } };
  await assert.rejects(collectSubmissions(channel, '2026-09-14', 'Europe/Paris'), /Forbidden/);
});
