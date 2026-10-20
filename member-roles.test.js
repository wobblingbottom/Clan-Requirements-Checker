import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { assignMemberRoles } from './member-roles.js';
import { defaultSettings } from './configuration.js';
import { Automation } from './automation.js';

function fixture() {
  const config = { ...defaultSettings(), formerMemberRoleId: '88888888888888888' };
  const members = new Map(), assigned = [];
  const role = { id: config.memberRoleId, editable: true, managed: false, permissions: new PermissionsBitField(0n) };
  const make = (id, roles = [], bot = false) => {
    const m = { id, user: { bot }, nickname: null, manageable: true, displayName: id, async setNickname(value) { this.nickname = value; } };
    m.roles = { cache: new Map(roles.map(id => [id, {}])), async add(roleId) {
      assigned.push([id, roleId]);
      const clone = make(id, [...this.cache.keys(), roleId], bot);
      members.set(id, clone);
      return clone;
    } };
    return m;
  };
  const guild = { id: 'guild', members: { list: async () => new Map(members), fetchMe: async () => ({ permissions: new PermissionsBitField(P.ManageRoles) }) },
    roles: { fetch: async () => role } };
  return { config, members, assigned, role, guild, make };
}

test('auto assignment adds only the member role and skips bots, former members and existing members', async () => {
  const f = fixture();
  const outsider = f.make('new', ['77777777777777777']);
  for (const m of [outsider, f.make('existing', [f.config.memberRoleId]), f.make('former', [f.config.formerMemberRoleId]), f.make('bot', [], true)]) f.members.set(m.id, m);
  const result = await assignMemberRoles(f.guild, f.config);
  assert.deepEqual(f.assigned, [['new', f.config.memberRoleId]]);
  assert.deepEqual(result.errors, []);
  assert.ok(result.members.get('new').roles.cache.has(f.config.memberRoleId));
  assert.ok(result.members.get('new').roles.cache.has('77777777777777777'));
  assert.equal(outsider.roles.cache.has(f.config.memberRoleId), false, 'SDK returns a clone; original object remains stale');
  await assignMemberRoles(f.guild, f.config);
  assert.equal(f.assigned.length, 1);
});

test('failed assignments do not stop other users and are returned for the admin panel', async () => {
  const f = fixture(); const denied = f.make('denied'); denied.roles.add = async () => { throw Error('Missing Permissions'); };
  f.members.set('denied', denied); f.members.set('ok', f.make('ok'));
  const result = await assignMemberRoles(f.guild, f.config);
  assert.deepEqual(f.assigned, [['ok', f.config.memberRoleId]]);
  assert.match(result.errors[0], /denied: Missing Permissions/);
});

test('missing Manage Roles, role hierarchy and privileged role choices prevent automatic grants', async () => {
  for (const issue of ['permission', 'hierarchy', 'administrator', 'manage-roles']) {
    const f = fixture(); f.members.set('new', f.make('new'));
    if (issue === 'permission') f.guild.members.fetchMe = async () => ({ permissions: new PermissionsBitField(0n) });
    if (issue === 'hierarchy') f.role.editable = false;
    if (issue === 'administrator') f.role.permissions = new PermissionsBitField(P.Administrator);
    if (issue === 'manage-roles') f.role.permissions = new PermissionsBitField(P.ManageRoles);
    const result = await assignMemberRoles(f.guild, f.config);
    assert.equal(result.errors.length, 1); assert.deepEqual(f.assigned, []);
  }
});

test('today tracking immediately uses the SDK member clone after successful assignment', async () => {
  const f = fixture(); f.members.set('new', f.make('new'));
  const store = { data: { settings: f.config, grants: {}, nicknames: {} }, save() {} };
  const automation = new Automation({ guild: f.guild, channel: { messages: { fetch: async () => new Map() } }, store,
    timezone: 'Europe/Paris', now: () => Date.parse('2026-10-21T12:00:00Z'), syncMemberRoles: () => assignMemberRoles(f.guild, f.config) });
  const report = await automation.syncToday();
  assert.deepEqual(report.missing.map(m => m.id), ['new']);
  assert.match(report.members.get('new').nickname, /\[No Donation Proof\]/);
});


test('former role removes conflicting member role, preserves other roles and retries failures', async () => {
  const f = fixture();
  const former = f.make('former', [f.config.memberRoleId, f.config.formerMemberRoleId, 'other']);
  let attempts = 0;
  former.roles.remove = async roleId => {
    attempts++;
    if (attempts === 1) throw Error('Missing Permissions');
    assert.equal(roleId, f.config.memberRoleId);
    return f.make('former', [f.config.formerMemberRoleId, 'other']);
  };
  f.members.set('former', former);
  f.members.set('new', f.make('new'));
  let result = await assignMemberRoles(f.guild, f.config);
  assert.match(result.errors[0], /remove member role from former: Missing Permissions/);
  assert.deepEqual(f.assigned, [['new', f.config.memberRoleId]]);
  result = await assignMemberRoles(f.guild, f.config);
  assert.deepEqual(result.errors, []);
  assert.deepEqual([...result.members.get('former').roles.cache.keys()], [f.config.formerMemberRoleId, 'other']);
  assert.equal(attempts, 2);
});

test('privileged member role can be removed but never automatically granted', async () => {
  const f = fixture(); f.role.permissions = new PermissionsBitField(P.Administrator);
  const former = f.make('former', [f.config.memberRoleId, f.config.formerMemberRoleId]);
  let removed = false;
  former.roles.remove = async () => { removed = true; return f.make('former', [f.config.formerMemberRoleId]); };
  f.members.set('former', former); f.members.set('new', f.make('new'));
  const result = await assignMemberRoles(f.guild, f.config);
  assert.equal(removed, true);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(f.assigned, []);
});
