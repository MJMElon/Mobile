// MJM Nursery — Gemini document-scan proxy (Supabase Edge Function)
//
// WHY THIS EXISTS
// The old static pages embedded the Gemini API key in client JavaScript
// (do_signing.html / consent.html). Anyone could "View Source" and steal it.
// This function keeps the key server-side. The browser sends the image +
// prompt here; we call Gemini and return only the parsed result.
//
// SECURITY
//  - JWT verification is ON (default), so only authenticated MJM staff can
//    invoke it. Customers / anonymous visitors cannot.
//  - The key is read from the GEMINI_KEY secret, never shipped to the client.
//
// DEPLOY
//   supabase secrets set GEMINI_KEY=AIza...your-key...
//   supabase functions deploy gemini-scan
//
// deno-lint-ignore-file no-explicit-any

// Default model when the caller doesn't specify one. Callers may pass any
// model name via the `model` field (the hub uses several: gemini-3-flash-preview,
// gemini-2.0-flash, etc.) so each page keeps its original behavior.
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-04-17';
const MODEL_ALLOWLIST = [
  'gemini-2.5-flash-preview-04-17',
  'gemini-3-flash-preview',
  'gemini-2.0-flash',
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const key = Deno.env.get('GEMINI_KEY');
  if (!key) return json({ error: 'Server not configured (missing GEMINI_KEY)' }, 500);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { image, mimeType, prompt, model } = payload || {};
  if (!image || !prompt) return json({ error: 'image and prompt are required' }, 400);

  // Use the requested model only if it's on the allowlist; otherwise default.
  const chosenModel = MODEL_ALLOWLIST.includes(model) ? model : DEFAULT_MODEL;

  const data = String(image).includes(',') ? String(image).split(',')[1] : image;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${key}`;
  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mimeType || 'image/jpeg', data } },
        ],
      },
    ],
    // temperature 0 = deterministic extraction/counting (matches the hub's
    // original seed-count behavior); JSON mime forces structured output.
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    if (!res.ok) {
      return json({ error: out?.error?.message || 'Gemini API error' }, 502);
    }
    const raw = out?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    try {
      return json(JSON.parse(cleaned));
    } catch {
      return json({ error: 'Model returned non-JSON output', raw }, 502);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 502);
  }
});
