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
    const email = `${cleanUsername}@app.local`;

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    res.json({ success: true, user: { email, username: cleanUsername } });
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

    res.json({ success: true, user: { email, username: cleanUsername } });
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

app.post('/api/transfer', async (req, res) => {
  try {
    const {
      senderName,
      senderEmail,
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

    const parsedAmountUSD = parseFloat(amountUSD);
    const currency = COUNTRY_CURRENCY[recipientCountry];

    if (!senderName || !senderEmail || !paymentMethod || !currency || !recipientName || !payoutMethod) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }
    if (!Number.isFinite(parsedAmountUSD) || parsedAmountUSD <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount.' });
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

// A user's own app calls this to see only their own transactions — scoped
// by email, no staff credentials needed, and it never returns anyone else's.
app.get('/api/transactions/mine', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, error: 'email query parameter is required.' });
    }

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('sender_email', email)
      .order('id', { ascending: false });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, transactions: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Everything below here requires a signed-in staff account.

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
