import { dayAt, hourAt, collectSubmissions } from './tracking.js';
import { classify, shiftDay, taggedName, TAG, VACATION_TAG, isExcused } from './state.js';
import { createHash } from 'node:crypto';
import { reminderMessage, matchesReminder } from './messages.js';
import { fetchMembers } from './members.js';
import { getSettings, isFormerMember, isClanLeader } from './configuration.js';
import { breakForDay, activeBreak } from './break-state.js';

export async function syncNickname(member, missing, store, vacation = false, clearOrphanTag = false) {
  let record = store.data.nicknames[member.id];
  const tag = vacation ? VACATION_TAG : missing ? TAG : null;
  if (!tag && !record && clearOrphanTag && (member.nickname?.includes(TAG) || member.nickname?.includes(VACATION_TAG))) {
    record = { original: member.nickname.replace(/\s*\[(?:No Donation Proof|Vacation)\]/g, '').trim() || null, applied: member.nickname };
  }
  if (!tag && !record) return;
  if (!member.manageable) throw new Error(`Cannot edit nickname for ${member.id}: check Manage Nicknames and role hierarchy.`);
  if (tag) {
    if (!record || (member.nickname !== record.applied && member.nickname !== record.original)) {
      const original = member.nickname?.includes(TAG) || member.nickname?.includes(VACATION_TAG)
        ? member.nickname.replace(/\s*\[(?:No Donation Proof|Vacation)\]/g, '').trim() || null
        : member.nickname;
      record = { original };
    }
    const base = record.original || member.displayName;
    record.applied = taggedName(base, tag);
    store.data.nicknames[member.id] = record;
    store.save(); // Persist original before the Discord mutation, including crash recovery.
    if (member.nickname !== record.applied) await member.setNickname(record.applied,
      vacation ? 'Approved vacation is active' : 'Daily donation proof is missing');
  } else {
    if (member.nickname === record.applied) {
      await member.setNickname(record.original, 'Donation proof received, time off, or Patient role removed');
    } else if (member.nickname?.includes(TAG) || member.nickname?.includes(VACATION_TAG)) {
      await member.setNickname(member.nickname.replace(/\s*\[(?:No Donation Proof|Vacation)\]/g, '').trim() || null,
        'Remove bot nickname marker while preserving a changed nickname');
    }
    delete store.data.nicknames[member.id];
    store.save();
  }
}
// Check history before retrying an interrupted send, to avoid duplicate reminders
// after a crash between Discord accepting a message and the local state save.
async function findReminder(channel, day, batchIndex, batchIds, since, botId) {
  let before;
  for (let page = 0; page < 100; page++) {
    const messages = await channel.messages.fetch({ limit: 100, before, cache: false });
    if (!messages.size) return null;
    for (const message of messages.values()) {
      // Support all previous message styles after upgrades.
      if (message.author.id === botId && matchesReminder(message, day, batchIndex, batchIds)) return message.id;
    }
    if (Math.min(...[...messages.values()].map(m => m.createdTimestamp)) < since || messages.size < 100) return null;
    before = [...messages.keys()].reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
  }
  throw new Error('Cannot safely verify whether the reminder was already sent; history scan limit reached.');
}

export class Automation {
  constructor({ guild, channel, reminder, store, timezone, botId, syncMemberRoles, now = () => Date.now() }) {
    Object.assign(this, { guild, channel, reminder, store, timezone, botId, syncMemberRoles, now });
    this.nicknameErrors = [];
    this.lastError = null;
    this.lastCheck = null;
  }
  async report(day, roster) {
    const [members, submissions] = await Promise.all([
      roster ?? fetchMembers(this.guild), collectSubmissions(this.channel, day, this.timezone),
    ]);
    const eligibleMembers = new Map([...members].filter(([, member]) =>
      !member.joinedTimestamp || dayAt(member.joinedTimestamp, this.timezone) <= day));
    return { ...classify(eligibleMembers, submissions, this.store.data, day), members, submissions };
  }
  async syncToday() {
    const now = this.now();
    const today = dayAt(now, this.timezone);
    const currentHour = hourAt(now, this.timezone);
    const roleSync = await this.syncMemberRoles?.();
    const report = await this.report(today, roleSync?.members);
    const missing = new Set(report.missing.map(m => m.id));
    const vacation = new Set(report.excused.filter(m => !report.pause || isExcused(this.store.data, m.id, today)).map(m => m.id));
    this.nicknameErrors = [...(roleSync?.errors || [])];
    const settings = getSettings(this.store.data);
    for (const member of report.members.values()) {
      const leader = isClanLeader(member, settings);
      try {
        const joinedDay = member.joinedTimestamp ? dayAt(member.joinedTimestamp, this.timezone) : null;
        const joinedHour = member.joinedTimestamp ? hourAt(member.joinedTimestamp, this.timezone) : null;
        const firstPingDay = joinedDay ? shiftDay(joinedDay, joinedHour < 6 ? 0 : 1) : null;
        const waitingForFirstPing = firstPingDay
          && (today < firstPingDay || (today === firstPingDay && currentHour < 6));
        await syncNickname(member, !leader && missing.has(member.id) && !waitingForFirstPing,
          this.store, !leader && vacation.has(member.id), report.pause || leader || isFormerMember(member, settings));
      }
      catch (error) { this.nicknameErrors.push(error.message); }
    }
    // Members who left cannot have their old server nickname restored.
    for (const id of Object.keys(this.store.data.nicknames)) {
      if (!report.members.has(id)) delete this.store.data.nicknames[id];
    }
    this.store.save();
    this.lastCheck = new Date(this.now()).toISOString();
    return report;
  }
  async closeDay(day) {
    if (breakForDay(this.store.data, day)) {
      this.store.data.lastClosedDay = day;
      delete this.store.data.jobs[day];
      this.store.save();
      return;
    }
    // An active break also silences pending reminders for earlier donation days.
    if (activeBreak(this.store.data, dayAt(this.now(), this.timezone))) return;
    const report = await this.report(day);
    let job = this.store.data.jobs[day];
    if (!job) {
      const ids = report.missing.map(m => m.id).sort();
      const missing = new Set(ids);
      // Seed new members (and installations upgraded from the counter-only
      // version) from actual proof history instead of waiting ten new days.
      const needsHistory = new Set(ids.filter(id => !this.store.data.missingStreaks[id]
        || !this.store.data.missingStreaksBackfilled));
      const historicalStreaks = Object.fromEntries([...needsHistory].map(id => [id, 1]));
      for (let offset = 1, checked = 0; checked < 9 && needsHistory.size && offset < 3660; offset++) {
        if (breakForDay(this.store.data, shiftDay(day, -offset))) continue;
        checked++;
        const previous = await this.report(shiftDay(day, -offset));
        const previousMissing = new Set(previous.missing.map(m => m.id));
        for (const id of needsHistory) {
          if (previousMissing.has(id)) historicalStreaks[id]++;
          else needsHistory.delete(id);
        }
      }
      for (const id of Object.keys(this.store.data.missingStreaks)) {
        if (!missing.has(id)) delete this.store.data.missingStreaks[id];
      }
      for (const id of ids) this.store.data.missingStreaks[id] = id in historicalStreaks
        ? historicalStreaks[id] : this.store.data.missingStreaks[id] + 1;
      this.store.data.missingStreaksBackfilled = true;
      job = { createdAt: this.now(), batches: [] };
      for (let i = 0; i < ids.length; i += 40) {
        const batchIds = ids.slice(i, i + 40);
        job.batches.push({ ids: batchIds,
          longTermIds: batchIds.filter(id => this.store.data.missingStreaks[id] >= 10), sent: false });
      }
      this.store.data.jobs[day] = job;
      this.store.save();
    }
    const stillMissing = new Set(report.missing.map(m => m.id));
    for (const [index, batch] of job.batches.entries()) {
      if (batch.sent) continue;
      const existing = await findReminder(this.reminder, day, index, batch.ids, job.createdAt - 60000, this.botId);
      if (existing) {
        batch.sent = existing;
        this.store.save();
        continue;
      }
      const ids = batch.ids.filter(id => stillMissing.has(id));
      if (ids.length) {
        // Recheck after asynchronous history scans in case the break just started.
        if (activeBreak(this.store.data, dayAt(this.now(), this.timezone))) return;
        const nonce = createHash('sha256').update(`${this.guild.id}:${day}:${index}`).digest('hex').slice(0, 24);
        const message = await this.reminder.send({
          ...reminderMessage(day, this.timezone, ids, batch.longTermIds?.filter(id => stillMissing.has(id))),
          nonce, enforceNonce: true,
        });
        batch.sent = message.id;
      } else batch.sent = 'skipped';
      this.store.save();
    }
    this.store.data.lastClosedDay = day;
    delete this.store.data.jobs[day];
    this.store.save();
  }
  async tick() {
    const errors = [];
    try {
      const now = this.now();
      const latestClosedDay = shiftDay(dayAt(now, this.timezone), hourAt(now, this.timezone) >= 6 ? -1 : -2);
      const pausedToday = activeBreak(this.store.data, dayAt(this.now(), this.timezone));
      // Catch up after downtime, bounded per tick to keep the bot responsive.
      for (let n = 0; n < 7 && !pausedToday && this.store.data.lastClosedDay < latestClosedDay; n++) {
        await this.closeDay(shiftDay(this.store.data.lastClosedDay, 1));
      }
    } catch (error) { errors.push(error); }
    // A reminder-channel failure must not prevent today's nickname cleanup.
    try { await this.syncToday(); } catch (error) { errors.push(error); }
    this.lastError = errors.length ? errors.map(error => error.message).join('; ') : null;
    if (errors.length) throw new Error(this.lastError);
  }
}
