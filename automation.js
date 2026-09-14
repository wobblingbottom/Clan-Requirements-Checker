import { dayAt, collectSubmissions } from './tracking.js';
import { classify, shiftDay, taggedName, TAG } from './state.js';
import { createHash } from 'node:crypto';
import { reminderMessage, matchesReminder } from './messages.js';

export async function syncNickname(member, missing, store) {
  let record = store.data.nicknames[member.id];
  if (!missing && !record) return;
  if (!member.manageable) throw new Error(`Cannot edit nickname for ${member.id}: check Manage Nicknames and role hierarchy.`);
  if (missing) {
    if (!record || (member.nickname !== record.applied && member.nickname !== record.original)) {
      const original = member.nickname?.includes(TAG)
        ? member.nickname.replace(/\s*\[No Donation Proof\]/g, '').trim() || null
        : member.nickname;
      record = { original, applied: taggedName(member.displayName) };
      store.data.nicknames[member.id] = record;
      store.save(); // Persist original before the Discord mutation, including crash recovery.
    }
    if (member.nickname !== record.applied) await member.setNickname(record.applied, 'Daily donation proof is missing');
  } else {
    if (member.nickname === record.applied) {
      await member.setNickname(record.original, 'Donation proof received, time off, or Patient role removed');
    } else if (member.nickname?.includes(TAG)) {
      await member.setNickname(member.nickname.replace(/\s*\[No Donation Proof\]/g, '').trim() || null,
        'Remove donation marker while preserving a changed nickname');
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
  constructor({ guild, channel, reminder, store, timezone, botId, now = () => Date.now() }) {
    Object.assign(this, { guild, channel, reminder, store, timezone, botId, now });
    this.nicknameErrors = [];
    this.lastError = null;
    this.lastCheck = null;
  }
  async report(day) {
    const [members, submissions] = await Promise.all([
      this.guild.members.fetch(), collectSubmissions(this.channel, day, this.timezone),
    ]);
    return { ...classify(members, submissions, this.store.data, day), members, submissions };
  }
  async syncToday() {
    const today = dayAt(this.now(), this.timezone);
    const report = await this.report(today);
    const missing = new Set(report.missing.map(m => m.id));
    this.nicknameErrors = [];
    for (const member of report.members.values()) {
      try { await syncNickname(member, missing.has(member.id), this.store); }
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
    const report = await this.report(day);
    let job = this.store.data.jobs[day];
    if (!job) {
      const ids = report.missing.map(m => m.id).sort();
      job = { createdAt: this.now(), batches: [] };
      for (let i = 0; i < ids.length; i += 40) job.batches.push({ ids: ids.slice(i, i + 40), sent: false });
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
        const nonce = createHash('sha256').update(`${this.guild.id}:${day}:${index}`).digest('hex').slice(0, 24);
        const message = await this.reminder.send({
          ...reminderMessage(day, this.timezone, ids),
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
      const yesterday = shiftDay(dayAt(this.now(), this.timezone), -1);
      // Catch up after downtime, bounded per tick to keep the bot responsive.
      for (let n = 0; n < 7 && this.store.data.lastClosedDay < yesterday; n++) {
        await this.closeDay(shiftDay(this.store.data.lastClosedDay, 1));
      }
    } catch (error) { errors.push(error); }
    // A reminder-channel failure must not prevent today's nickname cleanup.
    try { await this.syncToday(); } catch (error) { errors.push(error); }
    this.lastError = errors.length ? errors.map(error => error.message).join('; ') : null;
    if (errors.length) throw new Error(this.lastError);
  }
}
