import test from 'node:test';
import assert from 'node:assert/strict';
import { brandedMessage, reminderMessage } from './messages.js';

test('branded replies serialize as pink embeds and do not allow accidental pings', () => {
  const message = brandedMessage('Time off updated', 'Approved for <@123> @everyone');
  const embed = message.embeds[0].toJSON();
  assert.equal(embed.color, 0xf45f77);
  assert.equal(embed.author.name, 'Crazyland');
  assert.equal(message.content, '');
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('reminder content contains actual mentions and the embed stays within Discord limits', () => {
  const ids = Array.from({ length: 40 }, (_, i) => String(1532826238572298451n + BigInt(i)));
  const message = reminderMessage('2026-09-14', 'Europe/Paris', '1535655837828382740', ids, 0);
  const embed = message.embeds[0].toJSON();
  for (const id of ids) assert.ok(message.content.includes(`<@${id}>`));
  assert.deepEqual(message.allowedMentions.users, ids);
  assert.ok(message.content.length <= 2000);
  assert.ok(embed.description.length <= 4096);
  assert.ok(embed.fields.every(field => field.value.length <= 1024));
});
