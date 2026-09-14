import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { ensureVacationNotice, vacationNotice, vacationModal, VACATION_BUTTON } from './vacation-panel.js';

function fixture() {
  const messages = new Collection();
  const store = { data: {}, save() {} };
  let sends = 0;
  const channel = { id: 'channel', messages: { async fetch(query) {
    if (typeof query !== 'string') return messages;
    if (!messages.has(query)) throw Object.assign(new Error('Unknown message'), { code: 10008 });
    return messages.get(query);
  } }, async send(payload) {
    sends++;
    const message = { id: String(sends), author: { id: 'bot' }, components: payload.components.map(row => ({
      components: row.components.map(button => ({ customId: button.data.custom_id })),
    })), async edit(value) { this.edited = value; } };
    messages.set(message.id, message);
    return message;
  } };
  return { channel, store, messages, sends: () => sends };
}

test('notice uses the supplied branding and timeoff form inputs', () => {
  const notice = vacationNotice();
  assert.equal(notice.embeds[0].data.color, 0xf45f77);
  assert.equal(notice.components[0].components[0].data.custom_id, VACATION_BUTTON);
  assert.equal(notice.components[0].components[0].data.style, 4);
  const inputs = vacationModal('2026-09-14').toJSON().components.map(row => row.components[0]);
  assert.deepEqual(inputs.map(input => input.custom_id), ['start', 'days', 'reason']);
  assert.equal(inputs[0].value, '2026-09-14');
  assert.equal(inputs[2].required, false);
  assert.equal(inputs[2].max_length, 500);
});

test('startup reuses the saved notice and recovers an unsaved send', async () => {
  const f = fixture();
  await ensureVacationNotice(f.channel, f.store, 'bot');
  await ensureVacationNotice(f.channel, f.store, 'bot');
  delete f.store.data.vacationPanel;
  await ensureVacationNotice(f.channel, f.store, 'bot');
  assert.equal(f.sends(), 1);
  assert.equal(f.store.data.vacationPanel.messageId, '1');
  assert.deepEqual(f.messages.get('1').edited.attachments, []);
});

test('deleted notice is replaced, but inaccessible history never triggers duplicate send', async () => {
  const f = fixture();
  await ensureVacationNotice(f.channel, f.store, 'bot');
  f.messages.clear();
  await ensureVacationNotice(f.channel, f.store, 'bot');
  assert.equal(f.sends(), 2);
  f.channel.messages.fetch = async () => { throw Object.assign(new Error('Missing access'), { code: 50001 }); };
  await assert.rejects(ensureVacationNotice(f.channel, f.store, 'bot'), /Missing access/);
  assert.equal(f.sends(), 2);
});
