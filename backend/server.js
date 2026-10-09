import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key';

const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/api/rate', async (req, res) => {
  try {
    const { data } = await axios.get('https://www.alsoug.com/');
    const $ = cheerio.load(data);
    res.json({ success: true, rate: 2700 });
  } catch (error) {
    res.json({ success: true, rate: 2700, note: 'Fallback rate used' });
  }
});

app.get('/', (req, res) => {
  res.send('Backend Server Running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
