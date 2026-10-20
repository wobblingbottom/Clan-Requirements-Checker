import { randomUUID, createHash } from 'node:crypto';
import { PermissionFlagsBits, ChannelType, escapeMarkdown } from 'discord.js';
import { validDay, dayAt } from './tracking.js';
import { donationBreaks } from './break-state.js';
import { getSettings } from './configuration.js';
import { brandedMessage, BRAND_FOOTER } from './messages.js';

export const POSTING_BITS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads']
  .reduce((bits, name) => bits | PermissionFlagsBits[name], 0n);
const sendBit = PermissionFlagsBits.SendMessages;
const values = overwrite => ({ id: overwrite.id, type: overwrite.type,
  allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() });
const same = (a, b) => a.length === b.length && a.every(x => b.some(y => x.id === y.id && x.type === y.type
  && BigInt(x.allow) === BigInt(y.allow) && BigInt(x.deny) === BigInt(y.deny)));

export class DonationBreakManager {
  constructor({ guild, store, botId, timezone, now = () => Date.now() }) {
    Object.assign(this, { guild, store, botId, timezone, now });
  }
  async channel(id) {
    const channel = await this.guild.channels.fetch(id, { force: true });
    if (!channel || channel.guildId !== this.guild.id || channel.type !== ChannelType.GuildText) throw new Error('Donation break channel must be a text channel in this server.');
    return channel;
  }
  async checkPermissions(channel) {
    const me = await this.guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    for (const name of ['ViewChannel', 'ReadMessageHistory', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ManageRoles']) {
      if (!permissions?.has(PermissionFlagsBits[name])) throw new Error(`Donation breaks need ${name} permission in the donation channel.`);
    }
  }
  async create({ name, start, end, reason = '', adminId }) {
    const today = dayAt(this.now(), this.timezone);
    name = name.trim(); reason = reason.trim();
    if (!name || name.length > 80 || reason.length > 1000) throw new Error('Use a break name of 1–80 characters and an announcement of up to 1,000 characters.');
    if (!validDay(start) || !validDay(end) || start < today || end < start
      || Date.parse(end) - Date.parse(start) > 364 * 86400000) throw new Error('Choose today or a future start and an end on or after it, up to 365 days total.');
    if (donationBreaks(this.store.data).some(item => !item.cancelledAt && start <= item.end && item.start <= end)) {
      throw new Error('Those dates overlap another donation break.');
    }
    if (donationBreaks(this.store.data).filter(item => !item.finished).length >= 20) throw new Error('Finish or cancel an existing break before adding more.');
    const channelId = getSettings(this.store.data).donationChannelId;
    await this.checkPermissions(await this.channel(channelId));
    const record = { id: randomUUID().slice(0, 8), name, start, end, reason, adminId, channelId, createdAt: this.now() };
    this.store.data.donationBreaks ??= {};
    this.store.data.donationBreaks[record.id] = record;
    try { this.store.save(); } catch (error) { delete this.store.data.donationBreaks[record.id]; throw error; }
    return record;
  }
  end(id, adminId) {
    const record = this.store.data.donationBreaks?.[id];
    if (!record || record.finished || record.endedAt || record.cancelledAt) throw new Error('That break has already finished or was cancelled.');
    const today = dayAt(this.now(), this.timezone);
    const previous = structuredClone(record);
    if (record.start > today) record.cancelledAt = this.now();
    else {
      record.plannedEnd = record.end;
      record.end = today < record.end ? today : record.end;
      record.endedAt = this.now();
    }
    record.endedBy = adminId;
    try { this.store.save(); } catch (error) { this.store.data.donationBreaks[id] = previous; throw error; }
    return record;
  }
  async lock(record, channel) {
    await this.checkPermissions(channel);
    const current = [...channel.permissionOverwrites.cache.values()].map(values);
    record.lock ??= { entries: {} };
    const original = record.lock.entries;
    const desired = current.map(item => ({ ...item }));
    for (const id of [this.guild.id, this.botId]) {
      if (!desired.some(item => item.id === id)) desired.push({ id, type: id === this.botId ? 1 : 0, allow: '0', deny: '0' });
    }
    if (desired.length > 100) throw new Error('The donation channel has too many permission overwrites to lock safely.');
    for (const item of desired) {
      if (!original[item.id]) original[item.id] = { ...item, existed: current.some(x => x.id === item.id) };
      const mask = item.id === this.botId ? sendBit : POSTING_BITS;
      item.allow = ((BigInt(item.allow) & ~mask) | (item.id === this.botId ? sendBit : 0n)).toString();
      item.deny = ((BigInt(item.deny) & ~mask) | (item.id === this.botId ? 0n : mask)).toString();
    }
    // Save the restoration data before the Discord mutation, including retries.
    this.store.save();
    if (!same(current, desired)) await channel.edit({ permissionOverwrites: desired, reason: `Donation break: ${record.name}` });
    record.lock.applied = true;
    this.store.save();
  }
  async unlock(record, channel) {
    if (!record.lock || record.lock.restored) return;
    const current = [...channel.permissionOverwrites.cache.values()].map(values);
    const desired = current.flatMap(item => {
      const original = record.lock.entries[item.id];
      if (!original) return [item];
      const mask = item.id === this.botId ? sendBit : POSTING_BITS;
      const restored = { ...item, allow: ((BigInt(item.allow) & ~mask) | (BigInt(original.allow) & mask)).toString(),
        deny: ((BigInt(item.deny) & ~mask) | (BigInt(original.deny) & mask)).toString() };
      return !original.existed && restored.allow === '0' && restored.deny === '0' ? [] : [restored];
    });
    if (!same(current, desired)) await channel.edit({ permissionOverwrites: desired, reason: `Donation break finished: ${record.name}` });
    record.lock.restored = true;
    this.store.save();
  }
  announcement(record, phase) {
    const text = phase === 'scheduled'
      ? `Donations will be paused from **${record.start} through ${record.end}**, inclusive (${this.timezone}).`
      : phase === 'active' ? `Donations are paused through **${record.end}**, inclusive (${this.timezone}).`
        : phase === 'cancelled' ? 'This scheduled donation break was cancelled. Donation requirements continue as usual.'
          : 'This donation break has ended. Posting permissions have been restored. Regular donation requirements resume on the next non-break day.';
    const payload = brandedMessage('Crazyland clan donation break.', `**${escapeMarkdown(record.name)}**\n\n${text}`
      + (['scheduled', 'active'].includes(phase) ? '\n\nNo donation proof or missing-proof reminders are required for these dates. During the break, this channel is read-only for regular members. Administrators can still post.' : '')
      + (record.reason ? `\n\n${escapeMarkdown(record.reason)}` : ''));
    payload.embeds[0].setFooter({ ...payload.embeds[0].data.footer, text: `${BRAND_FOOTER} • Donation break ${record.id}` });
    return payload;
  }
  async announce(record, channel, phase) {
    if (record.announcementPhase === phase && record.announcementMessageId) return;
    let message;
    if (record.announcementMessageId) {
      try { message = await channel.messages.fetch(record.announcementMessageId); }
      catch (error) { if (error.code !== 10008) throw error; }
    }
    if (!message) {
      let before;
      for (let page = 0; ; page++) {
        if (page >= 100) throw new Error('Cannot safely recover the break announcement; history scan limit reached.');
        const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
        message = [...batch.values()].find(item => item.author.id === this.botId
          && item.embeds?.some(embed => embed.footer?.text === `${BRAND_FOOTER} • Donation break ${record.id}`));
        if (message || batch.size < 100 || Math.min(...[...batch.values()].map(m => m.createdTimestamp)) < record.createdAt - 60000) break;
        before = [...batch.keys()].reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
      }
    }
    const payload = this.announcement(record, phase);
    if (message) await message.edit({ ...payload, attachments: [] });
    else message = await channel.send({ ...payload, nonce: createHash('sha256').update(`break:${this.guild.id}:${record.id}`).digest('hex').slice(0, 24), enforceNonce: true });
    record.announcementMessageId = message.id;
    record.announcementPhase = phase;
    this.store.save();
  }
  async sync() {
    const today = dayAt(this.now(), this.timezone);
    const errors = [];
    for (const record of donationBreaks(this.store.data).sort((a, b) => a.start.localeCompare(b.start))) {
      if (record.finished) continue;
      try {
        const channel = await this.channel(record.channelId);
        if (record.cancelledAt || record.endedAt || record.end < today) {
          // Restore permissions before declaring the break finished; failed
          // restores remain pending and are retried after restart or next tick.
          await this.unlock(record, channel);
          await this.announce(record, channel, record.cancelledAt ? 'cancelled' : 'ended');
          record.finished = true;
          this.store.save();
        } else if (record.start <= today) {
          await this.lock(record, channel);
          await this.announce(record, channel, 'active');
        } else await this.announce(record, channel, 'scheduled');
      } catch (error) {
        if (error.code === 10003) { if (record.start > today) record.cancelledAt = this.now(); else { record.end = today < record.end ? today : record.end; record.endedAt = this.now(); } record.finished = true; this.store.save(); }
        else errors.push(`${record.name}: ${error.message}`);
      }
    }
    if (errors.length) throw new Error(errors.join('; '));
  }
}
