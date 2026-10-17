import express from 'express';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import multer from 'multer';

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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const FEE_PERCENT = 0.05; // 5% platform fee — keep in sync with the frontend's displayed label
const MIN_TRANSFER_USD = 10; // keep in sync with the frontend's MIN_TRANSFER_USD
const MAX_TRANSFER_USD = 500; // per transfer; keep in sync with the frontend's MAX_TRANSFER_USD
const COUNTRY_CURRENCY = { GH: 'GHS', NG: 'NGN' };
const FALLBACK_RATES = { GHS: 15.5, NGN: 1650 }; // emergency-only fallback if both live sources fail

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
const RESERVED_ADMIN_HANDLES = ['admin-ghana', 'admin-usa', 'admin-nigeria'].map(cleanHandle);

// Looks up the real-world rate agents actually get for turning USDT into
// local cash: Binance's public P2P sell-ad listings first (this is the
// street-level rate, not the official bank rate), falling back to a
// standard published FX rate, and finally to a hardcoded number so the
// app never breaks outright if both sources are briefly unreachable.
async function fetchLiveRate(currencyCode) {
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
      return prices[Math.floor(prices.length / 2)];
    }
  } catch (err) {
    // fall through to the backup source
  }

  try {
    const fxResponse = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 6000 });
    const rate = fxResponse.data && fxResponse.data.rates ? fxResponse.data.rates[currencyCode] : null;
    if (rate) return rate;
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

    const { data: profile, error: profileError } = await supabase
      .from('admin_profiles')
      .select('display_name')
      .eq('id', userData.user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({ success: false, error: 'This account is not an authorized staff account.' });
    }

    req.admin = { id: userData.user.id, displayName: profile.display_name };
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
    return res.status(400).json({ success: false, error: "country must be 'GH' or 'NG'." });
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
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
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

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

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
      .insert([{ id: data.user.id, display_name: cleanUsername }]);

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

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return res.status(400).json({ success: false, error: 'Incorrect staff username or password.' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('admin_profiles')
      .select('display_name')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({ success: false, error: 'This account is not an authorized staff account.' });
    }

    res.json({
      success: true,
      token: data.session.access_token,
      admin: { username: cleanUsername, displayName: profile.display_name }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/transfer', requireUserAuth, async (req, res) => {
  try {
    const {
      senderName,
      amountUSD,
      paymentMethod,
      recipientCountry,
      recipientName,
      payoutMethod,
      mobileNetwork,
      mobileMoneyNumber,
      bankName,
      bankAccountNumber,
      receiptUrl
    } = req.body;

    const senderEmail = req.user.email; // from the verified session, never from the request body
    const parsedAmountUSD = parseFloat(amountUSD);
    const currency = COUNTRY_CURRENCY[recipientCountry];

    if (!senderName || !paymentMethod || !currency || !recipientName || !payoutMethod) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }
    if (!Number.isFinite(parsedAmountUSD) || parsedAmountUSD <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount.' });
    }
    if (parsedAmountUSD < MIN_TRANSFER_USD || parsedAmountUSD > MAX_TRANSFER_USD) {
      return res.status(400).json({ success: false, error: `Transfers must be between $${MIN_TRANSFER_USD} and $${MAX_TRANSFER_USD}.` });
    }
    if (payoutMethod === 'mobile_money' && (!mobileNetwork || !mobileMoneyNumber)) {
      return res.status(400).json({ success: false, error: 'Mobile network and mobile money number are required.' });
    }
    if (payoutMethod === 'bank_transfer' && (!bankName || !bankAccountNumber)) {
      return res.status(400).json({ success: false, error: 'Bank name and account number are required.' });
    }

    // The server recomputes the fee, rate, and payout amount itself rather
    // than trusting whatever numbers the client sent, so nobody can POST
    // straight to this endpoint and name their own rate or payout.
    const exchangeRate = await fetchLiveRate(currency);
    const feeUSD = Math.round(parsedAmountUSD * FEE_PERCENT * 100) / 100;
    const netUSD = parsedAmountUSD - feeUSD;
    const amountLocal = exchangeRate ? Math.round(netUSD * exchangeRate * 100) / 100 : null;

    const { data, error } = await supabase
      .from('transactions')
      .insert([
        {
          sender_name: senderName,
          sender_email: senderEmail,
          amount_usd: parsedAmountUSD,
          fee_usd: feeUSD,
          exchange_rate: exchangeRate,
          local_currency: currency,
          amount_local: amountLocal,
          payment_method: paymentMethod,
          recipient_country: recipientCountry,
          recipient_name: recipientName,
          payout_method: payoutMethod,
          mobile_network: payoutMethod === 'mobile_money' ? mobileNetwork : null,
          mobile_money_number: payoutMethod === 'mobile_money' ? mobileMoneyNumber : null,
          bank_name: payoutMethod === 'bank_transfer' ? bankName : null,
          bank_account_number: payoutMethod === 'bank_transfer' ? bankAccountNumber : null,
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

app.get('/api/admin/transactions', requireAdminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('id', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, transactions: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Moves a transaction to its next state, and records which staff member
// did it: payment_received once the USD/USDT has actually landed, sent
// once the local payout has gone out (a payout reference is required at
// this step), completed once the recipient has confirmed, or rejected.
app.patch('/api/admin/transactions/:id/status', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payoutReference } = req.body;

    if (!TRANSACTION_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${TRANSACTION_STATUSES.join(', ')}`
      });
    }
    if (status === 'sent' && !payoutReference) {
      return res.status(400).json({ success: false, error: 'A payout reference is required to mark a transfer as sent.' });
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

    res.json({ success: true, data: data[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT ? process.env.PORT : 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
