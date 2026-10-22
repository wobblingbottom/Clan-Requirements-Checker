import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits as P, PermissionsBitField, ChannelType } from 'discord.js';
import { DonationBreakManager, POSTING_BITS } from './donation-breaks.js';
import { breakForDay, activeBreak } from './break-state.js';
import { defaultSettings, saveSettings } from './configuration.js';
import { checkAccess } from './access.js';
import { Automation } from './automation.js';
import { classify, PATIENT_ROLE_ID, TAG } from './state.js';
import { breaksView, breakModal } from './break-panel.js';

const guildId = '11111111111111111', botId = '22222222222222222', roleId = '33333333333333333';
const raw = (id, allow = 0n, deny = 0n, type = 0) => ({ id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) });
const snapshot = channel => [...channel.permissionOverwrites.cache.values()].map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })).sort((a,b) => a.id.localeCompare(b.id));
function fixture() {
  let now = Date.parse('2026-10-21T12:00:00Z'), persisted;
  const history = new Collection(), sent = [], edits = [];
  const store = { data: { settings: defaultSettings(), requests: {}, grants: {}, jobs: {}, missingStreaks: {}, nicknames: {}, lastClosedDay: '2026-10-20' },
    save() { persisted = JSON.stringify(this.data); } };
  const channel = { id: defaultSettings().donationChannelId, guildId, type: ChannelType.GuildText,
    permissionOverwrites: { cache: new Collection([[guildId, raw(guildId, P.ViewChannel | P.ReadMessageHistory | P.SendMessages)], [roleId, raw(roleId, P.SendMessages | P.AttachFiles)]]) },
    permissionsFor: () => new PermissionsBitField(P.Administrator),
    async edit(payload) {
      assert.ok(Object.values(store.data.donationBreaks).some(r => r.lock?.entries), 'restore data must exist before Discord mutation');
      edits.push(payload);
      this.permissionOverwrites.cache = new Collection(payload.permissionOverwrites.map(o => [o.id, raw(o.id, BigInt(o.allow), BigInt(o.deny), o.type)]));
      return this;
    },
    messages: { async fetch(query) { if(typeof query !== 'string') return history; if(!history.has(query)) throw Object.assign(Error('Unknown message'), { code:10008 }); return history.get(query); } },
    async send(payload) {
      sent.push(payload);
      const message = { id: String(sent.length), author: { id: botId }, createdTimestamp: now,
        embeds: payload.embeds.map(e=>e.toJSON()), async edit(next) { this.embeds = next.embeds.map(e=>e.toJSON()); } };
      history.set(message.id, message); return message;
    },
  };
  const guild = { id: guildId, channels: { fetch: async () => channel }, members: { fetchMe: async () => ({ permissions: new PermissionsBitField(P.Administrator) }) } };
  const manager = new DonationBreakManager({ guild, store, botId, timezone: 'Europe/Paris', now:()=>now });
  store.save();
  return { manager, store, channel, guild, sent, edits, history,
    day(value) { now=Date.parse(`${value}T12:00:00Z`); },
    restart() { store.data=JSON.parse(persisted); return new DonationBreakManager({ guild, store, botId, timezone:'Europe/Paris', now:()=>now }); } };
}
const create = (f, overrides = {}) => f.manager.create({ name:'Halloween break', start:'2026-10-21', end:'2026-11-01', reason:'Use gems for the event!', adminId:'admin', ...overrides });

test('breaks require Administrator for opening, creating and ending', () => {
  const entries=[{commandName:'clan',options:{getString:()=> 'breaks'}}, {customId:'breaks:create'}, {customId:'breaks:create-submit'}, {customId:'breaks:end:id'}];
  for(const entry of entries) {
    const i={guildId, ...entry};
    assert.throws(()=>checkAccess(i,guildId),/administrators/);
    assert.doesNotThrow(()=>checkAccess({...i,memberPermissions:new PermissionsBitField(P.Administrator)},guildId));
  }
});

test('active break announces once and denies posting for everyone, role and member overrides while preserving read access', async () => {
  const f=fixture(); f.channel.permissionOverwrites.cache.set('44444444444444444',raw('44444444444444444',P.SendMessages,0n,1));
  const original=snapshot(f.channel); const record=await create(f); await f.manager.sync(); await f.manager.sync();
  assert.equal(f.sent.length,1); assert.match(f.sent[0].embeds[0].data.description,/Halloween break/);
  assert.deepEqual(f.sent[0].allowedMentions,{parse:[]});
  for(const overwrite of f.channel.permissionOverwrites.cache.values()) {
    if(overwrite.id===botId) { assert.ok(overwrite.allow.has(P.SendMessages)); continue; }
    assert.equal(overwrite.allow.bitfield & POSTING_BITS,0n); assert.equal(overwrite.deny.bitfield & POSTING_BITS,POSTING_BITS);
  }
  assert.ok(f.channel.permissionOverwrites.cache.get(guildId).allow.has(P.ViewChannel | P.ReadMessageHistory));
  f.day('2026-11-02'); await f.manager.sync();
  assert.deepEqual(snapshot(f.channel),original); assert.equal(record.finished,true); assert.equal(f.sent.length,1);
  assert.equal(breakForDay(f.store.data,'2026-10-31').id,record.id);
});

test('scheduled breaks announce now, lock at the start date and unlock after the inclusive final day',async()=>{
  const f=fixture(),original=snapshot(f.channel);const record=await create(f,{start:'2026-10-30'});
  await f.manager.sync(); assert.equal(f.edits.length,0); assert.equal(record.announcementPhase,'scheduled');
  f.day('2026-10-30'); await f.manager.sync();assert.equal(record.lock.applied,true);
  f.day('2026-11-01');await f.manager.sync();assert.ok(!record.finished);
  f.day('2026-11-02');await f.manager.sync();assert.deepEqual(snapshot(f.channel),original);
});

test('early ending restores the channel and leaves today excused; future cancellation does not excuse dates',async()=>{
  const f=fixture(),original=snapshot(f.channel);const record=await create(f);await f.manager.sync();
  f.manager.end(record.id,'admin');await f.manager.sync();assert.deepEqual(snapshot(f.channel),original);
  assert.ok(breakForDay(f.store.data,'2026-10-21'));assert.equal(activeBreak(f.store.data,'2026-10-21'),undefined);assert.equal(breakForDay(f.store.data,'2026-10-22'),undefined);
  const future=await create(f,{start:'2026-10-30',end:'2026-10-31'});await f.manager.sync();f.manager.end(future.id,'admin');await f.manager.sync();
  assert.equal(breakForDay(f.store.data,'2026-10-30'),undefined);assert.equal(future.finished,true);
});

test('restoration survives restart and preserves unrelated permission changes made during the break',async()=>{
  const f=fixture();const record=await create(f);await f.manager.sync();
  const overwrite=f.channel.permissionOverwrites.cache.get(roleId);overwrite.deny.add(P.EmbedLinks);overwrite.allow.remove(P.AttachFiles);
  const restart=f.restart(); f.day('2026-11-02');await restart.sync();
  const restored=f.channel.permissionOverwrites.cache.get(roleId);
  assert.ok(restored.allow.has(P.SendMessages));assert.ok(restored.deny.has(P.EmbedLinks));assert.equal(restored.allow.has(P.AttachFiles),false);
  assert.equal(f.store.data.donationBreaks[record.id].finished,true);
});

test('failed channel mutation retries using the persisted original snapshot and does not strand the lock',async()=>{
  const f=fixture(),original=snapshot(f.channel);await create(f);
  const edit=f.channel.edit;let interrupted=true;f.channel.edit=async function(payload){await edit.call(this,payload);if(interrupted){interrupted=false;throw Error('Connection lost after edit');}return this;};
  await assert.rejects(f.manager.sync(),/Connection lost/);
  const restart=f.restart();await restart.sync();f.day('2026-11-02');await restart.sync();assert.deepEqual(snapshot(f.channel),original);
});

test('interrupted announcement send is recovered from history without duplicating it',async()=>{
  const f=fixture();await create(f);const send=f.channel.send;f.channel.send=async function(payload){await send.call(this,payload);throw Error('Connection lost after send');};
  await assert.rejects(f.manager.sync(),/Connection lost/);assert.equal(f.sent.length,1);
  f.channel.send=send;await f.restart().sync();assert.equal(f.sent.length,1);
});

test('new posting overrides added during a break are locked and restored to their previous values',async()=>{
  const f=fixture();await create(f);await f.manager.sync();const id='99999999999999999';
  f.channel.permissionOverwrites.cache.set(id,raw(id,P.SendMessages | P.AttachFiles));await f.manager.sync();assert.ok(f.channel.permissionOverwrites.cache.get(id).deny.has(P.SendMessages));
  f.day('2026-11-02');await f.manager.sync();assert.ok(f.channel.permissionOverwrites.cache.get(id).allow.has(P.SendMessages | P.AttachFiles));
});

test('invalid dates, overlapping dates and missing lock permissions do not create a break',async()=>{
  const f=fixture();await assert.rejects(create(f,{start:'2026-10-20'}),/today or a future/);
  await assert.rejects(create(f,{end:'2026-02-30'}),/today or a future/);await create(f);
  await assert.rejects(create(f,{start:'2026-10-31'}),/overlap/);
  const denied=fixture();denied.channel.permissionsFor=()=>new PermissionsBitField(P.ViewChannel|P.ReadMessageHistory|P.SendMessages|P.AttachFiles|P.EmbedLinks);
  await assert.rejects(create(denied),/ManageRoles/);assert.equal(denied.store.data.donationBreaks,undefined);
});

test('break dates skip reminders and streak increments, then normal checks resume without penalizing break dates',async()=>{
  const f=fixture();await create(f);f.store.data.missingStreaks.member=4;
  const automation=new Automation({store:f.store,timezone:'Europe/Paris',now:()=>Date.parse('2026-10-31T12:00:00Z')});
  automation.report=async()=>{throw Error('Break days must not scan proof');};automation.syncToday=async()=>{};
  await automation.tick();assert.equal(f.store.data.lastClosedDay,'2026-10-20');
  await automation.closeDay('2026-10-30');assert.equal(f.store.data.lastClosedDay,'2026-10-30');assert.equal(f.store.data.missingStreaks.member,4);
  const member={id:'member',user:{bot:false},roles:{cache:new Map([[PATIENT_ROLE_ID,{}]])}};
  const members=new Map([[member.id,member]]);
  assert.equal(classify(members,new Map(),f.store.data,'2026-10-31').missing.length,0);
  assert.equal(classify(members,new Map(),f.store.data,'2026-11-02').missing.length,1);
});

test('global break removes missing-proof labels without labelling everyone as on vacation',async()=>{
  const f=fixture();await create(f);const m={id:'member',user:{bot:false},manageable:true,nickname:`Name ${TAG}`,displayName:'Name',roles:{cache:new Map([[PATIENT_ROLE_ID,{}]])},async setNickname(value){this.nickname=value;}};
  const orphan={id:'orphan',user:{bot:false},manageable:true,nickname:`Orphan ${TAG}`,displayName:'Orphan',roles:{cache:new Map([[PATIENT_ROLE_ID,{}]])},async setNickname(value){this.nickname=value;}};
  f.store.data.nicknames.member={original:'Name',applied:m.nickname};
  const automation=new Automation({store:f.store,timezone:'Europe/Paris',now:()=>Date.parse('2026-10-21T12:00:00Z')});
  const members=new Map([[m.id,m],[orphan.id,orphan]]);
  automation.report=async day=>({...classify(members,new Map(),f.store.data,day),members});
  await automation.syncToday();assert.equal(m.nickname,'Name');assert.equal(orphan.nickname,'Orphan');
});

test('break controls serialize and setup cannot change the donation channel before lock restoration',async()=>{
  const f=fixture();await create(f);assert.equal(breakModal('2026-10-21').toJSON().components.length,4);
  const view=breaksView(f.store.data,'2026-10-21','Europe/Paris');assert.ok(view.components[0].toJSON().components.some(b=>b.custom_id.startsWith('breaks:end:')));
  assert.throws(()=>saveSettings(f.store,{...defaultSettings(),donationChannelId:'88888888888888888'},0),/End or cancel/);
});

test('adjacent scheduled breaks restore the first lock before taking the second snapshot',async()=>{
  const f=fixture(),original=snapshot(f.channel);
  const next=await create(f,{name:'Next break',start:'2026-11-02',end:'2026-11-03'});
  const first=await create(f);await f.manager.sync();
  f.day('2026-11-02');await f.manager.sync();assert.equal(first.finished,true);assert.equal(next.lock.applied,true);
  assert.ok(f.channel.permissionOverwrites.cache.get(guildId).deny.has(P.SendMessages));
  f.day('2026-11-04');await f.manager.sync();assert.deepEqual(snapshot(f.channel),original);
});

test('historical streak backfill skips break dates rather than counting or resetting them',async()=>{
  const f=fixture();await create(f);f.store.data.lastClosedDay='2026-11-01';
  const sent=[],days=[];
  const automation=new Automation({guild:{id:guildId},store:f.store,timezone:'Europe/Paris',botId,
    now:()=>Date.parse('2026-11-03T12:00:00Z'),reminder:{messages:{fetch:async()=>new Collection()},send:async payload=>{sent.push(payload);return{id:'reminder'};}}});
  automation.report=async day=>{days.push(day);return{missing:[{id:'member'}]};};automation.syncToday=async()=>{};
  await automation.tick();assert.equal(sent.length,1);assert.equal(f.store.data.missingStreaks.member,10);
  assert.equal(days.length,10);assert.equal(days[0],'2026-11-02');assert.equal(days[1],'2026-10-20');
  assert.equal(f.store.data.lastClosedDay,'2026-11-02');
});

test('failed permission restoration remains pending and is retried on the next check',async()=>{
  const f=fixture(),original=snapshot(f.channel);const record=await create(f);await f.manager.sync();f.day('2026-11-02');
  const edit=f.channel.edit;f.channel.edit=async()=>{throw Error('Temporary permissions failure');};
  await assert.rejects(f.manager.sync(),/Temporary permissions failure/);assert.ok(!record.finished);assert.ok(!record.lock.restored);
  f.channel.edit=edit;await f.manager.sync();assert.equal(record.finished,true);assert.deepEqual(snapshot(f.channel),original);
});


test('announcement keeps only member-facing text and references the logo inside its footer', async () => {
  const f = fixture(); const record = await create(f);
  const payload = f.manager.announcement(record, 'active');
  const embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /21 Oct through 1 Nov/);
  assert.doesNotMatch(embed.description, /Administrators|read-only|missing-proof|Europe|inclusive/);
  assert.equal(embed.footer.text, 'Crazyland Asylum');
  assert.equal(embed.footer.icon_url, 'attachment://crazyland-footer-' + record.id + '.png');
  for (const file of payload.files) {
    assert.ok([embed.author.icon_url, embed.footer.icon_url, embed.thumbnail?.url].includes('attachment://' + file.name));
  }
});

test('existing announcements refresh to the new layout without posting a second message', async () => {
  const f = fixture(); const record = await create(f); await f.manager.sync();
  const message = f.history.get(record.announcementMessageId);
  message.embeds[0].footer = { text: 'Crazyland Asylum • Donation break ' + record.id };
  delete record.announcementVersion;
  await f.manager.sync();
  assert.equal(f.sent.length, 1);
  assert.equal(message.embeds[0].footer.text, 'Crazyland Asylum');
  assert.ok(message.embeds[0].footer.icon_url);
});


test('active break silences pending reminders from before the break without consuming the job', async () => {
  const f = fixture(); await create(f);
  const job = { createdAt: 1, batches: [{ ids: ['member'], sent: false }] };
  f.store.data.jobs['2026-10-20'] = job;
  const automation = new Automation({ store: f.store, timezone: 'Europe/Paris', now: () => Date.parse('2026-10-22T12:00:00Z') });
  automation.report = async () => { throw Error('Must not scan or ping during an active break'); };
  await automation.closeDay('2026-10-20');
  assert.equal(f.store.data.jobs['2026-10-20'], job);
  assert.equal(job.batches[0].sent, false);
});

test('break starting during reminder history lookup prevents the pending ping', async () => {
  const f = fixture();
  let now = Date.parse('2026-10-20T21:59:00Z');
  f.store.data.donationBreaks = { halloween: { start: '2026-10-21', end: '2026-11-01' } };
  const job = { createdAt: now, batches: [{ ids: ['member'], sent: false }] };
  f.store.data.jobs['2026-10-19'] = job;
  const automation = new Automation({ store: f.store, timezone: 'Europe/Paris', now: () => now,
    reminder: { messages: { fetch: async () => { now = Date.parse('2026-10-20T22:00:00Z'); return new Map(); } },
      send: async () => { assert.fail('No daily ping during the break'); } } });
  automation.report = async () => ({ missing: [{ id: 'member' }] });
  await automation.closeDay('2026-10-19');
  assert.equal(job.batches[0].sent, false);
  assert.equal(f.store.data.jobs['2026-10-19'], job);
});
