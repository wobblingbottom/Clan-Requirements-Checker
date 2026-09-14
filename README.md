# Crazyland daily donation bot

Checks only human members with the **Patient** role, ID `1532826238572298451`, for an image attachment in donation channel `1535655837828382740` each calendar day. The bot sends end-of-day reminders and missing-member pings in that same channel. Daily boundaries use **Europe/Paris** by default.

## What happens each day

- Every minute, the bot checks today's donation-channel history. Missing members get ` [No Donation Proof]` appended to their server nickname. This means the label appears from the beginning of each day until proof is posted.
- An image upload triggers another check and receives a 📸 reaction. The label is removed after proof is found, while approved time off applies, or after the Patient role is removed.
- Shortly after midnight, the bot **pings yesterday's missing members in the donation channel**, explicitly naming the missed date. Approved days off for that date exclude members from the ping list. The new day's proof does not count for yesterday.
- Members on approved time off appear as **Excused** in reports. Pending requests do not excuse them. Requirements resume automatically the day after their last approved day off.

The bot checks that an image was uploaded. Officers still need to verify that the image proves the donation and meets the required amount.

## Commands and the Discord admin panel

| Command | Who can use it | Purpose |
| --- | --- | --- |
| `/donations` | Manage Server | Today's submitted, missing and excused members, with proof links |
| `/donations date:2026-09-14` | Manage Server | Report for a previous date |
| `/timeoff start:2026-09-15 days:3 reason:Holiday` | Patient members | Request September 15–17 inclusive |
| `/timeoff-status` | Members | View their own requests and approved dates |
| `/donation-admin` | Administrator | Open the private admin panel |

The `/donation-admin` command opens a panel with buttons for **Requests & days off**, **Grant days off**, **Approve request**, **Reject request**, and **Revoke days off**. Requests, grants and automation issues appear directly in the embed, together with the pending-request count. The panel does not show tracked-member, timezone or last-check fields. Longer lists have **Previous** and **Next** buttons; no text-file cards are sent. Opening or refreshing the panel removes attachments left by an older version.

To approve a request, open the list and copy its request ID into **Approve request**. The member's requested dates are approved as submitted. To assign different dates or grant time off without a request, choose **Grant days off** and enter the member's Discord ID, start date, and number of days. Reject an obsolete pending request separately.

Periods include both the start and end date, and can last 1–365 days. Overlapping grants are allowed; any applicable grant excuses the member. Revoking a grant voids that entire grant, including in later historical reports. It does not cancel other overlapping grants. Admins can grant retroactive days off, but this cannot retract reminders already sent. Members can request today or future dates and have up to five pending requests.

All command responses and the admin panel are private to the person using them. Members see approval or rejection through `/timeoff-status`; the bot does not send DMs. Only the end-of-day reminder intentionally pings members.

## Setup

1. Install **Node.js 22.12 or newer**.
2. Create an application and bot at [Discord Developer Portal](https://discord.com/developers/applications). Enable **Server Members Intent** and **Message Content Intent** on the Bot page.
3. Invite it to your server with the `bot` and `applications.commands` scopes. Give the bot **View Channels**, **Read Message History**, **Add Reactions**, **Send Messages**, **Attach Files**, **Embed Links**, and **Manage Nicknames**. Check channel overrides in the donation channel and channels where commands are used.
4. Move the bot's highest role **above the highest role of every Patient member whose nickname it must edit**. Discord does not allow the bot to rename the server owner or members above/equal to its role. The admin panel reports these failures; eligible members still appear in reminder lists.
5. Enable Discord Developer Mode, then copy your server ID and donation text-channel ID. Patient role ID `1532826238572298451` is already set in `state.js`; any old `CLAN_ROLE_ID` setting is ignored.
6. Copy `.env.example` to `.env`, then set `DISCORD_TOKEN`, `GUILD_ID`, and `DONATION_CHANNEL_ID`. Keep the token private. Set `TIMEZONE` before first launch if the clan uses a timezone other than Europe/Paris.
7. From the project directory run:

   ```powershell
   npm.cmd install
   npm.cmd start
   ```

Keep the process running for automatic checks. Run **only one instance** for this server. Stop it with Ctrl+C. Slash commands are registered for the configured server on startup. No separate web dashboard is needed.

## Railway

Deploy this repository as a Railway service and use `npm start`. The local `.env` file is optional; on Railway, set `DISCORD_TOKEN`, `GUILD_ID`, `DONATION_CHANNEL_ID=1535655837828382740`, and `TIMEZONE=Europe/Paris` in the service's Variables tab. Do not upload `.env` to GitHub.

Attach a persistent volume at `/app/data` before starting the bot, keep one replica, and leave the HTTP healthcheck path empty. The bot has no web server and needs no public domain. After deployment, check logs for `Ready: Patient daily checks in Europe/Paris.`

## Message appearance

All bot replies use colour `#f45f77`, the message heading in the author row beside the pointing-hand icon, and a footer reading **Crazyland Asylum** beside the Crazyland logo. There is no separate embed title. Reminders match the supplied example: **Crazyland clan donation reminder.** in the author row and **Don't forget to donate your daily!** in the body, without statistic fields. The missed date and actual member pings appear above the embed. Reports, personal time-off lists and admin issues are shown in the embeds with page buttons when needed. Reports include clickable screenshot links; there are no text report attachments.

The pointing-hand author icon loads from `assets/author-icon.png`; the Crazyland footer logo loads from `assets/footer-icon.png`. When present, both are attached directly to each message. Otherwise set `EMBED_AUTHOR_ICON_URL` to the pointing-hand image URL and `EMBED_FOOTER_ICON_URL` to the Crazyland logo URL in Railway Variables. Missing icons are omitted. The bot needs **Embed Links** permission in the donation channel.

## Storage, recovery and limits

- `data/state.json` stores requests, grants, original nicknames and reminder progress. It is created on first startup and excluded from Git. **Keep this folder on persistent storage and back it up**. Writes replace the file atomically. Corrupt state causes startup to fail rather than silently forgetting exemptions or nickname originals.
- Nicknames are limited to 32 characters by Discord, so a long name is shortened while tagged. Its full original nickname is restored when the tag clears. Members who had no server nickname are restored to no nickname. Later manual nickname edits are preserved when possible. This changes the server nickname, never the account username.
- On first installation, tracking starts with the current day, with no reminders for earlier days. After a restart, saved progress allows missed days to be processed, up to seven per check. A interrupted reminder is checked against bot message history before resending. Failed scans do not produce a partial missing list.
- Current Patient membership is used even for historical dates and downtime catch-up; membership history is not recorded. Someone newly assigned Patient before catch-up may appear as missing on an earlier date. Today's report remains provisional until the day ends.
- Direct PNG, JPEG, WebP and GIF attachments with image metadata count. Image links, embeds, videos, thread posts, bot posts and webhook posts do not count. Multiple images by one member still count as one submitted member.
- Reports re-read Discord history. Images posted while the bot was offline still count. Deleting an image removes its proof from future checks; editing an image attachment is reflected on the next check. Deleting channel history also deletes evidence. Submitted screenshots are not downloaded to disk.
- Scans have a 10,000-message safety limit. Use a dedicated donation channel. Deleted reminder history can prevent duplicate-send recovery after a crash.
- State is bound to the server and timezone; changing either requires a deliberate state migration. Do not delete the state file while labels are applied, as that loses the full original nicknames.

## Verification

Run `npm.cmd test` for local tests of date boundaries, Patient-only filtering, inclusive exemptions, expiry, access checks, nickname restoration, persistence, reminder batching, midnight processing and interrupted-send recovery. Tests use fake Discord members/channels and never connect to Discord.

For a live check in a test server with the configured role: start the bot, confirm a missing Patient gets the label, upload an image, and confirm the label clears. Request time off, approve it in `/donation-admin`, and check that `/donations` lists the member as Excused. Confirm a non-admin cannot open the admin panel. At the next local midnight, check that only missing, non-excused Patients are pinged for the day that just ended.

References: [discord.js API](https://discord.js.org/docs/packages/discord.js/stable) and [Discord gateway intents](https://docs.discord.com/developers/events/gateway).
