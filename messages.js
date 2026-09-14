import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const EMBED_COLOR = 0xf45f77;
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
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: 'Crazyland', ...(authorIcon ? { iconURL: authorIcon } : {}) })
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: options.footer || 'Crazyland • Clan Requirements', ...(footerIcon ? { iconURL: footerIcon } : {}) });
  if (options.fields?.length) embed.addFields(options.fields);
  return {
    content: options.content || '', embeds: [embed], files,
    allowedMentions: { parse: [], ...(options.mentionUsers ? { users: options.mentionUsers } : {}) },
  };
}

export function reminderMessage(day, timezone, channelId, ids, batchIndex) {
  return brandedMessage('Donation proof reminder',
    `We couldn’t find your donation proof for **${day}**.\nPlease remember to post your daily screenshot in <#${channelId}>.\n\nMembers with approved days off are excused.`, {
      // Discord only notifies mentions in message content, not inside embeds.
      content: ids.map(id => `<@${id}>`).join(' '), mentionUsers: ids,
      fields: [
        { name: 'Date', value: day, inline: true },
        { name: 'Timezone', value: timezone, inline: true },
        { name: 'Missing proof', value: String(ids.length), inline: true },
      ],
      footer: reminderFooter(day, batchIndex),
    });
}
