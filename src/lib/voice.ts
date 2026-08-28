import type { ExpenseCategory, UnitType } from '@/lib/database.types'

export interface ParsedProduct {
  name: string
  name_bn: string
  buyPrice: number | null
  sellPrice: number | null
  stock: number | null
  unit: UnitType
}

export interface ParsedSellItem {
  product_id?: string | null
  name: string
  name_bn: string
  quantity: number
  unit: string
}

export interface ParsedExpense {
  category: ExpenseCategory
  amount: number
  note: string
}

export interface ParsedPurchaseItem {
  product_name: string
  qty: number
  unit: UnitType
  unit_cost: number
}

export interface ParsedKhataEntry {
  party_type: 'customer' | 'supplier'
  party_name: string
  amount: number
  type: 'payment_received' | 'credit_sale' | 'payment_made' | 'credit_purchase'
}

export interface CatalogProductSummary {
  id: string
  name: string
  name_bn: string | null
  unit: string
  sell_price?: number
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODEL = 'openai/gpt-oss-20b'
const GROQ_FALLBACK_MODELS = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'qwen/qwen3.6-27b']
const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo'

/**
 * Transcribes microphone audio recording directly to text using Groq's high-speed Whisper AI.
 */
export async function transcribeAudioWithWhisper(blob: Blob): Promise<string | null> {
  const groqKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_GROQ_API_KEY
  if (!groqKey) return null

  try {
    const formData = new FormData()
    formData.append('file', blob, 'recording.webm')
    formData.append('model', GROQ_WHISPER_MODEL)
    formData.append('language', 'bn')
    formData.append('response_format', 'json')
    formData.append('temperature', '0')

    const res = await fetch(GROQ_WHISPER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
      },
      body: formData,
    })

    if (!res.ok) {
      console.warn('[voice] Whisper API returned status:', res.status)
      return null
    }

    const data = await res.json()
    return typeof data?.text === 'string' ? data.text.trim() : null
  } catch (err) {
    console.warn('[voice] Whisper audio transcription threw:', err)
    return null
  }
}

/* ── System Prompts ───────────────────────────────────────────────────────── */

const SELL_CART_SYSTEM_PROMPT = `You are an AI assistant for a Bangladeshi grocery shop (মুদি দোকান).
The shopkeeper will speak a list of one or more products sold to a customer in Bengali, English, or mixed.
Extract ALL requested items into a JSON list. If a product catalog is provided, match each spoken item to the most relevant catalog product and set its product_id.

Output ONLY valid JSON in this exact structure:
{
  "items": [
    {
      "product_id": "exact ID from provided catalog or null",
      "name": "product name in english/transliteration",
      "name_bn": "product name in Bengali script",
      "quantity": number (e.g. 1, 2, 0.5, 1.5, 2.5),
      "unit": "kg" | "gram" | "litre" | "packet" | "dozen" | "hali" | "sack" | "piece"
    }
  ]
}

Unit mapping rules:
- কেজি/কেজির/kg/kilo -> "kg"
- গ্রাম/gram/gm -> "gram"
- লিটার/litre/liter/বোতল -> "litre"
- প্যাকেট/প্যাক/packet/pack -> "packet"
- ডজন/dozen -> "dozen"
- হালি/হালির -> "hali"
- বস্তা/ব্যাগ/sack/bag -> "sack"
- পিস/টা/টি/piece/pc -> "piece"

Fraction numbers:
- আধা / half -> 0.5
- দেড় / দেড় / one and half -> 1.5
- আড়াই / আড়াই -> 2.5
- পৌনে -> 0.75
- সোয়া / সোয়া -> 1.25

Examples:
Input: "২ কেজি চিনি, ১ লিটার রূপচাঁদা সয়াবিন তেল এবং ৩ প্যাকেট ম্যাগি নুডলস"
Output: {"items":[{"name":"Sugar","name_bn":"চিনি","quantity":2,"unit":"kg"},{"name":"Rupchanda Soybean Oil","name_bn":"রূপচাঁদা সয়াবিন তেল","quantity":1,"unit":"litre"},{"name":"Maggi Noodles","name_bn":"ম্যাগি নুডলস","quantity":3,"unit":"packet"}]}

Input: "give me half kg dal, 1 dozen eggs and 2 packets salt"
Output: {"items":[{"name":"Dal","name_bn":"ডাল","quantity":0.5,"unit":"kg"},{"name":"Egg","name_bn":"ডিম","quantity":1,"unit":"dozen"},{"name":"Salt","name_bn":"লবণ","quantity":2,"unit":"packet"}]}`

const PRODUCT_LIST_SYSTEM_PROMPT = `You are an AI assistant for a Bangladeshi grocery shop (মুদি দোকান).
The shopkeeper will speak one or multiple product definitions to create in the inventory.
Extract structured product entries into a JSON list.

Output ONLY valid JSON in this exact structure:
{
  "products": [
    {
      "name": "spoken or English product name",
      "name_bn": "Bengali product name",
      "buyPrice": number or null,
      "sellPrice": number or null,
      "stock": number or null,
      "unit": "piece" | "kg" | "gram" | "litre" | "packet" | "dozen" | "hali" | "sack"
    }
  ]
}

Examples:
Input: "চিনি কেনা ১২০ বেচা ১৩০ স্টক ৫০ কেজি, লবণ কেনা ৩৫ বেচা ৪০ স্টক ৩০ প্যাকেট"
Output: {"products":[{"name":"চিনি","name_bn":"চিনি","buyPrice":120,"sellPrice":130,"stock":50,"unit":"kg"},{"name":"লবণ","name_bn":"লবণ","buyPrice":35,"sellPrice":40,"stock":30,"unit":"packet"}]}

Input: "egg dozen buy 36 sell 42 stock 100"
Output: {"products":[{"name":"Egg","name_bn":"ডিম","buyPrice":36,"sellPrice":42,"stock":100,"unit":"dozen"}]}`

const EXPENSE_SYSTEM_PROMPT = `You are an AI assistant for a Bangladeshi grocery shop (মুদি দোকান).
The shopkeeper will speak an expense they made today.
Extract the expense category, amount, and note in JSON.

Categories must be one of:
- "rent" (দোকান ভাড়া / ঘর ভাড়া)
- "utility" (বিদ্যুৎ বিল / কারেন্ট বিল / পানি বিল / গ্যাস বিল / ওয়াইফাই)
- "salary" (কর্মচারীর বেতন / বেতন / মজুরি / খালাসি)
- "transport" (ভাড়া / রিকশা ভাড়া / ভ্যান ভাড়া / পরিবহন / গাড়ি ভাড়া)
- "refreshment" (নাস্তা / চা / বিস্কুট / সিগারেট / পান / খাওয়া)
- "repair" (মেরামত / কার্পেন্টার / লাইট ঠিক করা / প্লাগ)
- "license" (ট্রেড লাইসেন্স / ট্যাক্স / নবায়ন)
- "other" (অন্যান্য / বিবিধ)

Output ONLY valid JSON:
{
  "category": "rent" | "utility" | "salary" | "transport" | "refreshment" | "repair" | "license" | "other",
  "amount": number,
  "note": "short description"
}

Examples:
Input: "দোকানের বিদ্যুৎ বিল ১৫০০ টাকা দিয়েছি"
Output: {"category":"utility","amount":1500,"note":"বিদ্যুৎ বিল"}

Input: "চা নাস্তা খরচ ৬০ টাকা"
Output: {"category":"refreshment","amount":60,"note":"চা নাস্তা"}`

const PURCHASE_SYSTEM_PROMPT = `You are an AI assistant for a Bangladeshi grocery shop.
The shopkeeper will speak incoming stock / restock invoice items.
Extract the items list into JSON.

Output ONLY valid JSON:
{
  "items": [
    {
      "product_name": "product name in Bengali or English",
      "qty": number,
      "unit": "piece" | "kg" | "gram" | "litre" | "packet" | "dozen" | "hali" | "sack",
      "unit_cost": number
    }
  ]
}

Examples:
Input: "চিনি ৫০ কেজি কেনা ১০০ টাকা, ডাল ২০ কেজি কেনা ৯০ টাকা"
Output: {"items":[{"product_name":"চিনি","qty":50,"unit":"kg","unit_cost":100},{"product_name":"ডাল","qty":20,"unit":"kg","unit_cost":90}]}`

const KHATA_SYSTEM_PROMPT = `You are an AI assistant for a Bangladeshi grocery shop.
The shopkeeper will speak about a customer due payment or credit given.
Extract the party and amount into JSON.

Output ONLY valid JSON:
{
  "party_type": "customer" | "supplier",
  "party_name": "name of person",
  "amount": number,
  "type": "payment_received" | "credit_sale" | "payment_made" | "credit_purchase"
}

Examples:
Input: "রহিম ভাই ৫০০ টাকা জমা দিল"
Output: {"party_type":"customer","party_name":"রহিম","amount":500,"type":"payment_received"}

Input: "করিম বাকি নিল ২০০ টাকা"
Output: {"party_type":"customer","party_name":"করিম","amount":200,"type":"credit_sale"}`

/* ── JSON Parser Helper ─────────────────────────────────────────────────── */

function extractAndParseJSON(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw)
  } catch {
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (codeBlock && codeBlock[1]) {
      try {
        return JSON.parse(codeBlock[1].trim())
      } catch {
        // continue
      }
    }

    const firstBrace = raw.indexOf('{')
    const lastBrace = raw.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.slice(firstBrace, lastBrace + 1))
      } catch {
        // ignore
      }
    }
  }
  return null
}

async function callGroqDirect(systemPrompt: string, userText: string): Promise<Record<string, unknown> | null> {
  const groqKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_GROQ_API_KEY
  if (!groqKey) return null

  const models = [GROQ_MODEL, ...GROQ_FALLBACK_MODELS]

  for (const model of models) {
    try {
      const isGptOss = model.startsWith('openai/')
      const requestPayload: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText.trim() },
        ],
        temperature: 1,
        top_p: 1,
        max_completion_tokens: 2048,
        response_format: { type: 'json_object' },
      }

      if (isGptOss) {
        requestPayload.reasoning_effort = 'medium'
      }

      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      })

      if (!res.ok) {
        // Retry with max_tokens if max_completion_tokens or reasoning_effort is unsupported by that specific model
        const fallbackRes = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userText.trim() },
            ],
            temperature: 1,
            max_tokens: 2048,
            response_format: { type: 'json_object' },
          }),
        })

        if (!fallbackRes.ok) {
          console.warn(`[voice] Groq API (${model}) returned status:`, fallbackRes.status)
          continue
        }

        const fallbackData = await fallbackRes.json()
        const content = fallbackData?.choices?.[0]?.message?.content
        if (content) {
          const parsed = extractAndParseJSON(content)
          if (parsed) return parsed
        }
        continue
      }

      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content
      if (!content) continue
      const parsed = extractAndParseJSON(content)
      if (parsed) return parsed
    } catch (err) {
      console.warn(`[voice] Groq (${model}) call failed:`, err)
    }
  }

  return null
}

/* ── Exported LLM Calling Functions ───────────────────────────────────────── */

/**
 * Parses spoken text for Sell screen into a list of items to add to cart,
 * intelligently matching against the shop's product database if provided.
 */
export async function llmParseSellItems(
  transcript: string,
  catalog?: CatalogProductSummary[],
): Promise<ParsedSellItem[] | null> {
  try {
    let systemPrompt = SELL_CART_SYSTEM_PROMPT
    if (catalog && catalog.length > 0) {
      const lines = catalog.slice(0, 250).map((p) => {
        const bn = p.name_bn ? ` / ${p.name_bn}` : ''
        const price = p.sell_price ? ` - ৳${p.sell_price}` : ''
        return `- ID: "${p.id}" | Name: "${p.name}${bn}" | Unit: "${p.unit}"${price}`
      })
      systemPrompt += `\n\n### Current Shop Database Inventory (Match against these products):\n${lines.join('\n')}\n\nMatching Rules:\n1. If a spoken product matches or closely resembles an item in the Shop Database, set "product_id" to that exact product's ID string, and use that product's exact name.\n2. If the spoken product is not in the shop database, set "product_id" to null.\n3. Return quantity as a number and unit as one of the standard unit strings.`
    }

    let r = await callGroqDirect(systemPrompt, transcript)

    if (!r) {
      const { supabase } = await import('@/lib/supabase')
      const { data, error } = await supabase.functions.invoke('voice-parse', {
        body: { transcript, mode: 'sell_cart', catalog: catalog?.slice(0, 100) },
      })
      if (!error && data?.result) r = data.result
    }

    if (!r) return null

    const rawList = Array.isArray(r.items) ? r.items : Array.isArray(r) ? r : null
    if (!rawList) return null

    const validUnits = ['piece', 'kg', 'gram', 'litre', 'packet', 'dozen', 'hali', 'sack']
    const out: ParsedSellItem[] = []

    for (const item of rawList) {
      if (typeof item !== 'object' || !item) continue
      const product_id = typeof item.product_id === 'string' && item.product_id.trim() ? item.product_id.trim() : null
      const name = String(item.name || item.name_bn || item.productName || '').trim()
      const name_bn = String(item.name_bn || item.name || item.productName_bn || name).trim()
      const quantity = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1
      const unit = typeof item.unit === 'string' && validUnits.includes(item.unit) ? item.unit : 'piece'

      if (name || name_bn || product_id) {
        out.push({ product_id, name, name_bn, quantity, unit })
      }
    }

    return out.length > 0 ? out : null
  } catch (err) {
    console.warn('[voice] llmParseSellItems threw:', err)
    return null
  }
}

/**
 * Parses spoken text into a list of product definitions to create in inventory.
 */
export async function llmParseProductList(transcript: string): Promise<ParsedProduct[] | null> {
  try {
    let r = await callGroqDirect(PRODUCT_LIST_SYSTEM_PROMPT, transcript)

    if (!r) {
      const { supabase } = await import('@/lib/supabase')
      const { data, error } = await supabase.functions.invoke('voice-parse', {
        body: { transcript, mode: 'product_list' },
      })
      if (!error && data?.result) r = data.result
    }

    if (!r) return null

    const rawList = Array.isArray(r.products) ? r.products : Array.isArray(r) ? r : [r]
    const validUnits: UnitType[] = ['piece', 'kg', 'gram', 'litre', 'packet', 'dozen', 'hali', 'sack']
    const out: ParsedProduct[] = []

    for (const item of rawList) {
      if (typeof item !== 'object' || !item) continue
      const name = String(item.name || item.name_bn || '').trim()
      const name_bn = String(item.name_bn || name).trim()
      if (!name && !name_bn) continue

      out.push({
        name,
        name_bn,
        buyPrice: typeof item.buyPrice === 'number' ? item.buyPrice : null,
        sellPrice: typeof item.sellPrice === 'number' ? item.sellPrice : null,
        stock: typeof item.stock === 'number' ? item.stock : null,
        unit: validUnits.includes(item.unit as UnitType) ? (item.unit as UnitType) : 'piece',
      })
    }

    return out.length > 0 ? out : null
  } catch (err) {
    console.warn('[voice] llmParseProductList threw:', err)
    return null
  }
}

/** Single product parse convenience (calls llmParseProductList) */
export async function llmParseProduct(transcript: string): Promise<ParsedProduct | null> {
  const list = await llmParseProductList(transcript)
  return list && list.length > 0 ? list[0] : null
}

export interface ParsedSearch {
  productName: string
  productName_bn: string
  quantity: number
  unit: string
}

/** Backward-compatible single item search */
export async function llmSearchProduct(transcript: string): Promise<ParsedSearch | null> {
  const items = await llmParseSellItems(transcript)
  if (items && items.length > 0) {
    return {
      productName: items[0].name,
      productName_bn: items[0].name_bn,
      quantity: items[0].quantity,
      unit: items[0].unit,
    }
  }
  return null
}

/**
 * Parses spoken expense into category, amount, and note.
 */
export async function llmParseExpense(transcript: string): Promise<ParsedExpense | null> {
  try {
    let r = await callGroqDirect(EXPENSE_SYSTEM_PROMPT, transcript)

    if (!r) {
      const { supabase } = await import('@/lib/supabase')
      const { data, error } = await supabase.functions.invoke('voice-parse', {
        body: { transcript, mode: 'expense' },
      })
      if (!error && data?.result) r = data.result
    }

    if (!r) return null

    const validCategories: ExpenseCategory[] = [
      'rent', 'utility', 'salary', 'transport', 'refreshment', 'repair', 'license', 'other',
    ]

    const category = validCategories.includes(r.category as ExpenseCategory)
      ? (r.category as ExpenseCategory)
      : 'other'

    const amount = typeof r.amount === 'number' && r.amount > 0 ? r.amount : 0
    const note = typeof r.note === 'string' ? r.note.trim() : ''

    if (amount > 0) {
      return { category, amount, note }
    }
    return null
  } catch (err) {
    console.warn('[voice] llmParseExpense threw:', err)
    return null
  }
}

/**
 * Parses spoken purchase/restock invoice items.
 */
export async function llmParsePurchaseItems(transcript: string): Promise<ParsedPurchaseItem[] | null> {
  try {
    let r = await callGroqDirect(PURCHASE_SYSTEM_PROMPT, transcript)
    if (!r) return null

    const rawList = Array.isArray(r.items) ? r.items : Array.isArray(r) ? r : null
    if (!rawList) return null

    const validUnits: UnitType[] = ['piece', 'kg', 'gram', 'litre', 'packet', 'dozen', 'hali', 'sack']
    const out: ParsedPurchaseItem[] = []

    for (const item of rawList) {
      if (typeof item !== 'object' || !item) continue
      const product_name = String(item.product_name || item.name || '').trim()
      const qty = typeof item.qty === 'number' && item.qty > 0 ? item.qty : 1
      const unit = validUnits.includes(item.unit as UnitType) ? (item.unit as UnitType) : 'piece'
      const unit_cost = typeof item.unit_cost === 'number' ? item.unit_cost : 0

      if (product_name) {
        out.push({ product_name, qty, unit, unit_cost })
      }
    }

    return out.length > 0 ? out : null
  } catch (err) {
    console.warn('[voice] llmParsePurchaseItems threw:', err)
    return null
  }
}

/**
 * Parses spoken Khata customer/supplier payment or credit entry.
 */
export async function llmParseKhataEntry(transcript: string): Promise<ParsedKhataEntry | null> {
  try {
    let r = await callGroqDirect(KHATA_SYSTEM_PROMPT, transcript)
    if (!r) return null

    const party_type = r.party_type === 'supplier' ? 'supplier' : 'customer'
    const party_name = typeof r.party_name === 'string' ? r.party_name.trim() : ''
    const amount = typeof r.amount === 'number' && r.amount > 0 ? r.amount : 0
    const validTypes = ['payment_received', 'credit_sale', 'payment_made', 'credit_purchase']
    const type = validTypes.includes(r.type as string) ? (r.type as ParsedKhataEntry['type']) : 'payment_received'

    if (party_name && amount > 0) {
      return { party_type, party_name, amount, type }
    }
    return null
  } catch (err) {
    console.warn('[voice] llmParseKhataEntry threw:', err)
    return null
  }
}

/* ── Fallback Local Regex Parsers ─────────────────────────────────────────── */

const BN_TO_EN: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
}

export function normalizeBnDigits(str: string): string {
  return str.replace(/[০-৯]/g, (d) => BN_TO_EN[d] || d)
}

export function detectUnit(str: string): UnitType | null {
  if (/(?:কেজি|কেজির|গ্রাম|কেজির\s*বস্তা|kg|kilo|gram|gm)\b|কেজি|kg/i.test(str)) return 'kg'
  if (/(?:লিটার|লিটারের|লি|মিলি|litre|liter|ml|l)\b|লিটার|litre/i.test(str)) return 'litre'
  if (/(?:প্যাকেট|প্যাক|packet|pack|pkt)\b|প্যাকেট|packet/i.test(str)) return 'packet'
  if (/(?:ডজন|dozen|doz)\b|ডজন|dozen/i.test(str)) return 'dozen'
  if (/(?:হালি|hali)\b|হালি/i.test(str)) return 'hali'
  if (/(?:বস্তা|ব্যাগ|sack|bag)\b|বস্তা|ব্যাগ/i.test(str)) return 'sack'
  if (/(?:পিস|টি|টা|বোতল|piece|pc|pcs)\b|পিস|piece/i.test(str)) return 'piece'
  return null
}

/**
 * Splits multi-item spoken sales phrases (separated by commas, 'এবং', 'আর', 'ও', 'plus', 'and')
 */
export function parseMultiSellItems(phrase: string): ParsedSellItem[] {
  const parts = phrase
    .split(/[,;\n]|(?:\s+(?:এবং|আর|ও|and|plus|\+)\s+)/i)
    .map((p) => p.trim())
    .filter(Boolean)

  const items: ParsedSellItem[] = []
  for (const part of parts) {
    const { qty, cleanName } = parseVoiceQty(part)
    const unit = detectUnit(part) || 'piece'
    if (cleanName) {
      items.push({
        name: cleanName,
        name_bn: cleanName,
        quantity: qty,
        unit,
      })
    }
  }

  return items
}

/**
 * Intelligent regex parser for spoken Bengali product definitions
 */
export function parseSpokenProduct(phrase: string): ParsedProduct {
  const original = phrase.trim()
  const normalized = normalizeBnDigits(original)

  const buyKeywordRegex = /(?:^|\s)(?:কেনার\s*দাম|কেনা\s*দাম|কেনার|কেনা|কেন|কিনেছি|কিনে|কেনে|ক্রয়মূল্য|ক্রয়|ক্রয়মূল্য|ক্রয়|buy|cost)(?:\s|$|[:=\-])/i
  const sellKeywordRegex = /(?:^|\s)(?:বিক্রির\s*দাম|বিক্রি\s*দাম|বিক্রয়মূল্য|বিক্রয়মূল্য|বিক্রির|বিক্রয়|বিক্রয়|বিক্রি|বেচার\s*দাম|বেচা\s*দাম|বেচার|বেচা|বেচে|বেঁচে|বেচবো|বেচব|বেচ|সেল|sell)(?:\s|$|[:=\-])/i
  const stockKeywordRegex = /(?:^|\s)(?:স্টক|স্টকে|পরিমাণ|পরিমান|সংখ্যা|stock|qty)(?:\s|$|[:=\-])/i

  const matches = [
    normalized.search(buyKeywordRegex),
    normalized.search(sellKeywordRegex),
    normalized.search(stockKeywordRegex),
  ].filter((idx) => idx !== -1)

  let namePart = original
  let paramPart = normalized

  if (matches.length > 0) {
    const splitIndex = Math.min(...matches)
    if (splitIndex > 0) {
      namePart = original.slice(0, splitIndex).trim()
      paramPart = normalized.slice(splitIndex).trim()
    }
  }

  let buyPrice: number | null = null
  let sellPrice: number | null = null
  let stock: number | null = null
  let unit: UnitType = 'piece'

  const buyMatch = paramPart.match(
    /(?:কেনার\s*দাম|কেনা\s*দাম|কেনার|কেনা|কেন|কিনেছি|কিনে|কেনে|ক্রয়মূল্য|ক্রয়|ক্রয়মূল্য|ক্রয়|buy|cost)\s*(?:হলো|হল|ছিল|দাম|রেট|rate)?\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(?:টাকা|টাকার|tk|taka)?/i,
  )
  if (buyMatch && buyMatch[1]) {
    buyPrice = parseFloat(buyMatch[1])
  }

  const sellMatch = paramPart.match(
    /(?:বিক্রির\s*দাম|বিক্রি\s*দাম|বিক্রয়মূল্য|বিক্রয়মূল্য|বিক্রির|বিক্রয়|বিক্রয়|বিক্রি|বেচার\s*দাম|বেচা\s*দাম|বেচার|বেচা|বেচে|বেঁচে|বেচবো|বেচব|বেচ|সেল|sell)\s*(?:হলো|হল|ছিল|দাম|রেট|rate)?\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(?:টাকা|টাকার|tk|taka)?/i,
  )
  if (sellMatch && sellMatch[1]) {
    sellPrice = parseFloat(sellMatch[1])
  }

  const stockMatch = paramPart.match(
    /(?:স্টক|স্টকে|পরিমাণ|পরিমান|মোট|সংখ্যা|stock|qty)\s*(?:হলো|হল|ছিল|হবে|আছে)?\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(কেজি|গ্রাম|লিটার|লি|প্যাকেট|প্যাক|ডজন|হালি|বোতল|বস্তা|ব্যাগ|পিস|টি|টা|piece|pc|pcs|kg|litre|packet|dozen|hali|sack|bag)?/i,
  ) || paramPart.match(
    /(\d+(?:\.\d+)?)\s*(কেজি|গ্রাম|লিটার|লি|প্যাকেট|প্যাক|ডজন|হালি|বোতল|বস্তা|ব্যাগ|পিস|টি|টা|piece|pc|pcs|kg|litre|packet|dozen|hali|sack|bag)\s*(?:স্টক|স্টকে|আছে|মোট)/i,
  )

  if (stockMatch) {
    if (stockMatch[1]) stock = parseFloat(stockMatch[1])
    if (stockMatch[2]) {
      const detected = detectUnit(stockMatch[2])
      if (detected) unit = detected
    }
  }

  if (unit === 'piece') {
    const paramUnit = detectUnit(paramPart)
    if (paramUnit) {
      unit = paramUnit
    } else {
      const nameUnit = detectUnit(namePart)
      if (nameUnit) unit = nameUnit
    }
  }

  let cleanName = namePart
    .replace(/^[,;:\-_/\s]+|[,;:\-_/\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleanName && original) {
    cleanName = original
  }

  return {
    name: cleanName,
    name_bn: cleanName,
    buyPrice,
    sellPrice,
    stock,
    unit,
  }
}

/**
 * Parses Bengali numbers and text quantities (যেমন: "২ কেজি", "১ লিটার", "আধা কেজি")
 */
export function parseVoiceQty(phrase: string): { qty: number; cleanName: string } {
  let text = phrase.trim()
  let qty = 1

  const normalized = normalizeBnDigits(text)

  if (normalized.includes('আধা') || normalized.includes('half')) {
    qty = 0.5
    text = text.replace(/আধা|half/gi, '').trim()
  } else if (normalized.includes('দেড়') || normalized.includes('দেড়')) {
    qty = 1.5
    text = text.replace(/দেড়|দেড়/gi, '').trim()
  } else if (normalized.includes('আড়াই') || normalized.includes('আড়াই')) {
    qty = 2.5
    text = text.replace(/আড়াই|আড়াই/gi, '').trim()
  } else {
    const match = normalized.match(/(\d+(\.\d+)?)\s*(কেজি|গ্রাম|লিটার|পিস|প্যাকেট|ডজন|হালি|বস্তা|ব্যাগ|kg|litre|packet|piece)?/i)
    if (match && match[1]) {
      const parsed = parseFloat(match[1])
      if (!isNaN(parsed) && parsed > 0) {
        qty = parsed
        text = text.replace(match[0], '').trim()
      }
    }
  }

  text = text.replace(/(দিন|দাও|লাগবে|চাই|নেন|দেন|একটু)/g, '').trim()

  return { qty, cleanName: text }
}

/**
 * Intelligent regex parser for spoken expenses (fallback when offline)
 */
export function parseSpokenExpense(phrase: string): ParsedExpense {
  const normalized = normalizeBnDigits(phrase.trim())
  let category: ExpenseCategory = 'other'

  if (/ভাড়া|ভাড়া|ঘর|দোকান|rent/i.test(normalized)) category = 'rent'
  else if (/বিদ্যুৎ|কারেন্ট|বিল|পানি|গ্যাস|ওয়াইফাই|utility|electricity/i.test(normalized)) category = 'utility'
  else if (/বেতন|মজুরি|কর্মচারী|salary|wage/i.test(normalized)) category = 'salary'
  else if (/গাড়ি|রিকশা|ভ্যান|পরিবহন|transport/i.test(normalized)) category = 'transport'
  else if (/নাস্তা|চা|বিস্কুট|সিগারেট|পান|খাওয়া|refreshment|tea/i.test(normalized)) category = 'refreshment'
  else if (/মেরামত|লাইট|repair/i.test(normalized)) category = 'repair'
  else if (/লাইসেন্স|ট্যাক্স|license|tax/i.test(normalized)) category = 'license'

  const amountMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:টাকা|টাকার|tk|taka)?/i)
  const amount = amountMatch && amountMatch[1] ? parseFloat(amountMatch[1]) : 0

  return {
    category,
    amount,
    note: phrase.trim(),
  }
}

