// Dry planner for `npm run watch -- --dry`: which Instagram accounts the next run would read through the Graph API, in what order,
// how many calls that costs, and how long the whole list takes at the hourly cap. Pure: no network, no writes.
import * as wlib from "./watchlist.js";
import { runAllowance, HOURLY_LIMIT, HASHTAG_LIMIT } from "../adapters/instagram-graph.js";

export const RUNS_PER_DAY = 4; // .github/workflows/watch.yml: cron "17 */6 * * *"
export const PACING = "back to back, no sleep: a run ends when its calls are spent, the hour's counter says stop, or Meta answers code 4, 17 or 80002";

// accounts: the watch list rows. tags: the hashtag tags this slot would read. hashtagCalls: the harvest's share of the run budget.
// -> { allowance, hashtagCalls, accountCalls, reads[], waiting, firstReadRuns, firstReadDays, steady }
export function planWatch({ accounts, now = new Date(), used = 0, tags = [], hashtagCalls = 0, graphOn = true, guessCap = 15, all = false }) {
  const allowance = runAllowance(used);
  const ig = (a) => a.platform === "instagram" && a.status !== "dropped" && !wlib.graphSkipped(a, now);
  const due = accounts.filter((a) => (all ? a.status !== "dropped" : wlib.isDue(a, now, { graphOn })));
  const room = Math.max(0, allowance - Math.min(allowance, hashtagCalls));
  const reads = [];
  let guesses = 0, waitingGuess = 0, waitingBudget = 0;
  for (const a of wlib.prioritize(due)) {
    if (!(graphOn && ig(a))) continue;
    if (a.guess) { if (guesses >= guessCap) { waitingGuess++; continue; } guesses++; }
    if (reads.length >= room) { waitingBudget++; continue; }
    reads.push(a);
  }
  const eligible = accounts.filter(ig);
  const never = eligible.filter((a) => !a.graph_checked_at);
  // Coverage is figured for a fresh slot (nothing used this hour): the 6-hour gap lets the counter empty. Guessed handles read guessCap a run.
  const slotRoom = Math.max(1, runAllowance(0) - Math.min(runAllowance(0), hashtagCalls));
  const perRun = slotRoom;
  const neverGuess = never.filter((a) => a.guess).length, neverReal = never.length - neverGuess;
  const runsNeeded = Math.max(Math.ceil(neverReal / Math.max(1, slotRoom - Math.min(guessCap, slotRoom))), neverGuess ? Math.ceil(neverGuess / Math.max(1, guessCap)) : 0);
  // Steady state: reads a day the cadences ask for (24 h = 1, 72 h = 1/3, 168 h = 1/7) against what the cap allows.
  const demand = eligible.reduce((s, a) => s + 24 / (a.cadence_hours || wlib.cadenceFor(a, now)), 0);
  return {
    allowance, used, tags, hashtagCalls, accountCalls: reads.length, room, reads,
    due: due.length, eligible: eligible.length, waiting: { budget: waitingBudget, guessed: waitingGuess },
    slotRoom, firstRead: { accounts: never.length, real: neverReal, guessed: neverGuess, runs: runsNeeded, days: runsNeeded / RUNS_PER_DAY },
    steady: { readsPerDay: Math.round(demand), capacityPerDay: slotRoom * RUNS_PER_DAY },
  };
}

export const hoursToCover = (n, perHour = HOURLY_LIMIT - 20) => n / perHour;

export function formatPlan(p, { limit = 40 } = {}) {
  const L = [];
  L.push(`dry plan (no network, nothing written)`);
  L.push(`Graph budget this run: ${p.allowance} calls (cap ${HOURLY_LIMIT}/hour less 20 spare, ${p.used} already used this rolling hour)`);
  L.push(`hashtags: ${p.tags.length} tags in this slot's week list (${HASHTAG_LIMIT} unique per 7 days), up to ${p.hashtagCalls} calls: ${p.tags.slice(0, 12).join(", ")}${p.tags.length > 12 ? ", ..." : ""}`);
  L.push(`accounts: ${p.accountCalls} Graph reads (1 call each) of ${p.due} due; ${p.waiting.budget} wait for budget, ${p.waiting.guessed} guessed handles wait past the cap`);
  L.push(`total calls this run: ${Math.min(p.allowance, p.hashtagCalls) + p.accountCalls} of ${p.allowance}`);
  L.push(`pacing: ${PACING}`);
  L.push(`never read by Graph: ${p.firstRead.accounts} of ${p.eligible} Instagram accounts; ${p.firstRead.runs} runs = ${p.firstRead.days.toFixed(1)} days (${p.firstRead.real} real, ${p.firstRead.guessed} guessed) at ${RUNS_PER_DAY} runs a day, ${p.slotRoom} account reads a fresh run`);
  L.push(`steady state: cadences ask for about ${p.steady.readsPerDay} reads a day, the cap gives ${p.steady.capacityPerDay}`);
  L.push("order:");
  p.reads.slice(0, limit).forEach((a, i) => L.push(`  ${String(i + 1).padStart(3)}. @${a.handle} (${a.status}${a.guess ? ", guessed" : ""}${a.graph_checked_at ? "" : ", first read"})`));
  if (p.reads.length > limit) L.push(`  ... and ${p.reads.length - limit} more`);
  return L.join("\n");
}
