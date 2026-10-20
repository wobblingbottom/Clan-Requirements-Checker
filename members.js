// Use the paginated REST endpoint instead of gateway opcode 8. Historical
// donation reports can request several rosters in quick succession; the REST
// manager queues rate limits, while gateway member requests can fail outright.
export async function fetchMembers(guild) {
  const members = new Map();
  let after;
  for (;;) {
    const page = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
    for (const [id, member] of page) members.set(id, member);
    if (page.size < 1000) return members;
    const next = [...page.keys()].reduce((a, b) => BigInt(a) > BigInt(b) ? a : b);
    if (after && BigInt(next) <= BigInt(after)) {
      throw new Error('Member list pagination did not advance; no incomplete report was produced.');
    }
    after = next;
  }
}
