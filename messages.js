import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatTimeoffDate } from './timeoff-date.js';

export const EMBED_COLOR = 0xf45f77;
export const REMINDER_AUTHOR = 'Crazyland clan donation reminder.';
export const REMINDER_DESCRIPTION = "Don't forget to donate your daily!";
export const BRAND_FOOTER = 'Crazyland Asylum';
// Retained for recovery of reminders sent by the previous version.
export const reminderFooter = (day, batchIndex) => `Crazyland • ${day} • Reminder ${batchIndex + 1}`;

function icon(kind, files) {
  const path = fileURLToPath(new URL(`./assets/${kind}-icon.png`, import.meta.url));
  if (existsSync(path)) {
    const name = `crazyland-${kind}.png`;
    files.push(new AttachmentBuilder(path, { name }));
    return `attachment://${name}`;
  }
  const configured = process.env[`EMBED_${kind.toUpperCase()}_ICON_URL`]?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (['https:', 'http:'].includes(url.protocol)) return url.href;
  } catch { /* Leave an unavailable icon out rather than breaking reminders. */ }
  return undefined;
}

export function brandedMessage(title, description, options = {}) {
  const files = [...(options.files || [])];
  const authorIcon = icon('author', files);
  const footerIcon = icon('footer', files);
  const thumbnailIcon = options.thumbnail === false ? undefined : icon('thumbnail', files) || footerIcon;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: title, ...(authorIcon ? { iconURL: authorIcon } : {}) })
    .setDescription(description)
    .setFooter({ text: BRAND_FOOTER, ...(footerIcon ? { iconURL: footerIcon } : {}) });
  if (thumbnailIcon) embed.setThumbnail(thumbnailIcon);
  if (options.fields?.length) embed.addFields(options.fields);
  return {
    content: options.content || '', embeds: [embed], files,
    allowedMentions: { parse: [], ...(options.mentionUsers ? { users: options.mentionUsers } : {}) },
  };
}

export function reminderMessage(day, timezone, ids, longTermIds = []) {
  const displayDay = formatTimeoffDate(day);
  const longTerm = new Set(longTermIds);
  const recentIds = ids.filter(id => !longTerm.has(id));
  const longIds = ids.filter(id => longTerm.has(id));
  const sections = [
    `Missing donation proof for **${displayDay}**`,
    recentIds.map(id => `<@${id}>`).join(' '),
  ];
  if (longIds.length) sections.push(`Haven't donated for 10 or more days:\n${longIds.map(id => `<@${id}>`).join(' ')}`);
  return brandedMessage(REMINDER_AUTHOR, REMINDER_DESCRIPTION, {
      // Discord only notifies mentions in message content, not inside embeds.
      content: sections.filter(Boolean).join('\n\n'),
      mentionUsers: ids,
      thumbnail: false,
    });
}

export function matchesReminder(message, day, batchIndex, batchIds) {
  if (message.content?.includes(`[donation-reminder:${day}:${batchIndex}]`)) return true;
  return Boolean(message.embeds?.some(embed => {
    if (embed.title === 'Donation proof reminder' && embed.footer?.text === reminderFooter(day, batchIndex)) return true;
    // The simpler footer no longer carries the batch number. Batches have
    // disjoint member IDs, so match the missed date and a member of this batch.
    return embed.author?.name === REMINDER_AUTHOR && embed.description === REMINDER_DESCRIPTION
      && embed.footer?.text === BRAND_FOOTER
      && (message.content?.startsWith(`Missing donation proof for **${formatTimeoffDate(day)}**\n`)
        || message.content?.startsWith(`Missing donation proof for **${day}** (`))
      && batchIds.some(id => message.content.includes(`<@${id}>`));
  }));
}
