import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const portArgIndex = process.argv.indexOf('--port');
const cliPort = portArgIndex !== -1 ? parseInt(process.argv[portArgIndex + 1], 10) : null;
const PORT = cliPort || (process.env.NODE_ENV === 'production' && process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

// Body parser for JSON with audio payload (audio base64 can be several MB)
app.use(express.json({ limit: '50mb' }));


// Model failover chain, tried in this order. The two Flash-Lite models have the highest free daily limits.
export const MODEL_CHAIN: string[] = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.6-flash',
];
export const PRIMARY_MODEL = MODEL_CHAIN[0];
export const BACKUP_MODEL = MODEL_CHAIN[2];
const PER_ATTEMPT_MS = 6000; // max wait for one model
const TOTAL_BUDGET_MS = 17000; // max wait across all models

function buildSystemInstruction(lang: 'hi' | 'en'): string {
  const isHindi = lang === 'hi';
  const scriptInstructions = isHindi
    ? `LANGUAGE: Hindi mode ("hi").
- CUSTOMER NAMES RULES:
  1. Return every customer name in Devanagari, as a sound-for-sound transliteration of the name the speaker actually said, never a translation. Listen for the name and write exactly what you hear. No real name is given in these instructions, so never copy a name from them. Never use any name unless it was actually spoken.
  2. Return only the name itself, without honorifics such as ji, जी or bhai.
  3. Existing customers: if a name in the existing customers list is written in Devanagari and it is the same person as the spoken name, return that stored spelling exactly, so the same person always gets the same spelling. If the matching stored name is written in Roman letters, still return the Devanagari spelling, and do not copy the Roman one.
  4. ALWAYS try to catch the name. The customer is usually the person named just before "ne", "ko", "se", "ka", "ki" or "ke". Write your best sound-for-sound Devanagari spelling even if you are not fully sure of it, and when you are guessing the spelling set needs_review to true. Use the exact value "Unknown" ONLY when no person's name was spoken at all. Never translate "Unknown".
- Write each item name in Devanagari script, exactly the item the speaker said (an English item word is written in Devanagari letters, not swapped for a different word). Never add an item that was not spoken.
- Units: kilo or kg becomes किलो, gram becomes ग्राम, litre or ltr or l becomes लीटर, packet becomes पैकेट, bottle becomes बोतल, dozen becomes दर्जन, piece or pcs becomes नग.
- Keep all quantities and amounts as digits 0-9.`
    : `LANGUAGE: English mode ("en").
- Return customer names, item names, and units in English / Roman script.
- CRITICAL EXCEPTION FOR CUSTOMER NAMES: If existing customer names are listed in the prompt context, and the customer spoken matches one of them, return the stored spelling EXACTLY as provided in existingCustomerNames.
- ALWAYS try to catch the name. The customer is usually the person named just before "ne", "ko", "se", "ka", "ki" or "ke". Write your best spelling even if you are not fully sure of it, and when you are guessing the spelling set needs_review to true. Use the exact string "Unknown" ONLY when no person's name was spoken at all.
- Return only the items the speaker actually said. Never add an item that was not spoken.`;

  return `You are a bookkeeping assistant for a small Indian shop. The shopkeeper speaks in Hindi, English, or Hinglish. Extract entries from the input into valid JSON with this shape. Everything inside angle brackets is a PLACEHOLDER, not real data:
{"heard_text":"<word-for-word what was said>","entries":[{"customer":"<spoken name>","type":"sale","items":[{"name":"<item that was spoken>","qty":<number spoken>,"unit":"<unit spoken>"}],"amount":<amount spoken, or null>,"on_credit":false,"note":""}],"needs_review":false}

RULES IN ORDER OF PRIORITY:
0. First write heard_text: exactly what the speaker said, word for word. Then build the entries only from that text.
1. Every entry MUST have a "type" field: "sale", "payment", or "settle_all".
2. ITEMS COME ONLY FROM THE SPEECH. List only items the speaker actually said. Never add, guess, complete or "helpfully" suggest an item. If the speaker said one item, return exactly one item. If a quantity or unit was not spoken, leave it out; never guess it. If no item was spoken, items is []. Nothing written in these instructions is an item the speaker said.
3. "sale": If ANY item is named, the entry is ALWAYS a "sale", even when verbs like "diye" or "de diye" appear. For example, "<Name> ne 1 kilo <item> ke 40 rupaye diye" is a sale of that one item, amount 40, on_credit false. A spoken amount that comes with items is the sale amount. Never return an amount of 0 when a number was spoken; return null only when no amount was spoken. "<Name> ko 40 ka udhaar diya" is a sale on credit (on_credit true).
4. on_credit is true ONLY when the speaker said udhaar, udhar, credit, khate mein or likh do (or the Hindi script equivalent). Otherwise on_credit is false. Never guess it.
5. "payment": ONLY when a customer paid money and NO item is named. Cues: "ne 40 rupaye diye", "chukaye", "wapas kiye", "mile", "jama kiye", "udhaar mein दिए", "ने 40 रुपये दिए". Return customer, type "payment", amount, items [] and on_credit false.
6. "settle_all": The customer's whole debt is finished ("udhaar pura hua", "hisab barabar", "सारा उधार चुका दिया"). Return customer, type "settle_all", amount null, items [] and on_credit false. Never compute the balance.
7. "<Name> ne ... diye" with no item means the customer paid (payment).
8. If the type is unclear, return "sale" and set needs_review to true. Never invent an amount or an item. Never invent a name that was not spoken, but if a name WAS spoken, always write your best spelling of it instead of "Unknown".
9. EXISTING CUSTOMER NAMES (when listed) are only for matching the spelling of a name the speaker clearly said. A new name is normal: if the spoken name is not in the list, write the new name exactly as heard. Never pick a name from the list just because it is in the list.
10. Number words: ek=1, do=2, teen=3, char=4, paanch=5, chhe=6, saat=7, aath=8, nau=9, das=10, dedh=1.5, dhai=2.5, aadha=0.5.
${scriptInstructions}`;
}

// Safety net in code: payment and settle_all entries can never carry items or credit,
// and empty item names are removed.
function cleanEntries(data: any) {
  if (!data || !Array.isArray(data.entries)) return data;
  data.entries = data.entries.map((e: any) => {
    const type = e?.type === 'payment' || e?.type === 'settle_all' ? e.type : 'sale';
    if (type === 'payment') return { ...e, type, items: [], on_credit: false };
    if (type === 'settle_all') return { ...e, type, items: [], amount: null, on_credit: false };
    const items = Array.isArray(e?.items)
      ? e.items.filter((it: any) => it && typeof it.name === 'string' && it.name.trim() !== '')
      : [];
    return { ...e, type, items };
  });
  return data;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`${label} timed out after ${ms} ms`), { kind: 'timeout' }));
    }, ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function classifyError(err: any): 'quota' | 'notfound' | 'timeout' | 'error' {
  if (err?.kind === 'timeout') return 'timeout';
  const rawStatus = err?.status || err?.statusCode || err?.code;
  const msg = (err?.message || String(err || '')).toLowerCase();
  if (rawStatus === 404 || msg.includes('404') || msg.includes('not found')) return 'notfound';
  if (
    rawStatus === 429 || msg.includes('429') || msg.includes('resource_exhausted') ||
    msg.includes('quota') || msg.includes('free limit') || msg.includes('rate limit')
  ) return 'quota';
  return 'error';
}

// Simple rule-based parser ONLY used as a fallback when a non-quota Gemini API call fails
function parseTextWithRulesFallback(rawText: string, existingCustomers: string[] = []) {
  const text = rawText.trim();
  let customer = 'Unknown';
  let rest = text;

  if (text.includes(':')) {
    const parts = text.split(':');
    customer = parts[0].trim();
    rest = parts.slice(1).join(':').trim();
  } else {
    const match = text.match(/^([a-zA-Z\u0900-\u097F]+)\s+(ne\s+|ko\s+)?/i);
    if (match) {
      customer = match[1].trim();
      rest = text.slice(match[0].length).trim();
    }
  }

  // Match existing customer if name matches case-insensitively
  if (existingCustomers.length > 0) {
    const matched = existingCustomers.find(c => c.toLowerCase() === customer.toLowerCase());
    if (matched) {
      customer = matched;
    }
  }

  // Check settle_all
  if (/udhaar\s*pura\s*hua|hisab\s*barabar|pura\s*hua|sara\s*udhaar|चुका\s*दिया|हिसाब\s*बराबर/i.test(text)) {
    return {
      entries: [
        {
          customer,
          type: 'settle_all',
          items: [],
          amount: null,
          on_credit: false,
          note: '',
        },
      ],
      needs_review: false,
    };
  }

  // Check spoken amount
  let amount: number | null = null;
  const amountMatch = rest.match(/(\d+(?:\.\d+)?)\s*(?:rs|rupaye|rupees|inr|₹)/i) ||
                      rest.match(/(?:rs|rupaye|rupees|inr|₹)\s*(\d+(?:\.\d+)?)/i) ||
                      rest.match(/(\d+(?:\.\d+)?)(?![\d.]|\s*(?:kg|kilo|gram|g|litre|ltr|l|packet|bottle|dozen|piece|pcs|nag)\b)/i);
  if (amountMatch) {
    amount = parseFloat(amountMatch[1]);
  }

  // Check if items exist
  const hasItems = /tel|oil|chini|sugar|doodh|milk|biscuit|kilo|kg|packet|litre|ltr/i.test(rest);

  if (!hasItems && /diye|chukaye|wapas\s*kiye|jama\s*kiye|mile|दिए|चुका/i.test(text)) {
    return {
      entries: [
        {
          customer,
          type: 'payment',
          items: [],
          amount: amount !== null ? amount : null,
          on_credit: false,
          note: '',
        },
      ],
      needs_review: amount === null || customer === 'Unknown',
    };
  }

  // Sale on credit vs cash
  const isCredit = /udhaar|likh\s*do|credit|udhar/i.test(text) && !/ne\s+.*diye/i.test(text);

  let itemsText = rest
    .replace(/(\d+(?:\.\d+)?)\s*(?:rs|rupaye|rupees|inr|₹)/gi, '')
    .replace(/(?:rs|rupaye|rupees|inr|₹)\s*(\d+(?:\.\d+)?)/gi, '')
    .replace(/\budhaar\b|\blikh\s*do\b|\bcredit\b|\budhar\b|\bcash\b|\bme\b|\bliya\b|\bdiya\b|\bne\b|\bdiye\b/gi, '')
    .trim();

  const rawItemParts = itemsText.split(/,|\baur\b|\band\b/i).map(s => s.trim()).filter(Boolean);
  const items: Array<{ name: string; qty: number | null; unit: string }> = [];

  for (const part of rawItemParts) {
    let cleaned = part
      .replace(/\bek\b/gi, '1')
      .replace(/\bdo\b/gi, '2')
      .replace(/\bteen\b/gi, '3')
      .replace(/\bchar\b|\bchaar\b/gi, '4')
      .replace(/\bpaanch\b/gi, '5')
      .replace(/\bdedh\b/gi, '1.5')
      .replace(/\bdhai\b/gi, '2.5');

    const itemMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(kg|kilo|litre|ltr|l|bottle|packet|g|gram)?\s*(.+)$/i);
    if (itemMatch) {
      const qty = parseFloat(itemMatch[1]);
      let unit = (itemMatch[2] || '').toLowerCase();
      let name = itemMatch[3].trim();

      if (unit === 'kilo') unit = 'kg';
      if (!unit && /tel|oil/i.test(name)) unit = 'bottle';
      if (!unit && /doodh|milk|biscuit/i.test(name)) unit = 'packet';

      items.push({ name, qty, unit });
    } else if (cleaned.trim()) {
      items.push({ name: cleaned.trim(), qty: 1, unit: '' });
    }
  }

  const needsReview = amount === null || customer === 'Unknown';

  return {
    entries: [
      {
        customer,
        type: 'sale',
        items,
        amount,
        on_credit: isCredit,
        note: '',
      },
    ],
    needs_review: needsReview,
  };
}


// API route: Gemini with model failover (client sends preferredModel, reads modelUsed / all429)
app.post('/api/transcribe-ledger', async (req, res) => {
  const { audioBase64, mimeType, textPrompt, preferredModel, model, existingCustomers, lang } = req.body;

  const activeLang: 'hi' | 'en' = lang === 'en' ? 'en' : 'hi';

  const wanted = typeof preferredModel === 'string' ? preferredModel : typeof model === 'string' ? model : 'auto';
  const order: string[] = MODEL_CHAIN.includes(wanted)
    ? [wanted, ...MODEL_CHAIN.filter((m) => m !== wanted)]
    : [...MODEL_CHAIN];

  console.log(`[API] Processing request | Language: ${activeLang} | Preferred: ${wanted} | Order: ${order.join(' > ')}`);

  if (!audioBase64 && !textPrompt) {
    console.error(`[API] Status: 400 | No audio or text provided`);
    return res.status(400).json({
      success: false,
      model: order[0],
      status: 400,
      error: 'No audio or text provided. Please record your voice and try again.',
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(`[API] Status: 401 | Missing GEMINI_API_KEY secret`);
    return res.status(401).json({
      success: false,
      model: order[0],
      status: 401,
      error: 'GEMINI_API_KEY secret is missing. Please configure GEMINI_API_KEY in the Secrets panel.',
    });
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const customerContext = Array.isArray(existingCustomers) && existingCustomers.length > 0
    ? `\nExisting customer names (for spelling only; the speaker may be naming someone new): ${existingCustomers.join(', ')}`
    : '';

  const activeSystemInstruction = buildSystemInstruction(activeLang);

  const parts: any[] = [];
  if (audioBase64) {
    const cleanBase64 = audioBase64.includes(',') ? audioBase64.split(',')[1] : audioBase64;
    parts.push({
      inlineData: {
        mimeType: mimeType || 'audio/webm',
        data: cleanBase64,
      },
    });
    parts.push({
      text: `${activeSystemInstruction}${customerContext}\nExtract all entries from this audio input into the exact JSON format specified. Only include items the speaker actually said.`,
    });
  } else if (textPrompt) {
    parts.push({
      text: `${activeSystemInstruction}${customerContext}\nSpoken shopkeeper input:\n"${textPrompt}"\nExtract all entries from this input into the exact JSON format specified. Only include items the speaker actually said.`,
    });
  }

  const jsonConfig = {
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        heard_text: { type: Type.STRING },
        entries: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              customer: { type: Type.STRING },
              type: { type: Type.STRING }, // "sale", "payment", or "settle_all"
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    qty: { type: Type.NUMBER },
                    unit: { type: Type.STRING },
                  },
                  required: ['name'],
                },
              },
              amount: { type: Type.NUMBER },
              on_credit: { type: Type.BOOLEAN },
              note: { type: Type.STRING },
            },
            required: ['customer', 'type', 'items', 'on_credit'],
          },
        },
        needs_review: { type: Type.BOOLEAN },
      },
      required: ['entries', 'needs_review'],
    },
  };

  const started = Date.now();
  const attempts: Array<{ model: string; result: string }> = [];
  let firstUnknownResult: any = null;

  for (const m of order) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < 1500) {
      console.warn(`[API] Total time budget used up before trying ${m}`);
      break;
    }
    const timeoutMs = Math.min(PER_ATTEMPT_MS, remaining);

    try {
      const response = await withTimeout(
        ai.models.generateContent({ model: m, contents: { parts }, config: jsonConfig }),
        timeoutMs,
        m
      );
      const rawText = response.text?.trim() || '';
      if (!rawText) {
        attempts.push({ model: m, result: 'empty' });
        continue;
      }
      const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (!parsed || !Array.isArray(parsed.entries)) {
        attempts.push({ model: m, result: 'bad-json' });
        continue;
      }

      const heardText: string = typeof parsed.heard_text === 'string' ? parsed.heard_text : '';
      console.log(`[API] Model: ${m} | Status: 200 | Heard: "${heardText}"`);
      console.log(`[API] Raw JSON returned:`, JSON.stringify(parsed));

      const data = cleanEntries(parsed);
      delete data.heard_text;

      const result = {
        success: true,
        data,
        transcript: textPrompt || 'Spoken voice input',
        heardText,
        model: m,
        modelUsed: m,
        status: 200,
        parser: 'gemini',
      };

      // If a spoken name came back as Unknown, give the next model one chance to hear it better
      const hasUnknownName = data.entries.some(
        (e: any) => !e?.customer || String(e.customer).trim().toLowerCase() === 'unknown'
      );
      if (audioBase64 && hasUnknownName && !firstUnknownResult) {
        console.warn(`[API] Model: ${m} returned Unknown name, trying the next model once`);
        firstUnknownResult = result;
        continue;
      }
      return res.json(hasUnknownName && firstUnknownResult ? firstUnknownResult : result);
    } catch (err: any) {
      const kind = classifyError(err);
      attempts.push({ model: m, result: kind });
      console.error(`[API] Model: ${m} | ${kind} | ${err?.message || err}`);
    }
  }

  if (firstUnknownResult) {
    return res.json(firstUnknownResult);
  }

  const all429 = attempts.length > 0 && attempts.every((a) => a.result === 'quota');
  console.error(`[API] All attempts failed:`, JSON.stringify(attempts));

  if (all429) {
    return res.status(429).json({
      success: false,
      all429: true,
      isQuotaError: true,
      model: order[0],
      status: 429,
      error: 'Daily free limit reached on all models.',
      attempts,
    });
  }

  // Not a quota problem: for typed text, use the simple rule-based parser as a last resort
  if (textPrompt) {
    console.warn(`[API] Using rule-based fallback after failures:`, JSON.stringify(attempts));
    const ruleResult = parseTextWithRulesFallback(textPrompt, existingCustomers);
    return res.json({
      success: true,
      data: ruleResult,
      transcript: textPrompt,
      fallbackUsed: true,
      fallbackNote: 'Note: Parsed using fallback rules because the AI models did not answer in time.',
      model: 'rule-fallback',
      modelUsed: 'rule-fallback',
      status: 200,
      attempts,
    });
  }

  return res.status(500).json({
    success: false,
    model: order[0],
    status: 500,
    error: 'Gemini API request failed. Please try again.',
    attempts,
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Hisab Kitab' });
});

// Serve frontend in production or hook Vite middleware in development
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Hisab Kitab server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();