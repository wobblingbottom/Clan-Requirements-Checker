import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { checkAccess } from './access.js';

test('admin commands, buttons and submitted modals require Administrator, not just Manage Server', () => {
  for (const action of [{ commandName: 'donation-admin' }, { customId: 'admin:grant' }, { customId: 'admin-submit:reject' }]) {
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

test('time-off rejection still requires Administrator permission', () => {
  const review = { guildId: 'server', customId: 'timeoff-review:reject:abc123' };
  assert.throws(() => checkAccess(review, 'server'), /administrators/);
  assert.throws(() => checkAccess({ ...review, memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) }, 'server'), /administrators/);
  assert.doesNotThrow(() => checkAccess({ ...review, memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator) }, 'server'));
});

test('only Leader and Co-leader roles can approve through buttons or submitted admin forms', () => {
  for (const customId of ['timeoff-review:approve:abc123', 'admin:approve', 'admin-submit:approve']) {
    const base = { guildId: 'server', customId };
    assert.throws(() => checkAccess(base, 'server'), /Only Leaders and Co-leaders/);
    assert.throws(() => checkAccess({ ...base, memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator) }, 'server'), /Only Leaders and Co-leaders/);
    assert.throws(() => checkAccess({ ...base, member: { roles: ['1532826889499185302'] } }, 'server'), /Only Leaders and Co-leaders/);
    for (const role of ['1532826140086112256', '1532826772624769316']) {
      for (const roles of [[role], { cache: new Map([[role, {}]]) }]) {
        assert.doesNotThrow(() => checkAccess({ ...base, member: { roles } }, 'server'));
        assert.throws(() => checkAccess({ ...base, guildId: 'other', member: { roles } }, 'server'), /configured server/);
      }
    }
  }
});
