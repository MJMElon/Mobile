import { supabase } from './supabase';

// AI document scan — the Gemini API key NO LONGER lives in the client.
// We invoke a Supabase Edge Function ("gemini-scan") which holds the key
// server-side and is callable only by authenticated staff. This closes the
// "view source → steal API key" leak that existed in the old static pages.
//
// `base64` may be a full data URL or raw base64. Returns the parsed JSON the
// model produced.
export async function callGeminiScan(base64, mimeType, prompt) {
  const data = base64.includes(',') ? base64.split(',')[1] : base64;
  const { data: result, error } = await supabase.functions.invoke('gemini-scan', {
    body: { image: data, mimeType: mimeType || 'image/jpeg', prompt },
  });
  if (error) throw new Error(error.message || 'AI scan failed');
  if (result?.error) throw new Error(result.error);
  return result;
}

// Downscale + JPEG-compress an image (data URL in → data URL out) before
// upload / AI scan. Keeps payloads small for mobile data connections.
export function compressImage(base64, maxWidth = 1400, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = base64;
  });
}
