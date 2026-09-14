import test from 'node:test';
import assert from 'node:assert/strict';
import { brandedMessage, reminderMessage, matchesReminder } from './messages.js';

test('branded replies serialize with the shared layout and do not allow accidental pings', () => {
  const message = brandedMessage('Crazyland clan vacation updated.', 'Approved for <@123> @everyone');
  const embed = message.embeds[0].toJSON();
  assert.equal(embed.color, 0xf45f77);
  assert.equal(embed.author.name, 'Crazyland clan vacation updated.');
  assert.equal(embed.title, undefined);
  assert.equal(embed.footer.text, 'Crazyland Asylum');
  assert.equal(message.content, '');
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('bundled hand and footer images take priority over URLs, with an optional separate thumbnail', () => {
  process.env.EMBED_AUTHOR_ICON_URL = 'https://example.com/hand.png';
  process.env.EMBED_FOOTER_ICON_URL = 'https://example.com/footer.png';
  process.env.EMBED_THUMBNAIL_ICON_URL = 'https://example.com/wide-logo.png';
  try {
    const message = brandedMessage('Crazyland clan donation info.', 'Donation information.');
    const embed = message.embeds[0].toJSON();
    assert.equal(embed.author.icon_url, 'attachment://crazyland-author.png');
    assert.equal(embed.thumbnail.url, 'https://example.com/wide-logo.png');
    assert.equal(embed.footer.icon_url, 'attachment://crazyland-footer.png');
    assert.deepEqual(message.files.map(file => file.name), ['crazyland-author.png', 'crazyland-footer.png']);
  } finally {
    delete process.env.EMBED_AUTHOR_ICON_URL;
    delete process.env.EMBED_FOOTER_ICON_URL;
    delete process.env.EMBED_THUMBNAIL_ICON_URL;
  }
});

test('reminder content contains actual mentions and the embed stays within Discord limits', () => {
  const ids = Array.from({ length: 40 }, (_, i) => String(1532826238572298451n + BigInt(i)));
  const message = reminderMessage('2026-09-14', 'Europe/Paris', ids);
  const embed = message.embeds[0].toJSON();
  for (const id of ids) assert.ok(message.content.includes(`<@${id}>`));
  assert.deepEqual(message.allowedMentions.users, ids);
  assert.ok(message.content.length <= 2000);
  assert.ok(embed.description.length <= 4096);
  assert.equal(embed.fields, undefined);
  assert.equal(embed.author.name, 'Crazyland clan donation reminder.');
  assert.equal(embed.description, "Don't forget to donate your daily!");
  assert.equal(embed.footer.text, 'Crazyland Asylum');
  assert.equal(embed.thumbnail, undefined);
});

test('simple reminders are recovered only for the matching date and member batch', () => {
  const payload = reminderMessage('2026-09-14', 'Europe/Paris', ['123', '456']);
  const message = { content: payload.content, embeds: payload.embeds.map(embed => embed.toJSON()) };
  assert.equal(matchesReminder(message, '2026-09-14', 0, ['123', '456', '789']), true);
  assert.equal(matchesReminder(message, '2026-09-15', 0, ['123']), false);
  assert.equal(matchesReminder(message, '2026-09-14', 1, ['789']), false);
});
