// Dry planner for `npm run watch -- --dry`: which Instagram accounts the next run would read through the Graph API, in what order,
// how many calls that costs, and how long the whole list takes at the hourly cap. Pure: no network, no writes.
import * as wlib from "./watchlist.js";
import { runAllowance, HOURLY_LIMIT, HASHTAG_LIMIT } from "../adapters/instagram-graph.js";

export const RUNS_PER_DAY = 4; // .github/workflows/watch.yml: cron "17 */6 * * *"
export const PACING = "back to back, no sleep: a run ends when its calls are spent, the hour's counter says stop, or Meta answers code 4, 17 or 80002";

// Until the never-read backlog is under BACKLOG_LIMIT accounts, hashtag reads get HASHTAG_SHARE calls of the run, not their usual 90:
// the run's calls go to accounts nobody has read yet. Past that the harvest gets its full budget back.
export const BACKLOG_LIMIT = 50;
export const HASHTAG_SHARE = 30;
export const hashtagBudget = (backlog, full = Infinity) => (backlog >= BACKLOG_LIMIT ? Math.min(full, HASHTAG_SHARE) : full);

// Runs the never-read accounts need: real brands fill the room a run has beside the guessed cap, guessed handles go guessCap a run.
const runsFor = (real, guessed, room, guessCap) => Math.max(Math.ceil(real / Math.max(1, room - Math.min(guessCap, room))), guessed ? Math.ceil(guessed / Math.max(1, guessCap)) : 0);

// accounts: the watch list rows. tags: the hashtag tags this slot would read. hashtagCalls: the harvest's share of the run budget.
// -> { allowance, hashtagCalls, accountCalls, reads[], waiting, firstReadRuns, firstReadDays, steady }
export function planWatch({ accounts, now = new Date(), used = 0, tags = [], hashtagCalls = 0, graphOn = true, guessCap = 15, all = false }) {
  const allowance = runAllowance(used);
  const ig = (a) => a.platform === "instagram" && a.status !== "dropped" && !wlib.graphSkipped(a, now);
  const due = accounts.filter((a) => (all ? a.status !== "dropped" : wlib.isDue(a, now, { graphOn })));
  const backlogCount = wlib.graphBacklog(accounts, now);
  hashtagCalls = Math.min(hashtagCalls, hashtagBudget(backlogCount, hashtagCalls));
  const room = Math.max(0, allowance - Math.min(allowance, hashtagCalls));
  const reads = [];
  let guesses = 0, waitingGuess = 0, waitingBudget = 0;
  for (const a of wlib.graphOrder(due)) {
    if (!(graphOn && ig(a))) continue;
    if (a.guess) { if (guesses >= guessCap) { waitingGuess++; continue; } guesses++; }
    if (reads.length >= room) { waitingBudget++; continue; }
    reads.push(a);
  }
  const eligible = accounts.filter(ig);
  const never = eligible.filter((a) => !a.graph_checked_at);
  // Coverage is figured for a fresh slot (nothing used this hour): the 6-hour gap lets the counter empty. Guessed handles read guessCap a run.
  const slotRoom = Math.max(1, runAllowance(0) - Math.min(runAllowance(0), hashtagCalls));
  const neverGuess = never.filter((a) => a.guess).length, neverReal = never.length - neverGuess;
  const runsNeeded = runsFor(neverReal, neverGuess, slotRoom, guessCap);
  const runsNow = runsFor(neverReal, neverGuess, Math.max(1, room), guessCap); // at the allowance this run actually has
  // Steady state: reads a day the cadences ask for (24 h = 1, 72 h = 1/3, 168 h = 1/7) against what the cap allows.
  const demand = eligible.reduce((s, a) => s + 24 / (a.cadence_hours || wlib.cadenceFor(a, now)), 0);
  return {
    allowance, used, tags, hashtagCalls, accountCalls: reads.length, room, reads,
    due: due.length, eligible: eligible.length, waiting: { budget: waitingBudget, guessed: waitingGuess },
    slotRoom, unreadable: accounts.filter((a) => a.status === wlib.UNREADABLE).length,
    backlog: { count: backlogCount, cap: backlogCount >= BACKLOG_LIMIT ? HASHTAG_SHARE : null, runsNow, runsFresh: runsNeeded },
    firstRead: { accounts: never.length, real: neverReal, guessed: neverGuess, runs: runsNeeded, days: runsNeeded / RUNS_PER_DAY },
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
  L.push(`backlog: ${p.backlog.count} never-read accounts; ${p.backlog.runsNow} runs at this run's ${p.room} account reads (${p.backlog.runsFresh} on a fresh slot); hashtag reads ${p.backlog.cap ? `capped at ${p.backlog.cap} calls until the backlog is under ${BACKLOG_LIMIT}` : `back to the full budget (backlog under ${BACKLOG_LIMIT})`}; ${p.unreadable} accounts unreadable by Graph (never retried)`);
  L.push(`never read by Graph: ${p.firstRead.accounts} of ${p.eligible} Instagram accounts; ${p.firstRead.runs} runs = ${p.firstRead.days.toFixed(1)} days (${p.firstRead.real} real, ${p.firstRead.guessed} guessed) at ${RUNS_PER_DAY} runs a day, ${p.slotRoom} account reads a fresh run`);
  L.push(`steady state: cadences ask for about ${p.steady.readsPerDay} reads a day, the cap gives ${p.steady.capacityPerDay}`);
  L.push("order:");
  p.reads.slice(0, limit).forEach((a, i) => L.push(`  ${String(i + 1).padStart(3)}. @${a.handle} (${a.status}${a.guess ? ", guessed" : ""}${a.graph_checked_at ? "" : ", first read"})`));
  if (p.reads.length > limit) L.push(`  ... and ${p.reads.length - limit} more`);
  return L.join("\n");
}
