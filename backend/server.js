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
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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

app.get('/api/rate', async (req, res) => {
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
      const val = $(el).val() ? $(el).val() :$(el).attr('value');
      if (val) {
        const num = parseFloat(val.replace(/,/g, ''));
        if (num >= 5000 && num <= 20000) {
          scrapedRate = num;
        }
      }
    });

    res.json({ success: true, rate: scrapedRate ? scrapedRate : 8920 });
  } catch (err) {
    res.json({ success: true, rate: 8920 });
  }
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
      feeUSD,
      exchangeRate,
      amountSDG,
      paymentMethod,
      bankakAccountNumber,
      bankakAccountName,
      receiptUrl
    } = req.body;

    const { data, error } = await supabase
      .from('transactions')
      .insert([
        {
          sender_name: senderName,
          sender_email: senderEmail,
          amount_usd: amountUSD,
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

app.get('/api/admin/transactions', async (req, res) => {
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

const PORT = process.env.PORT ? process.env.PORT : 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
