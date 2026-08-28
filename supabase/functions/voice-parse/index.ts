// Supabase Edge Function: voice-parse
// Handles two modes:
//   mode: "product"  → extracts structured product data (for adding products)
//   mode: "search"   → extracts product name + quantity (for selling screen)
//
// GROQ_API_KEY must be set as a Supabase secret:
//   supabase secrets set GROQ_API_KEY=your_groq_api_key_here

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.1-8b-instant'

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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { transcript, mode = 'product' } = await req.json()

    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return new Response(
        JSON.stringify({ error: 'transcript is required' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }

    const groqKey = Deno.env.get('GROQ_API_KEY')
    if (!groqKey) {
      return new Response(
        JSON.stringify({ error: 'GROQ_API_KEY not configured' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }

    const systemPrompt = mode === 'search' ? SEARCH_SYSTEM_PROMPT : PRODUCT_SYSTEM_PROMPT

    const groqResponse = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript.trim() },
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    })

    if (!groqResponse.ok) {
      const errText = await groqResponse.text()
      console.error('Groq API error:', groqResponse.status, errText)
      return new Response(
        JSON.stringify({ error: 'upstream_error', detail: groqResponse.status }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }

    const groqData = await groqResponse.json()
    const content = groqData?.choices?.[0]?.message?.content

    if (!content) {
      return new Response(
        JSON.stringify({ error: 'empty_response' }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(content)
    } catch {
      return new Response(
        JSON.stringify({ error: 'invalid_json', raw: content }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ result: parsed }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('voice-parse edge function error:', err)
    return new Response(
      JSON.stringify({ error: 'internal_error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }
})
