export function dayAt(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

export function hasImage(message) {
  return [...message.attachments.values()].some(a =>
    ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.contentType?.split(';')[0])
    && a.width > 0 && a.height > 0);
}

export async function latestScreenshot(channel, userId, maxPages = 100) {
  let before;
  for (let page = 0; page < maxPages; page++) {
    const batch = await channel.messages.fetch({ limit: 100, cache: false, ...(before ? { before } : {}) });
    const messages = [...batch.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1);
    const proof = messages.find(message => message.author.id === userId
      && !message.author.bot && !message.webhookId && hasImage(message));
    if (proof) return { url: proof.url, status: 'found' };
    if (messages.length < 100) return { status: 'not-found' };
    before = messages.at(-1).id;
  }
  return { status: 'limit' };
}

// Fetch around the local day with enough padding for all UTC offsets and DST.
// Read Discord history each time so restarts, missed events, and deletions are reflected.
export async function collectSubmissions(channel, day, timezone) {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const lower = midnight - 36 * 3600000;
  const upper = midnight + 48 * 3600000;
  let before = ((BigInt(upper) - 1420070400000n) << 22n).toString();
  const submissions = new Map();
  for (let page = 0; page < 100; page++) {
    const messages = await channel.messages.fetch({ limit: 100, before, cache: false });
    if (!messages.size) return submissions;
    let oldest = Infinity;
    for (const message of messages.values()) {
      oldest = Math.min(oldest, message.createdTimestamp);
      if (!message.author.bot && !message.webhookId && hasImage(message)
          && dayAt(message.createdTimestamp, timezone) === day
          && !submissions.has(message.author.id)) {
        submissions.set(message.author.id, message.url);
      }
    }
    if (oldest < lower || messages.size < 100) return submissions;
    before = [...messages.keys()].reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
  }
  throw new Error('Too many messages to scan safely. No incomplete report was produced.');
}
