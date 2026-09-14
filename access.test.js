import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { checkAccess } from './access.js';

test('admin commands, buttons and submitted modals require Administrator, not just Manage Server', () => {
  for (const action of [{ commandName: 'donation-admin' }, { customId: 'admin:grant' }, { customId: 'admin-submit:approve' }]) {
    const base = { guildId: 'server', ...action };
    assert.throws(() => checkAccess(base, 'server'), /administrators/);
    assert.throws(() => checkAccess({ ...base, memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) }, 'server'), /administrators/);
    assert.doesNotThrow(() => checkAccess({ ...base, memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator) }, 'server'));
  }
});
test('requests stay available to members; reports require Manage Server and all actions are server scoped', () => {
  assert.doesNotThrow(() => checkAccess({ guildId: 'server', commandName: 'timeoff' }, 'server'));
  assert.throws(() => checkAccess({ guildId: 'server', commandName: 'donations' }, 'server'), /Manage Server/);
  assert.throws(() => checkAccess({ guildId: 'other', commandName: 'timeoff' }, 'server'), /configured server/);
});

test('pagination buttons keep report and admin permissions', () => {
  assert.throws(() => checkAccess({ guildId: 'server', customId: 'report-page:2026-09-14:1' }, 'server'), /Manage Server/);
  assert.throws(() => checkAccess({ guildId: 'server', customId: 'admin:page:1' }, 'server'), /administrators/);
  assert.doesNotThrow(() => checkAccess({ guildId: 'server', customId: 'timeoff-page:1' }, 'server'));
});

test('time-off review buttons require Administrator permission', () => {
  const review = { guildId: 'server', customId: 'timeoff-review:approve:abc123' };
  assert.throws(() => checkAccess(review, 'server'), /administrators/);
  assert.throws(() => checkAccess({ ...review, memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) }, 'server'), /administrators/);
  assert.doesNotThrow(() => checkAccess({ ...review, memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator) }, 'server'));
});
