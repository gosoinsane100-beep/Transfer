import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import multer from 'multer';

dotenv.config();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Secret');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

const SUPABASE_URL = process.env.SUPABASE_URL ? process.env.SUPABASE_URL : 'https://hsnaqddekfddbpamajpw.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const FEE_PERCENT = 0.05; // 5% platform fee — keep this in sync with the frontend's translated label
const FALLBACK_RATE = 8920;

// A transaction's lifecycle. Users can only ever create one in 'pending' —
// every later state is set by whoever is fulfilling the transfer (that's
// you, manually, for now).
const TRANSACTION_STATUSES = ['pending', 'payment_received', 'sent', 'completed', 'rejected'];

// Protects the admin routes with a shared secret, sent as the
// X-Admin-Secret header. This is deliberately simple (not a full login
// system) but it closes the hole that used to let anyone — including
// every user's own copy of the app — read every other user's name,
// email, and Bankak account number with no credentials at all.
function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) {
    // Fails closed: with no secret configured, admin routes refuse to
    // serve anything rather than silently staying wide open.
    return res.status(500).json({ success: false, error: 'Admin routes are not configured (ADMIN_SECRET is missing).' });
  }
  const provided = req.header('x-admin-secret');
  if (provided !== ADMIN_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

async function fetchLiveRate() {
  try {
    const response = await axios.get('https://www.alsoug.com/currency/usd', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ar,en;q=0.9'
      },
      timeout: 6000
    });
    const $ = cheerio.load(response.data);
    let scrapedRate = null;

    $('input').each((_, el) => {
      const val = $(el).val() ? $(el).val() : $(el).attr('value');
      if (val) {
        const num = parseFloat(val.replace(/,/g, ''));
        if (num >= 5000 && num <= 20000) {
          scrapedRate = num;
        }
      }
    });

    return scrapedRate ? scrapedRate : FALLBACK_RATE;
  } catch (err) {
    return FALLBACK_RATE;
  }
}

app.get('/api/rate', async (req, res) => {
  const rate = await fetchLiveRate();
  res.json({ success: true, rate });
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
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
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
    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
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

app.post('/api/transfer', async (req, res) => {
  try {
    const {
      senderName,
      senderEmail,
      amountUSD,
      paymentMethod,
      bankakAccountNumber,
      bankakAccountName,
      receiptUrl
    } = req.body;

    const parsedAmountUSD = parseFloat(amountUSD);

    if (!senderName || !senderEmail || !paymentMethod || !bankakAccountNumber || !bankakAccountName) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }
    if (!Number.isFinite(parsedAmountUSD) || parsedAmountUSD <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid amount.' });
    }

    // The server recomputes the fee, rate, and payout amount itself rather
    // than trusting whatever numbers the client sent. Without this, anyone
    // could POST straight to this endpoint (skipping the app entirely) and
    // name their own exchange rate or payout amount. It also means any
    // future automation is built on numbers the backend actually trusts,
    // not just whatever happened to be on screen when the user tapped submit.
    const exchangeRate = await fetchLiveRate();
    const feeUSD = Math.round(parsedAmountUSD * FEE_PERCENT * 100) / 100;
    const netUSD = parsedAmountUSD - feeUSD;
    const amountSDG = Math.round(netUSD * exchangeRate * 100) / 100;

    const { data, error } = await supabase
      .from('transactions')
      .insert([
        {
          sender_name: senderName,
          sender_email: senderEmail,
          amount_usd: parsedAmountUSD,
          fee_usd: feeUSD,
          exchange_rate: exchangeRate,
          amount_sdg: amountSDG,
          payment_method: paymentMethod,
          bankak_account_number: bankakAccountNumber,
          bankak_account_name: bankakAccountName,
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

// A user's own app calls this to see only their own transactions — it
// takes the email they're signed in as and returns just those rows, never
// anyone else's. No admin secret needed for this one; it's scoped by
// email instead.
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

// Everything below here requires the X-Admin-Secret header — this is
// your side of the operation, not anything the app's users can reach.

app.get('/api/admin/transactions', requireAdmin, async (req, res) => {
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

// Moves a transaction to its next state: payment_received once you've
// confirmed their USD actually landed, sent once you've sent the SDG via
// Bankak, completed once that's confirmed on the recipient's end, or
// rejected if something was wrong with the request.
app.patch('/api/admin/transactions/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!TRANSACTION_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${TRANSACTION_STATUSES.join(', ')}`
      });
    }

    const { data, error } = await supabase
      .from('transactions')
      .update({ status })
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
