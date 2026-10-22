import test from 'node:test';
import assert from 'node:assert/strict';
import { Automation } from './automation.js';
import { classify, canRequestTimeoff, TAG, VACATION_TAG } from './state.js';
import { defaultSettings, getSettings, normalizeSettings, saveSettings, validateSettings } from './configuration.js';
import { SetupSessions, setupView } from './setup.js';

const former = '88888888888888888';
const settings = () => ({ ...defaultSettings(), formerMemberRoleId: former });
function member(id, nickname, roleIds) {
  return { id, user: { bot: false }, nickname, manageable: true,
    get displayName() { return this.nickname || id; }, roles: { cache: new Map(roleIds.map(role => [role, {}])) },
    async setNickname(value) { this.nickname = value; } };
}

test('former-member role overrides tracked membership and vacation eligibility', () => {
  const config = settings();
  const old = member('former', 'Name', [former, config.memberRoleId, ...config.leaderRoleIds]);
  const current = member('current', 'Current', [config.memberRoleId]);
  const report = classify(new Map([[old.id, old], [current.id, current]]), new Map(), { settings: config, grants: {} }, '2026-10-21');
  assert.deepEqual(report.roster.map(m => m.id), ['current']);
  assert.deepEqual(report.missing.map(m => m.id), ['current']);
  assert.equal(canRequestTimeoff(old, config), false);
  old.roles.cache.delete(former);
  assert.equal(canRequestTimeoff(old, config), true);
});

test('former members lose saved and orphan bot tags while unrelated nickname brackets are preserved', async () => {
  const config = settings();
  const saved = member('saved', `Original ${TAG}`, [former, config.memberRoleId]);
  const orphan = member('orphan', `[VIP] Player ${VACATION_TAG}`, [former]);
  const other = member('other', '[VIP] Other', [former]);
  const members = new Map([saved, orphan, other].map(m => [m.id, m]));
  const store = { data: { settings: config, grants: { v: { userId: saved.id, start: '2026-10-21', end: '2026-10-25' } },
    nicknames: { saved: { original: 'Original', applied: saved.nickname } } }, save() {} };
  const automation = new Automation({ guild: { members: { list: async () => members } }, channel: { messages: { fetch: async () => new Map() } },
    store, timezone: 'Europe/Paris', now: () => Date.parse('2026-10-21T12:00:00Z') });
  await automation.syncToday();
  assert.equal(saved.nickname, 'Original'); assert.equal(orphan.nickname, '[VIP] Player'); assert.equal(other.nickname, '[VIP] Other');
  assert.deepEqual(store.data.nicknames, {});
  saved.roles.cache.delete(former);
  await automation.syncToday();
  assert.equal(saved.nickname, `Original ${VACATION_TAG}`);
});

test('former-member selection is optional, persists when saved, and can be cleared', () => {
  assert.equal(getSettings({}).formerMemberRoleId, null);
  const sessions = new SetupSessions(); const session = sessions.open('admin', 'guild', {});
  sessions.selectField(session, 'formerMemberRoleId');
  const menu = setupView(session).components[1].toJSON().components[0];
  assert.equal(menu.type, 6); assert.equal(menu.min_values, 0); assert.equal(menu.max_values, 1);
  assert.equal(setupView(session).embeds[0].toJSON().fields.find(f => f.name === 'No longer a member role').value, 'None');
  sessions.selectValues(session, [former]);
  const store = { data: { requests: {} }, save() { this.saved = JSON.parse(JSON.stringify(this.data)); } };
  saveSettings(store, session.draft, 0);
  assert.equal(getSettings(store.saved).formerMemberRoleId, former);
  sessions.selectValues(session, []);
  assert.equal(normalizeSettings(session.draft).formerMemberRoleId, null);
  assert.throws(() => normalizeSettings({ ...settings(), formerMemberRoleId: settings().memberRoleId }), /different/);
});

test('selected former-member role is checked against the configured server', async () => {
  const { PermissionFlagsBits, PermissionsBitField, ChannelType } = await import('discord.js');
  const permissions = new PermissionsBitField(PermissionFlagsBits.Administrator);
  const seen = [];
  const guild = { id: 'guild', members: { fetchMe: async () => ({ permissions }) },
    channels: { fetch: async id => ({ id, guildId: 'guild', type: ChannelType.GuildText, permissionsFor: () => permissions }) },
    roles: { fetch: async id => { seen.push(id); return id === former ? null : { id, guild: { id: 'guild' } }; } } };
  await assert.rejects(validateSettings(guild, settings()), /roles from this server/);
  assert.ok(seen.includes(former));
});


test('configured leaders and Asylum Staff never receive bot tags and existing tags are cleaned up', async () => {
  const config = settings();
  const saved = member('leader', 'Original ' + TAG, [config.memberRoleId, config.leaderRoleIds[0]]);
  const orphan = member('coleader', '[VIP] Player ' + VACATION_TAG, [config.memberRoleId, config.leaderRoleIds[1]]);
  const staff = member('staff', 'Staff ' + TAG, [config.memberRoleId, 'staff-role']);
  staff.roles.cache.set('staff-role', { name: 'Asylum Staff' });
  const regular = member('regular', 'Regular', [config.memberRoleId]);
  const members = new Map([saved, orphan, staff, regular].map(m => [m.id, m]));
  const store = { data: { settings: config, grants: { v: { userId: saved.id, start: '2026-10-21', end: '2026-10-25' } },
    nicknames: { leader: { original: 'Original', applied: saved.nickname } } }, save() {} };
  const automation = new Automation({ guild: { members: { list: async () => members } }, channel: { messages: { fetch: async () => new Map() } },
    store, timezone: 'Europe/Paris', now: () => Date.parse('2026-10-21T12:00:00Z') });
  for (let check = 0; check < 2; check++) {
    const report = await automation.syncToday();
    assert.deepEqual(report.roster.map(m => m.id), ['regular']);
    assert.equal(saved.nickname, 'Original');
    assert.equal(orphan.nickname, '[VIP] Player');
    assert.equal(staff.nickname, 'Staff');
    assert.equal(regular.nickname, 'Regular ' + TAG);
  }
  assert.deepEqual(Object.keys(store.data.nicknames), ['regular']);
  saved.roles.cache.delete(config.leaderRoleIds[0]);
  await automation.syncToday();
  assert.equal(saved.nickname, 'Original ' + VACATION_TAG);
});
