import express from 'express';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import multer from 'multer';
import { randomInt } from 'crypto';

dotenv.config();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

const SUPABASE_URL = process.env.SUPABASE_URL ? process.env.SUPABASE_URL : 'https://hsnaqddekfddbpamajpw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// The one shared client for all database work. It uses the service_role key,
// which bypasses row-level security — but ONLY as long as nobody signs a user
// in on it. Calling signInWithPassword on a client makes that client start
// acting as that user from then on (and row-level security suddenly applies
// to it), which is what broke support messages and the staff check. So never
// call signInWithPassword on this client; use signInWithPassword() below.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOptions);

// Signs a user in on a throwaway client that is discarded straight away, so
// the shared client above is never affected.
function signInWithPassword(email, password) {
  const throwaway = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOptions);
  return throwaway.auth.signInWithPassword({ email, password });
}

const FEE_PERCENT = 0.05; // 5% platform fee — keep in sync with the frontend's displayed label
const MIN_TRANSFER_USD = 10; // keep in sync with the frontend's MIN_TRANSFER_USD
const MAX_TRANSFER_USD = 500; // per transfer; keep in sync with the frontend's MAX_TRANSFER_USD

// Regions. Each country is its own side of the business: its own currency,
// its own ways of taking money in (what a sender pays with when sending FROM
// there) and its own ways of paying money out (what a recipient gets when
// money is sent TO there). Adding a country later means adding a row to each
// of these tables (and to the frontend's matching tables).
const REGIONS = ['US', 'GH', 'NG'];
const COUNTRY_CURRENCY = { US: 'USD', GH: 'GHS', NG: 'NGN' };

// Pay-in and payout are kept as mirror images: whatever someone in a country
// can pay WITH, a recipient in that country can be paid BY (cash drop-off
// pairs with cash pickup). When you add a method to one list, add its twin to
// the other, and to the same two lists in the frontend's App.js.
const PAYIN_METHODS = {
  US: ['Zelle', 'PayPal_FF', 'BinancePay', 'BybitPay', 'USDT_SOL'],
  GH: ['MTN_MOMO', 'GH_BANK', 'GH_CASH_DROPOFF', 'USDT_SOL'],
  NG: ['NG_BANK', 'USDT_SOL']
};

const PAYOUT_METHODS_BY_COUNTRY = {
  US: ['us_zelle', 'us_paypal', 'us_binance', 'us_bybit', 'us_usdt'],
  GH: ['mobile_money', 'bank_transfer', 'cash_pickup', 'gh_usdt'],
  NG: ['bank_transfer', 'ng_usdt']
};

// Payout methods where the recipient gives one line of details (an email, a
// Pay ID, a UID or a wallet address) that is stored in payout_handle.
const HANDLE_PAYOUTS = ['us_zelle', 'us_paypal', 'us_binance', 'us_bybit', 'us_usdt', 'gh_usdt', 'ng_usdt'];
// The ones that are USDT on Solana: the address is checked before accepting.
const USDT_PAYOUTS = ['us_usdt', 'gh_usdt', 'ng_usdt'];

// Cash pickup: a CediPay employee hands the recipient cash (Ghana only, via
// PAYOUT_METHODS_BY_COUNTRY), with its own lower per-transfer cap (keep
// CASH_PICKUP_MAX_USD in sync with the frontend). The server makes a random
// 6-digit pickup code that only the sender (and, through them, the recipient)
// ever sees — staff are never shown it, they have to type in what the
// recipient tells them and the server checks it before the transfer can be
// marked as handed over.
const CASH_PICKUP_MAX_USD = 300;

// How the fee is shared out, as fractions of the fee that add up to 1.
//   collector = the region that took the sender's money in
//   payer     = the region that pays the recipient out
//   owner     = the person running the app
// Right now the 5% fee is split in half: 2.5% for the team that collected the
// sender's money and 2.5% for the team that pays the recipient. To change the
// split later, edit these three numbers — each transfer remembers the split
// that was in force when it was made, so old transfers are never rewritten.
const FEE_SPLIT = { collector: 0.5, payer: 0.5, owner: 0 };

function stripPickupCode(row) {
  if (!row) return row;
  const { pickup_code, ...rest } = row;
  return rest;
}
const FALLBACK_RATES = { GHS: 15.5, NGN: 1650 }; // emergency-only fallback if both live sources fail

// Wide sanity bands for a "units of local currency per 1 USD" rate. A live
// source that returns something outside its band (a different currency's
// number, a glitch, a blocked response parsed wrongly) is thrown away and
// the next source is tried, instead of showing customers a nonsense rate.
// Widen these if either currency ever genuinely moves outside its band.
const RATE_SANITY_BANDS = { GHS: [3, 60], NGN: [300, 10000] };
function isPlausibleRate(currencyCode, rate) {
  const band = RATE_SANITY_BANDS[currencyCode];
  if (!Number.isFinite(rate) || rate <= 0) return false;
  if (!band) return true;
  const ok = rate >= band[0] && rate <= band[1];
  if (!ok) console.warn(`Discarding implausible ${currencyCode} rate: ${rate} (expected between ${band[0]} and ${band[1]})`);
  return ok;
}

// A transaction's lifecycle. Users can only ever create one in 'pending' —
// every later state is set by a signed-in admin from the staff screen.
const TRANSACTION_STATUSES = ['pending', 'payment_received', 'sent', 'completed', 'rejected'];

// Staff (admin) accounts live in Supabase Auth too, under their own email
// domain so they can never collide with or be confused for a regular
// customer account, plus a row in admin_profiles that's the actual source
// of truth for "is this person allowed into the staff screen."
const ADMIN_EMAIL_DOMAIN = 'admin.cedipay.local';
const ADMIN_INVITE_CODE = process.env.ADMIN_INVITE_CODE;

function cleanHandle(raw) {
  return (raw || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// There's no separate staff sign-up screen anymore — staff sign in on the
// regular form with one of these usernames, which the frontend routes to
// /api/admin/login instead of /api/login. Block customers from registering
// with one of these so there's no confusion about which path they're on.
// (The frontend already blocks this too, but the server never trusts that.)
const RESERVED_ADMIN_HANDLES = ['admin-ghana', 'admin-usa', 'admin-nigeria', 'admin-owner'].map(cleanHandle);

// Which region each staff account belongs to. admin_profiles.region is the
// real source (set by the multi-region SQL); this is only the fallback for a
// profile whose region hasn't been filled in. 'ALL' is the owner's read-only
// overview of every region.
const ADMIN_REGIONS = ['US', 'GH', 'NG', 'ALL'];
const REGION_BY_HANDLE = { adminusa: 'US', adminghana: 'GH', adminnigeria: 'NG', adminowner: 'ALL' };

async function loadAdminProfile(userId, email) {
  const { data: profile, error } = await supabase
    .from('admin_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error || !profile) return null;
  const handle = (email || '').split('@')[0];
  const region = ADMIN_REGIONS.includes(profile.region) ? profile.region : (REGION_BY_HANDLE[handle] || null);
  return { displayName: profile.display_name, region };
}

// ---- Money logic: kept free of database and network calls so it can be
// tested on its own. Rates everywhere are "units of local currency per 1 USD";
// USD is the middle step for every currency pair. ----
const round2 = (n) => Math.round(n * 100) / 100;

// Splits the fee (in USD) between the collecting region, the paying region
// and the owner. The paying region's part is whatever is left after the other
// two are rounded to cents, so the three parts always add up to exactly the
// fee (a half cent never goes missing or appears out of nowhere).
function splitFee(feeUSD, split = FEE_SPLIT) {
  let collector = round2(feeUSD * split.collector);
  const owner = round2(feeUSD * split.owner);
  let payer = round2(feeUSD - collector - owner);
  if (payer < 0) {
    // Rounding pushed the first two parts a cent over the fee; take it back.
    collector = round2(collector + payer);
    payer = 0;
  }
  return { collector, payer, owner };
}

// Turns what the sender typed (an amount in THEIR currency) into every number
// stored on the transfer.
function computeTransfer({ amountSend, originRate, destRate }) {
  const feeSend = round2(amountSend * FEE_PERCENT);
  const netSend = amountSend - feeSend;
  const amountUSD = round2(amountSend / originRate);
  const feeUSD = round2(feeSend / originRate);
  const amountLocal = round2((netSend / originRate) * destRate);
  return { feeSend, amountUSD, feeUSD, amountLocal, feeSplit: splitFee(feeUSD) };
}

// Works out, per region, what it has collected, what it has paid out, what
// fee it has earned, and what it therefore owes to (or is owed by) the other
// regions. All in USD equivalents.
//   collected  = money taken in from senders once payment is confirmed
//   paid out   = money sent to recipients (the amount after the fee)
//   net to settle = (collected - own fee share kept) - (paid out + fee share
//     for paying out). Positive: this region holds money that belongs to
//     other regions or the owner. Negative: other regions owe it.
function buildLedger(rows) {
  const regions = {};
  REGIONS.forEach((r) => {
    regions[r] = { collected_usd: 0, collected_count: 0, fee_kept_usd: 0, paid_out_usd: 0, paid_out_count: 0, fee_for_payout_usd: 0, net_to_settle_usd: 0 };
  });
  let ownerFee = 0;

  for (const t of rows) {
    const origin = t.origin_country || 'US';
    const amount = Number(t.amount_usd) || 0;
    const fee = Number(t.fee_usd) || 0;
    // Transfers made before fee splitting existed: the collector kept it all.
    const collectorShare = t.fee_collector_usd != null ? Number(t.fee_collector_usd) : fee;
    const payerShare = t.fee_payer_usd != null ? Number(t.fee_payer_usd) : 0;
    const ownerShare = t.fee_owner_usd != null ? Number(t.fee_owner_usd) : 0;

    if (['payment_received', 'sent', 'completed'].includes(t.status) && regions[origin]) {
      regions[origin].collected_usd += amount;
      regions[origin].collected_count += 1;
      regions[origin].fee_kept_usd += collectorShare;
      ownerFee += ownerShare;
    }
    if (['sent', 'completed'].includes(t.status) && regions[t.recipient_country]) {
      regions[t.recipient_country].paid_out_usd += amount - fee;
      regions[t.recipient_country].paid_out_count += 1;
      regions[t.recipient_country].fee_for_payout_usd += payerShare;
    }
  }

  REGIONS.forEach((r) => {
    const x = regions[r];
    x.net_to_settle_usd = round2((x.collected_usd - x.fee_kept_usd) - (x.paid_out_usd + x.fee_for_payout_usd));
    x.collected_usd = round2(x.collected_usd);
    x.fee_kept_usd = round2(x.fee_kept_usd);
    x.paid_out_usd = round2(x.paid_out_usd);
    x.fee_for_payout_usd = round2(x.fee_for_payout_usd);
  });
  return { regions, owner_fee_usd: round2(ownerFee) };
}

// ---- The settlement ledger (who owes whom, fees earned, history) ----
//
// How the money works between the teams, for one transfer of $100 with a 5%
// fee split 2.5% / 2.5%:
//   - the team in the sender's country collects $100 and keeps $2.50;
//   - it owes the team in the recipient's country $97.50 (the $95 that team
//     pays the recipient, plus that team's own $2.50 fee share);
//   - the paying team pays the recipient $95 and keeps its $2.50.
// A team's debt to the other one starts once that other team has paid the
// recipient out (status sent or completed). Money collected but not yet paid
// out is shown as "holding", not owed. Teams then pay each other and record it
// as a settlement; only a settlement the receiving team has confirmed counts.
// Fee shares become "yours to keep" once the transfer is completed.
const LEDGER_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function feeShares(t) {
  const fee = Number(t.fee_usd) || 0;
  // Transfers made before fee splitting existed: the collector kept it all.
  const collector = t.fee_collector_usd != null ? Number(t.fee_collector_usd) : fee;
  const payer = t.fee_payer_usd != null ? Number(t.fee_payer_usd) : 0;
  const owner = t.fee_owner_usd != null ? Number(t.fee_owner_usd) : 0;
  return { fee, collector, payer, owner };
}

// What the collecting team owes the paying team for one transfer.
function transferObligation(t) {
  const s = feeShares(t);
  return round2((Number(t.amount_usd) || 0) - s.collector - s.owner);
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The date that decides whether a transfer is still on the "recent" list: when
// it was last changed (completion time for a finished one), else when it was
// created. A transfer with no date at all is treated as recent.
function transferDate(t) {
  return parseDate(t.last_updated_at) || parseDate(t.created_at);
}

// scope: 'US' | 'GH' | 'NG' for a regional team, 'ALL' for the owner.
// days: how many days of finished history to list (null = all of it). Money
// totals always use everything; only the lists are trimmed.
function buildLedgerV2({ transactions, settlements, scope, now = new Date(), days = LEDGER_WINDOW_DAYS }) {
  const cutoff = days ? new Date(now.getTime() - days * DAY_MS) : null;
  const isRecent = (d) => !cutoff || !d || d >= cutoff;

  const matrix = () => {
    const m = {};
    REGIONS.forEach((a) => { m[a] = {}; REGIONS.forEach((b) => { m[a][b] = 0; }); });
    return m;
  };
  const owed = matrix(); // owed[a][b]: money a owes b for transfers b has paid out
  const holding = matrix(); // holding[a][b]: collected by a, b has not paid out yet
  const paid = matrix(); // paid[a][b]: settlements a sent b that b confirmed
  const inflight = matrix(); // inflight[a][b]: settlements a sent b, not confirmed yet

  const earnings = {};
  REGIONS.forEach((r) => { earnings[r] = { keep_usd: 0, keep_recent_usd: 0, pending_usd: 0 }; });
  const owner = { keep_usd: 0, keep_recent_usd: 0, pending_usd: 0 };

  const visibleTo = (a, b) => scope === 'ALL' || a === scope || b === scope;

  const transferLines = [];
  const settlementLines = [];
  let hiddenTransfers = 0;
  let hiddenSettlements = 0;

  for (const t of transactions) {
    const origin = t.origin_country || 'US';
    const dest = t.recipient_country;
    if (!REGIONS.includes(origin) || !REGIONS.includes(dest) || origin === dest) continue;
    if (!['payment_received', 'sent', 'completed'].includes(t.status)) continue;

    const shares = feeShares(t);
    const obligation = transferObligation(t);
    const when = transferDate(t);

    if (t.status === 'payment_received') {
      holding[origin][dest] += obligation;
    } else {
      owed[origin][dest] += obligation;
    }

    if (t.status === 'completed') {
      earnings[origin].keep_usd += shares.collector;
      earnings[dest].keep_usd += shares.payer;
      owner.keep_usd += shares.owner;
      if (isRecent(when)) {
        earnings[origin].keep_recent_usd += shares.collector;
        earnings[dest].keep_recent_usd += shares.payer;
        owner.keep_recent_usd += shares.owner;
      }
    } else {
      earnings[origin].pending_usd += shares.collector;
      earnings[dest].pending_usd += shares.payer;
      owner.pending_usd += shares.owner;
    }

    if (visibleTo(origin, dest)) {
      if (t.status !== 'completed' || isRecent(when)) {
        transferLines.push({
          id: t.id,
          origin_country: origin,
          recipient_country: dest,
          status: t.status,
          amount_usd: round2(Number(t.amount_usd) || 0),
          fee_collector_usd: round2(shares.collector),
          fee_payer_usd: round2(shares.payer),
          fee_owner_usd: round2(shares.owner),
          obligation_usd: obligation,
          at: when ? when.toISOString() : null
        });
      } else {
        hiddenTransfers += 1;
      }
    }
  }

  for (const s of settlements) {
    if (!REGIONS.includes(s.from_region) || !REGIONS.includes(s.to_region) || s.from_region === s.to_region) continue;
    if (s.status === 'cancelled') continue;
    const amount = Number(s.amount_usd) || 0;
    if (s.status === 'confirmed') paid[s.from_region][s.to_region] += amount;
    else inflight[s.from_region][s.to_region] += amount;

    if (visibleTo(s.from_region, s.to_region)) {
      const when = parseDate(s.confirmed_at) || parseDate(s.created_at);
      if (s.status !== 'confirmed' || isRecent(when)) {
        settlementLines.push({
          id: s.id,
          from_region: s.from_region,
          to_region: s.to_region,
          amount_usd: round2(amount),
          reference: s.reference || '',
          status: s.status,
          created_by: s.created_by || null,
          confirmed_by: s.confirmed_by || null,
          created_at: s.created_at || null,
          confirmed_at: s.confirmed_at || null
        });
      } else {
        hiddenSettlements += 1;
      }
    }
  }

  const position = (a, b) => ({
    a,
    b,
    // Positive: a owes b. Negative: b owes a.
    net_usd: round2(owed[a][b] - owed[b][a] - paid[a][b] + paid[b][a]),
    a_owes_b_usd: round2(owed[a][b]),
    b_owes_a_usd: round2(owed[b][a]),
    a_paid_b_usd: round2(paid[a][b]),
    b_paid_a_usd: round2(paid[b][a]),
    a_holds_for_b_usd: round2(holding[a][b]),
    b_holds_for_a_usd: round2(holding[b][a]),
    a_unconfirmed_to_b_usd: round2(inflight[a][b]),
    b_unconfirmed_to_a_usd: round2(inflight[b][a])
  });

  const positions = [];
  if (scope === 'ALL') {
    for (let i = 0; i < REGIONS.length; i++) {
      for (let j = i + 1; j < REGIONS.length; j++) positions.push(position(REGIONS[i], REGIONS[j]));
    }
  } else {
    REGIONS.filter((r) => r !== scope).forEach((other) => positions.push(position(scope, other)));
  }

  const roundEarn = (e) => ({ keep_usd: round2(e.keep_usd), keep_recent_usd: round2(e.keep_recent_usd), pending_usd: round2(e.pending_usd) });
  const outEarnings = {};
  (scope === 'ALL' ? REGIONS : [scope]).forEach((r) => { outEarnings[r] = roundEarn(earnings[r]); });

  const byNewest = (x, y) => String(y.at || y.confirmed_at || y.created_at || '').localeCompare(String(x.at || x.confirmed_at || x.created_at || ''));
  transferLines.sort(byNewest);
  settlementLines.sort(byNewest);

  return {
    scope,
    window_days: days || null,
    fee: { percent: FEE_PERCENT, split: FEE_SPLIT },
    positions,
    earnings: outEarnings,
    owner: scope === 'ALL' ? roundEarn(owner) : undefined,
    transfers: transferLines,
    settlements: settlementLines,
    hidden: { transfers: hiddenTransfers, settlements: hiddenSettlements }
  };
}
// ---- end of money logic ----

// Looks up the real-world rate agents actually get for turning USDT into
// local cash: Binance's public P2P sell-ad listings first (this is the
// street-level rate, not the official bank rate), falling back to a
// standard published FX rate, and finally to a hardcoded number so the
// app never breaks outright if both sources are briefly unreachable.
async function fetchLiveRate(currencyCode) {
  if (currencyCode === 'USD') return 1; // USD is the middle step for every pair
  try {
    const p2pResponse = await axios.post(
      'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
      { page: 1, rows: 5, payTypes: [], countries: [], publisherType: null, asset: 'USDT', tradeType: 'SELL', fiat: currencyCode },
      { timeout: 6000 }
    );
    const ads = p2pResponse.data && p2pResponse.data.data ? p2pResponse.data.data : [];
    const prices = ads
      .map((a) => parseFloat(a.adv.price))
      .filter((p) => Number.isFinite(p) && p > 0)
      .sort((a, b) => a - b);
    if (prices.length > 0) {
      const median = prices[Math.floor(prices.length / 2)];
      if (isPlausibleRate(currencyCode, median)) return median;
    }
  } catch (err) {
    // fall through to the backup source
  }

  try {
    const fxResponse = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 6000 });
    const rate = fxResponse.data && fxResponse.data.rates ? fxResponse.data.rates[currencyCode] : null;
    if (rate && isPlausibleRate(currencyCode, rate)) return rate;
  } catch (err) {
    // fall through to the hardcoded fallback
  }

  return FALLBACK_RATES[currencyCode] || null;
}

// Verifies a staff bearer token and attaches req.admin. Fails closed:
// no token, an invalid token, or a valid Supabase account with no
// matching admin_profiles row are all rejected.
async function requireAdminAuth(req, res, next) {
  try {
    const authHeader = req.header('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Staff sign-in required.' });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData || !userData.user) {
      return res.status(401).json({ success: false, error: 'Staff session expired or invalid.' });
    }

    const profile = await loadAdminProfile(userData.user.id, userData.user.email);
    if (!profile) {
      return res.status(403).json({ success: false, error: 'This account is not an authorized staff account.' });
    }
    if (!profile.region) {
      return res.status(403).json({ success: false, error: 'This staff account has no region assigned yet. Run the multi-region SQL in Supabase.' });
    }

    req.admin = { id: userData.user.id, displayName: profile.displayName, region: profile.region };
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// Verifies a customer bearer token and attaches req.user. Used anywhere a
// request needs to be tied to a specific signed-in customer — reading their
// own history, or filing a transfer under their own name — so nobody can
// read or write another customer's data just by guessing their email.
async function requireUserAuth(req, res, next) {
  try {
    const authHeader = req.header('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, error: 'Sign-in required.' });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData || !userData.user) {
      return res.status(401).json({ success: false, error: 'Session expired or invalid. Please sign in again.' });
    }

    req.user = { id: userData.user.id, email: userData.user.email };
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

app.get('/api/rate', async (req, res) => {
  const country = req.query.country;
  const currency = COUNTRY_CURRENCY[country];
  if (!currency) {
    return res.status(400).json({ success: false, error: "country must be 'US', 'GH' or 'NG'." });
  }
  const rate = await fetchLiveRate(currency);
  res.json({ success: true, rate, currency });
});

app.post('/api/upload', upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const { data, error } = await supabase.storage
      .from('receipts')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype
      });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const { data: publicUrlData } = supabase.storage
      .from('receipts')
      .getPublicUrl(fileName);

    res.json({ success: true, url: publicUrlData.publicUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const cleanUsername = cleanHandle(username);

    if (RESERVED_ADMIN_HANDLES.includes(cleanUsername)) {
      return res.status(400).json({ success: false, error: 'That username is reserved and can\'t be used to create a customer account.' });
    }

    const email = `${cleanUsername}@app.local`;

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    // Sign the brand-new account straight in so the app can log them in
    // immediately, the same way /api/login does, with a real session token.
    const { data: signInData, error: signInError } = await signInWithPassword(email, password);
    if (signInError || !signInData.session) {
      return res.status(500).json({ success: false, error: 'Account created, but could not start a session. Please sign in.' });
    }

    res.json({
      success: true,
      user: { email, username: cleanUsername },
      token: signInData.session.access_token
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const cleanUsername = cleanHandle(username);
    const email = `${cleanUsername}@app.local`;

    const { data, error } = await signInWithPassword(email, password);

    if (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      user: { email, username: cleanUsername },
      token: data.session.access_token
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Staff sign-up: gated by an invite code only you hand out to trusted
// colleagues, so this endpoint can sit in the open without letting
// just anyone create a staff account for themselves.
app.post('/api/admin/register', async (req, res) => {
  try {
    if (!ADMIN_INVITE_CODE) {
      return res.status(500).json({ success: false, error: 'Staff sign-up is not configured (ADMIN_INVITE_CODE is missing).' });
    }

    const { username, password, inviteCode } = req.body;
    if (inviteCode !== ADMIN_INVITE_CODE) {
      return res.status(401).json({ success: false, error: 'Invalid invite code.' });
    }

    const cleanUsername = cleanHandle(username);
    if (!cleanUsername || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }
    const email = `${cleanUsername}@${ADMIN_EMAIL_DOMAIN}`;

    // A staff account has to belong to a region; take it from the request,
    // or from the username if it's one of the regional ones.
    const region = ADMIN_REGIONS.includes(req.body.region) ? req.body.region : REGION_BY_HANDLE[cleanUsername];
    if (!region) {
      return res.status(400).json({ success: false, error: `A region is required (${ADMIN_REGIONS.join(', ')}).` });
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    const { error: profileError } = await supabase
      .from('admin_profiles')
      .insert([{ id: data.user.id, display_name: cleanUsername, region }]);

    if (profileError) {
      // Don't leave a half-created staff account behind.
      await supabase.auth.admin.deleteUser(data.user.id);
      return res.status(500).json({ success: false, error: profileError.message });
    }

    res.json({ success: true, admin: { username: cleanUsername } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const cleanUsername = cleanHandle(username);
    const email = `${cleanUsername}@${ADMIN_EMAIL_DOMAIN}`;

    const { data, error } = await signInWithPassword(email, password);
    if (error) {
      return res.status(400).json({ success: false, error: 'Incorrect staff username or password.' });
    }

    const profile = await loadAdminProfile(data.user.id, email);
    if (!profile) {
      return res.status(403).json({ success: false, error: 'This account is not an authorized staff account.' });
    }
    if (!profile.region) {
      return res.status(403).json({ success: false, error: 'This staff account has no region assigned yet. Run the multi-region SQL in Supabase.' });
    }

    res.json({
      success: true,
      token: data.session.access_token,
      admin: { username: cleanUsername, displayName: profile.displayName, region: profile.region }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/transfer', requireUserAuth, async (req, res) => {
  try {
    const {
      senderName,
      paymentMethod,
      recipientCountry,
      recipientName,
      payoutMethod,
      mobileNetwork,
      mobileMoneyNumber,
      bankName,
      bankAccountNumber,
      recipientPhone,
      pickupLocation,
      payoutHandle,
      receiptUrl
    } = req.body;

    // Copies of the app installed before multi-region support only know about
    // US senders and send "amountUSD" with no origin country, so keep
    // accepting that shape.
    const originCountry = req.body.originCountry || 'US';
    const rawAmount = req.body.amountSend !== undefined ? req.body.amountSend : req.body.amountUSD;
    const amountSend = parseFloat(rawAmount);

    const senderEmail = req.user.email; // from the verified session, never from the request body
    const originCurrency = COUNTRY_CURRENCY[originCountry];
    const destCurrency = COUNTRY_CURRENCY[recipientCountry];

    if (!senderName || !paymentMethod || !originCurrency || !destCurrency || !recipientName || !payoutMethod) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }
    if (originCountry === recipientCountry) {
      return res.status(400).json({ success: false, error: 'Choose a different country to send to.' });
    }
    if (!Number.isFinite(amountSend) || amountSend <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount.' });
    }
    if (!(PAYIN_METHODS[originCountry] || []).includes(paymentMethod)) {
      return res.status(400).json({ success: false, error: 'That payment method is not available when sending from this country.' });
    }
    if (!(PAYOUT_METHODS_BY_COUNTRY[recipientCountry] || []).includes(payoutMethod)) {
      return res.status(400).json({ success: false, error: 'That payout method is not available in the destination country.' });
    }

    // Each payout method needs its own details.
    if (payoutMethod === 'mobile_money' && (!mobileNetwork || !mobileMoneyNumber)) {
      return res.status(400).json({ success: false, error: 'Mobile network and mobile money number are required.' });
    }
    if (payoutMethod === 'bank_transfer' && (!bankName || !bankAccountNumber)) {
      return res.status(400).json({ success: false, error: 'Bank name and account number are required.' });
    }
    let cleanPhone = null;
    let cleanPickupLocation = null;
    let pickupCode = null;
    if (payoutMethod === 'cash_pickup') {
      cleanPhone = (recipientPhone || '').trim().slice(0, 30);
      cleanPickupLocation = (pickupLocation || '').trim().slice(0, 120);
      if (!cleanPhone || !cleanPickupLocation) {
        return res.status(400).json({ success: false, error: 'Recipient phone number and pickup location are required for cash pickup.' });
      }
      pickupCode = String(randomInt(100000, 1000000));
    }
    let cleanHandleValue = null;
    if (HANDLE_PAYOUTS.includes(payoutMethod)) {
      cleanHandleValue = (payoutHandle || '').trim().slice(0, 200);
      if (!cleanHandleValue) {
        return res.status(400).json({ success: false, error: 'The recipient\'s payout details (email, ID or wallet address) are required.' });
      }
      if (USDT_PAYOUTS.includes(payoutMethod) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleanHandleValue)) {
        return res.status(400).json({ success: false, error: 'That does not look like a valid Solana address.' });
      }
    }

    // The server works out the fee, rates and payout itself rather than
    // trusting whatever numbers the client sent, so nobody can POST straight
    // to this endpoint and name their own rate or payout.
    const [originRate, destRate] = await Promise.all([fetchLiveRate(originCurrency), fetchLiveRate(destCurrency)]);
    if (!originRate || !destRate) {
      return res.status(503).json({ success: false, error: 'Exchange rates are unavailable right now. Please try again in a minute.' });
    }
    const t = computeTransfer({ amountSend, originRate, destRate });

    // Limits are in USD, applied to the dollar value of whatever was sent.
    if (t.amountUSD < MIN_TRANSFER_USD || t.amountUSD > MAX_TRANSFER_USD) {
      return res.status(400).json({ success: false, error: `Transfers must be between $${MIN_TRANSFER_USD} and $${MAX_TRANSFER_USD}.` });
    }
    if (payoutMethod === 'cash_pickup' && t.amountUSD > CASH_PICKUP_MAX_USD) {
      return res.status(400).json({ success: false, error: `Cash pickup is limited to $${CASH_PICKUP_MAX_USD} per transfer.` });
    }

    const { data, error } = await supabase
      .from('transactions')
      .insert([
        {
          sender_name: String(senderName).trim().slice(0, 120),
          sender_email: senderEmail,
          amount_usd: t.amountUSD,
          fee_usd: t.feeUSD,
          exchange_rate: destRate,
          local_currency: destCurrency,
          amount_local: t.amountLocal,
          origin_country: originCountry,
          send_currency: originCurrency,
          amount_send: round2(amountSend),
          fee_send: t.feeSend,
          origin_rate: originRate,
          fee_collector_usd: t.feeSplit.collector,
          fee_payer_usd: t.feeSplit.payer,
          fee_owner_usd: t.feeSplit.owner,
          payment_method: paymentMethod,
          recipient_country: recipientCountry,
          recipient_name: String(recipientName).trim().slice(0, 120),
          payout_method: payoutMethod,
          mobile_network: payoutMethod === 'mobile_money' ? mobileNetwork : null,
          mobile_money_number: payoutMethod === 'mobile_money' ? mobileMoneyNumber : null,
          bank_name: payoutMethod === 'bank_transfer' ? bankName : null,
          bank_account_number: payoutMethod === 'bank_transfer' ? bankAccountNumber : null,
          recipient_phone: cleanPhone,
          pickup_location: cleanPickupLocation,
          pickup_code: pickupCode,
          payout_handle: cleanHandleValue,
          receipt_url: receiptUrl ? receiptUrl : null,
          status: 'pending'
        }
      ])
      .select();

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// A user's own app calls this to see only their own transactions. Scoped
// by the email on their verified session token, never a client-supplied
// value, so nobody can read another customer's transfer history — including
// their bank/mobile money details — just by knowing or guessing an email.
app.get('/api/transactions/mine', requireUserAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('sender_email', req.user.email)
      .order('id', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, transactions: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Support inbox, customer side. A customer sends a message; it's tied to the
// email on their verified session, never one they type in. They can only
// ever list their own messages.
app.post('/api/support', requireUserAuth, async (req, res) => {
  try {
    const message = (req.body.message || '').trim();
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required.' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, error: 'Message is too long (2000 characters max).' });
    }

    const { data, error } = await supabase
      .from('support_messages')
      .insert([{ sender_email: req.user.email, message, status: 'open' }])
      .select();

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, data: data[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/support/mine', requireUserAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('sender_email', req.user.email)
      .order('id', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, messages: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Everything below here requires a signed-in staff account.

// Support inbox, staff side: see every message, and resolve one with an
// optional reply that the customer sees next to their original message.
app.get('/api/admin/support', requireAdminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('support_messages')
      .select('*')
      .order('id', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, messages: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/admin/support/:id/resolve', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const reply = (req.body.reply || '').trim();

    const update = {
      status: 'resolved',
      resolved_by: req.admin.displayName,
      resolved_at: new Date().toISOString()
    };
    if (reply) {
      update.staff_reply = reply;
    }

    const { data, error } = await supabase
      .from('support_messages')
      .update(update)
      .eq('id', id)
      .select();

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found.' });
    }
    res.json({ success: true, data: data[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Staff see only the transfers their own region is part of: ones it collected
// the money for, and ones it pays out. The owner account ('ALL') sees every
// region, read-only. Nobody is ever shown a cash pickup code.
app.get('/api/admin/transactions', requireAdminAuth, async (req, res) => {
  try {
    let query = supabase
      .from('transactions')
      .select('*')
      .order('id', { ascending: false });

    if (req.admin.region !== 'ALL') {
      const r = req.admin.region; // always one of REGIONS, never user input
      query = query.or(`origin_country.eq.${r},recipient_country.eq.${r}`);
    }

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, transactions: data.map(stripPickupCode) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Moves a transaction to its next state and records which staff member did
// it. Each side has its own job:
//   - the region the sender is in confirms the money arrived (payment_received)
//   - the region the recipient is in pays out (sent — needs a payout
//     reference, and the pickup code for cash) and closes it (completed)
//   - either side can reject, but only until the payout has gone out
// Staff from a region that isn't part of the transfer can't touch it at all.
app.patch('/api/admin/transactions/:id/status', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payoutReference, pickupCode } = req.body;
    const region = req.admin.region;

    if (!TRANSACTION_STATUSES.includes(status) || status === 'pending') {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${TRANSACTION_STATUSES.filter((s) => s !== 'pending').join(', ')}`
      });
    }
    if (region === 'ALL') {
      return res.status(403).json({ success: false, error: 'The owner view is read-only. Sign in with a regional staff account to make changes.' });
    }
    if (status === 'sent' && !payoutReference) {
      return res.status(400).json({ success: false, error: 'A payout reference is required to mark a transfer as sent.' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('transactions')
      .select('origin_country, recipient_country, payout_method, pickup_code, status')
      .eq('id', id)
      .maybeSingle();
    if (existingError) {
      return res.status(500).json({ success: false, error: existingError.message });
    }
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }

    const origin = existing.origin_country || 'US';
    const dest = existing.recipient_country;
    if (region !== origin && region !== dest) {
      return res.status(403).json({ success: false, error: 'This transfer belongs to other regions.' });
    }

    if (status === 'payment_received') {
      if (existing.status !== 'pending') {
        return res.status(400).json({ success: false, error: 'Only a pending transfer can be marked payment received.' });
      }
      if (region !== origin) {
        return res.status(403).json({ success: false, error: "Only the team in the sender's country can confirm the payment arrived." });
      }
    } else if (status === 'sent') {
      if (existing.status !== 'payment_received') {
        return res.status(400).json({ success: false, error: 'The sender\'s team has to confirm the payment arrived first.' });
      }
      if (region !== dest) {
        return res.status(403).json({ success: false, error: "Only the team in the recipient's country can pay it out." });
      }
      // Cash pickup: the code the recipient reads out must match the one the
      // server made, so cash can't be handed to the wrong person.
      if (existing.payout_method === 'cash_pickup') {
        if (!pickupCode || String(pickupCode).trim() !== existing.pickup_code) {
          return res.status(400).json({ success: false, error: 'The pickup code does not match. Do not hand over any cash.' });
        }
      }
    } else if (status === 'completed') {
      if (existing.status !== 'sent') {
        return res.status(400).json({ success: false, error: 'Mark the transfer as sent before completing it.' });
      }
      if (region !== dest) {
        return res.status(403).json({ success: false, error: "Only the team in the recipient's country can complete it." });
      }
    } else if (status === 'rejected') {
      if (existing.status !== 'pending' && existing.status !== 'payment_received') {
        return res.status(400).json({ success: false, error: "A transfer can't be rejected once it has been paid out." });
      }
    }

    const update = {
      status,
      last_updated_by: req.admin.displayName,
      last_updated_at: new Date().toISOString()
    };
    if (payoutReference) {
      update.payout_reference = payoutReference;
    }

    const { data, error } = await supabase
      .from('transactions')
      .update(update)
      .eq('id', id)
      .select();

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Transaction not found.' });
    }

    res.json({ success: true, data: stripPickupCode(data[0]) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reads a whole table a page at a time (the database returns at most 1000
// rows per request).
async function fetchAllRows(table, orderColumn) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

// The settlement ledger (see buildLedgerV2). A regional account gets its own
// region's view only; the owner account gets every region, read-only.
// ?days=all lists the whole history instead of the last 30 days. Nothing is
// ever deleted: older entries are only left out of the lists.
app.get('/api/admin/ledger', requireAdminAuth, async (req, res) => {
  try {
    const transactions = (await fetchAllRows('transactions', 'id')).map(stripPickupCode);
    let settlements = [];
    try {
      settlements = await fetchAllRows('settlements', 'created_at');
    } catch (err) {
      // The settlements table comes from migration_ledger_v2.sql. Until it has
      // been run, the ledger still works, it just has no payments recorded.
      console.warn('Could not read settlements:', err.message);
    }

    const scope = req.admin.region;
    const days = req.query.days === 'all' ? null : LEDGER_WINDOW_DAYS;
    const ledger = buildLedgerV2({ transactions, settlements, scope, days });

    // Older copies of the app (not yet updated) read these two fields.
    const legacy = buildLedger(transactions);
    const regions = scope === 'ALL' ? legacy.regions : { [scope]: legacy.regions[scope] };
    res.json({ success: true, ...ledger, regions, owner_fee_usd: scope === 'ALL' ? legacy.owner_fee_usd : undefined });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// A team records that it has sent money to another team to settle up. It only
// counts once the receiving team confirms it arrived.
app.post('/api/admin/settlements', requireAdminAuth, async (req, res) => {
  try {
    const region = req.admin.region;
    if (region === 'ALL') {
      return res.status(403).json({ success: false, error: 'The owner view is read-only. Sign in with a regional staff account to record a payment.' });
    }
    const { toRegion, amountUSD, reference } = req.body;
    if (!REGIONS.includes(toRegion) || toRegion === region) {
      return res.status(400).json({ success: false, error: 'Choose another team to send the payment to.' });
    }
    const amount = round2(parseFloat(amountUSD));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      return res.status(400).json({ success: false, error: 'Enter the amount you sent, in US dollars.' });
    }
    const cleanReference = String(reference || '').trim().slice(0, 200);
    if (!cleanReference) {
      return res.status(400).json({ success: false, error: 'A reference is required (for example the transaction ID of the payment).' });
    }

    const { data, error } = await supabase
      .from('settlements')
      .insert([{ from_region: region, to_region: toRegion, amount_usd: amount, reference: cleanReference, status: 'sent', created_by: req.admin.displayName }])
      .select();
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, data: data[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// The receiving team confirms the money arrived, or the sending team cancels a
// payment it recorded by mistake (only while it is still unconfirmed).
app.patch('/api/admin/settlements/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    const region = req.admin.region;

    if (region === 'ALL') {
      return res.status(403).json({ success: false, error: 'The owner view is read-only.' });
    }
    if (!['confirm', 'cancel'].includes(action)) {
      return res.status(400).json({ success: false, error: "Action must be 'confirm' or 'cancel'." });
    }
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) {
      return res.status(404).json({ success: false, error: 'Payment not found.' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('settlements')
      .select('from_region, to_region, status')
      .eq('id', id)
      .maybeSingle();
    if (existingError) {
      return res.status(500).json({ success: false, error: existingError.message });
    }
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Payment not found.' });
    }
    if (existing.status !== 'sent') {
      return res.status(400).json({ success: false, error: `That payment was already ${existing.status}.` });
    }

    let update;
    if (action === 'confirm') {
      if (region !== existing.to_region) {
        return res.status(403).json({ success: false, error: 'Only the team that was paid can confirm it arrived.' });
      }
      update = { status: 'confirmed', confirmed_by: req.admin.displayName, confirmed_at: new Date().toISOString() };
    } else {
      if (region !== existing.from_region) {
        return res.status(403).json({ success: false, error: 'Only the team that recorded the payment can cancel it.' });
      }
      update = { status: 'cancelled' };
    }

    // The status check in the update itself stops two staff members from
    // changing the same payment at the same moment.
    const { data, error } = await supabase
      .from('settlements')
      .update(update)
      .eq('id', id)
      .eq('status', 'sent')
      .select();
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    if (!data || data.length === 0) {
      return res.status(409).json({ success: false, error: 'That payment was just updated by someone else. Refresh and check.' });
    }
    res.json({ success: true, data: data[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT ? process.env.PORT : 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
