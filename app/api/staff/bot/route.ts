import { db, failure, json, requireStaff } from "@/lib/server";
import { botOnline, getBotStatus } from "@/lib/bot-shared";

type PollRow = { id: string; chat_jid: string; name: string; options: string; message_id: string | null; created_at: number; sent_at: number | null; subject: string | null };
type VoteRow = { poll_id: string; voter_jid: string; voter_phone: string | null; name: string | null; selected: string; voted_at: number };

/** Staff view of the bot: connection, groups, recent commands and live poll results. */
export async function GET() {
  try {
    await requireStaff();
    const status = await getBotStatus();
    const [groups, outbox, polls] = await Promise.all([
      db().prepare("SELECT jid,subject,size,bot_is_admin FROM bot_groups ORDER BY subject").all(),
      db().prepare("SELECT o.id,o.kind,o.chat_jid,o.payload,o.status,o.attempts,o.error,o.created_at,o.sent_at,g.subject FROM bot_outbox o LEFT JOIN bot_groups g ON g.jid=o.chat_jid ORDER BY o.created_at DESC LIMIT 20").all(),
      db().prepare("SELECT p.id,p.chat_jid,p.name,p.options,p.message_id,p.created_at,p.sent_at,g.subject FROM polls p LEFT JOIN bot_groups g ON g.jid=p.chat_jid ORDER BY p.created_at DESC LIMIT 10").all<PollRow>(),
    ]);
    const ids = polls.results.map(p => p.id);
    let current: VoteRow[] = [], history: (VoteRow & { poll_name: string })[] = [];
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      // Current choice of each voter = their latest event.
      current = (await db().prepare(`SELECT DISTINCT ON (e.poll_id, e.voter_jid) e.poll_id,e.voter_jid,e.voter_phone,pa.name,e.selected,e.voted_at
        FROM poll_vote_events e LEFT JOIN participants pa ON pa.id=e.participant_id WHERE e.poll_id IN (${marks})
        ORDER BY e.poll_id, e.voter_jid, e.voted_at DESC`).bind(...ids).all<VoteRow>()).results;
      history = (await db().prepare(`SELECT e.poll_id,e.voter_jid,e.voter_phone,pa.name,e.selected,e.voted_at,p.name AS poll_name
        FROM poll_vote_events e JOIN polls p ON p.id=e.poll_id LEFT JOIN participants pa ON pa.id=e.participant_id
        WHERE e.poll_id IN (${marks}) ORDER BY e.voted_at DESC LIMIT 40`).bind(...ids).all<VoteRow & { poll_name: string }>()).results;
    }
    return json({
      status: status ? { ...status, online: botOnline(status) } : null,
      groups: groups.results,
      outbox: outbox.results.map(o => ({ ...o, payload: JSON.parse(String(o.payload)) })),
      polls: polls.results.map(p => {
        const options: string[] = JSON.parse(p.options);
        const voters = current.filter(v => v.poll_id === p.id).map(v => ({ ...v, selected: JSON.parse(v.selected) as string[] }));
        return { ...p, options, tally: options.map(option => ({ option, voters: voters.filter(v => v.selected.includes(option)) })) };
      }),
      history: history.map(h => ({ ...h, selected: JSON.parse(h.selected) as string[] })),
    });
  } catch (error) { return failure(error); }
}
