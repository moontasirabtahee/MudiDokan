import type { UnitType } from '@/lib/database.types'

export interface ParsedProduct {
  name: string
  name_bn: string
  buyPrice: number | null
  sellPrice: number | null
  stock: number | null
  unit: UnitType
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.1-8b-instant'

const PRODUCT_SYSTEM_PROMPT = `You are an assistant for a Bangladeshi grocery shop (মুদি দোকান).

The shopkeeper will speak a product definition in Bengali or mixed Bengali-English.
Extract structured product information and return ONLY valid JSON — no explanation.

Fields:
- "name": product name in spoken language
- "name_bn": product name in Bengali (translate if English)
- "buyPrice": purchase/cost price as number (কেনা/কেন/কিনে/cost/buy) — null if not mentioned
- "sellPrice": selling price as number (বেচা/বেঁচে/বিক্রি/sell) — null if not mentioned
- "stock": opening stock quantity as number (স্টক/আছে/stock) — null if not mentioned
- "unit": exactly one of: "piece","kg","gram","litre","packet","dozen","hali","sack"

Unit mapping: কেজি/kg→"kg", গ্রাম/gram→"gram", লিটার/litre→"litre", প্যাকেট/packet→"packet", ডজন/dozen→"dozen", হালি→"hali", বস্তা/ব্যাগ/sack→"sack", else "piece"

Examples:
Input: "চিনি কেন 120 বেঁচে 130 স্টক 50 কেজি"
Output: {"name":"চিনি","name_bn":"চিনি","buyPrice":120,"sellPrice":130,"stock":50,"unit":"kg"}

Input: "egg dozen buy 36 sell 42 stock 100"
Output: {"name":"Egg","name_bn":"ডিম","buyPrice":36,"sellPrice":42,"stock":100,"unit":"dozen"}

Input: "সয়াবিন তেল ১ লিটার কেনা ১৮০ বেচা ১৯৫ স্টক ২০"
Output: {"name":"সয়াবিন তেল","name_bn":"সয়াবিন তেল","buyPrice":180,"sellPrice":195,"stock":20,"unit":"litre"}`

const SEARCH_SYSTEM_PROMPT = `You are an assistant for a Bangladeshi grocery shop (মুদি দোকান).

The shopkeeper will speak a product request while making a sale. Extract what they want to sell.
Return ONLY valid JSON — no explanation.

Fields:
- "productName": the product name to search for (clean, no filler words)
- "productName_bn": Bengali version of the product name
- "quantity": how many/much they want (number, default 1)
- "unit": one of "piece","kg","gram","litre","packet","dozen","hali","sack" (default "piece")

Examples:
Input: "দুই কেজি চিনি দাও"
Output: {"productName":"চিনি","productName_bn":"চিনি","quantity":2,"unit":"kg"}

Input: "১ লিটার সয়াবিন তেল"
Output: {"productName":"সয়াবিন তেল","productName_bn":"সয়াবিন তেল","quantity":1,"unit":"litre"}

Input: "give me 3 packets maggi noodles"
Output: {"productName":"Maggi Noodles","productName_bn":"ম্যাগি নুডলস","quantity":3,"unit":"packet"}

Input: "আধা কেজি ডাল"
Output: {"productName":"ডাল","productName_bn":"ডাল","quantity":0.5,"unit":"kg"}

Input: "এক ডজন ডিম নেব"
Output: {"productName":"ডিম","productName_bn":"ডিম","quantity":1,"unit":"dozen"}`

async function callGroqDirect(systemPrompt: string, userText: string): Promise<Record<string, unknown> | null> {
  const groqKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_GROQ_API_KEY
  if (!groqKey) return null

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText.trim() },
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      console.warn('[voice] Groq API returned status:', res.status)
      return null
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) return null
    return JSON.parse(content)
  } catch (err) {
    console.warn('[voice] Direct Groq call failed:', err)
    return null
  }
}

/**
 * Calls Groq LLM (via direct VITE_GROQ_API_KEY or Supabase Edge Function)
 * to extract structured product data from speech.
 */
export async function llmParseProduct(transcript: string): Promise<ParsedProduct | null> {
  try {
    // 1. Try direct Groq call using VITE_GROQ_API_KEY if configured
    let r = await callGroqDirect(PRODUCT_SYSTEM_PROMPT, transcript)

    // 2. Fall back to Supabase Edge Function if no client key
    if (!r) {
      const { supabase } = await import('@/lib/supabase')
      const { data, error } = await supabase.functions.invoke('voice-parse', {
        body: { transcript, mode: 'product' },
      })
      if (!error && data?.result) {
        r = data.result
      }
    }

    if (!r) return null

    const validUnits: UnitType[] = ['piece', 'kg', 'gram', 'litre', 'packet', 'dozen', 'hali', 'sack']

    return {
      name:       typeof r.name === 'string'      ? (r.name as string).trim()      : '',
      name_bn:    typeof r.name_bn === 'string'   ? (r.name_bn as string).trim()   : '',
      buyPrice:   typeof r.buyPrice === 'number'  ? r.buyPrice                     : null,
      sellPrice:  typeof r.sellPrice === 'number' ? r.sellPrice                    : null,
      stock:      typeof r.stock === 'number'     ? r.stock                        : null,
      unit:       validUnits.includes(r.unit as UnitType) ? r.unit as UnitType     : 'piece',
    }
  } catch (err) {
    console.warn('[voice] LLM parse threw, falling back to regex:', err)
    return null
  }
}

export interface ParsedSearch {
  productName: string
  productName_bn: string
  quantity: number
  unit: string
}

/**
 * Calls Groq LLM (via direct VITE_GROQ_API_KEY or Supabase Edge Function)
 * to extract product name and quantity from a spoken sales request.
 */
export async function llmSearchProduct(transcript: string): Promise<ParsedSearch | null> {
  try {
    // 1. Try direct Groq call using VITE_GROQ_API_KEY if configured
    let r = await callGroqDirect(SEARCH_SYSTEM_PROMPT, transcript)

    // 2. Fall back to Supabase Edge Function
    if (!r) {
      const { supabase } = await import('@/lib/supabase')
      const { data, error } = await supabase.functions.invoke('voice-parse', {
        body: { transcript, mode: 'search' },
      })
      if (!error && data?.result) {
        r = data.result
      }
    }

    if (!r) return null

    return {
      productName:    typeof r.productName === 'string'    ? (r.productName as string).trim()    : '',
      productName_bn: typeof r.productName_bn === 'string' ? (r.productName_bn as string).trim() : '',
      quantity:       typeof r.quantity === 'number'       ? r.quantity                          : 1,
      unit:           typeof r.unit === 'string'           ? (r.unit as string)                  : 'piece',
    }
  } catch (err) {
    console.warn('[voice] LLM search threw, falling back to regex:', err)
    return null
  }
}


const BN_TO_EN: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
}

export function normalizeBnDigits(str: string): string {
  return str.replace(/[০-৯]/g, (d) => BN_TO_EN[d] || d)
}

function detectUnit(str: string): UnitType | null {
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
 * Intelligent parser for spoken Bengali product definitions:
 * e.g. "চিনি কেন 120 বেঁচে 130 স্টক 50 কেজি"
 * e.g. "সয়াবিন তেল ১ লিটার কেনা ১৮০ বেচা ১৯৫ স্টক ২০ বোতল"
 * e.g. "ডিম হালি কেনা ৩৬ টাকা বিক্রি ৪২ টাকা স্টক ১০০ হালি"
 */
export function parseSpokenProduct(phrase: string): {
  name: string
  buyPrice: number | null
  sellPrice: number | null
  stock: number | null
  unit: UnitType
} {
  const original = phrase.trim()
  const normalized = normalizeBnDigits(original)

  // Keyword patterns
  const buyKeywordRegex = /(?:^|\s)(?:কেনার\s*দাম|কেনা\s*দাম|কেনার|কেনা|কেন|কিনেছি|কিনে|কেনে|ক্রয়মূল্য|ক্রয়|ক্রয়মূল্য|ক্রয়|buy|cost)(?:\s|$|[:=\-])/i
  const sellKeywordRegex = /(?:^|\s)(?:বিক্রির\s*দাম|বিক্রি\s*দাম|বিক্রয়মূল্য|বিক্রয়মূল্য|বিক্রির|বিক্রয়|বিক্রয়|বিক্রি|বেচার\s*দাম|বেচা\s*দাম|বেচার|বেচা|বেচে|বেঁচে|বেচবো|বেচব|বেচ|সেল|sell)(?:\s|$|[:=\-])/i
  const stockKeywordRegex = /(?:^|\s)(?:স্টক|স্টকে|পরিমাণ|পরিমান|সংখ্যা|stock|qty)(?:\s|$|[:=\-])/i

  // Find the earliest keyword boundary
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

  // Extract Buy Price
  const buyMatch = paramPart.match(
    /(?:কেনার\s*দাম|কেনা\s*দাম|কেনার|কেনা|কেন|কিনেছি|কিনে|কেনে|ক্রয়মূল্য|ক্রয়|ক্রয়মূল্য|ক্রয়|buy|cost)\s*(?:হলো|হল|ছিল|দাম|রেট|rate)?\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(?:টাকা|টাকার|tk|taka)?/i,
  )
  if (buyMatch && buyMatch[1]) {
    buyPrice = parseFloat(buyMatch[1])
  }

  // Extract Sell Price
  const sellMatch = paramPart.match(
    /(?:বিক্রির\s*দাম|বিক্রি\s*দাম|বিক্রয়মূল্য|বিক্রয়মূল্য|বিক্রির|বিক্রয়|বিক্রয়|বিক্রি|বেচার\s*দাম|বেচা\s*দাম|বেচার|বেচা|বেচে|বেঁচে|বেচবো|বেচব|বেচ|সেল|sell)\s*(?:হলো|হল|ছিল|দাম|রেট|rate)?\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(?:টাকা|টাকার|tk|taka)?/i,
  )
  if (sellMatch && sellMatch[1]) {
    sellPrice = parseFloat(sellMatch[1])
  }

  // Extract Stock and specific stock unit
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

  // If unit not detected from stock phrase, try the parameter section, then name section
  if (unit === 'piece') {
    const paramUnit = detectUnit(paramPart)
    if (paramUnit) {
      unit = paramUnit
    } else {
      const nameUnit = detectUnit(namePart)
      if (nameUnit) unit = nameUnit
    }
  }

  // Clean name
  let cleanName = namePart
    .replace(/^[,;:\-_/\s]+|[,;:\-_/\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Fallback if no keyword was found and everything was in namePart
  if (!cleanName && original) {
    cleanName = original
  }

  return {
    name: cleanName,
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
