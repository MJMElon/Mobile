/* COLLECTION TIME SLOTS, as the office sets them: Seedling Stock
   Management -> System Settings -> Collection Time Slot, the one row of
   shared_collection_slot_settings.

   A COPY of the rule in mjm-ai-system shared/shared_collection_slots.js
   (another repository cannot be imported). The customer booking page and
   the Sales Web carry the same copy. Change one, change all of them.

   - An unreadable or absent row keeps the hours this page always had
     (8 AM - 5 PM, Saturday 8 AM - 12 PM, 350 seedlings an hour).
   - LUNCH is one break for every open day. Its hours are not offered, and
     a booking may not run into it: one booking is one lorry loaded
     straight through. */
import { supabase } from './supabase.js';

export const slots = {
  weekday_open: 8, weekday_close: 17,
  sat_open: 8, sat_close: 12,
  rate_per_hour: 350,
  lunch_start: null, lunch_end: null,
};

function intIn(v, lo, hi) {
  const n = Number(v);
  return (v !== null && v !== '' && v !== undefined && Number.isFinite(n) && Math.floor(n) === n && n >= lo && n <= hi) ? n : null;
}

/* Applies a stored row. Answers false and changes nothing for a row that
   is not a usable setting. */
export function applySlotRow(row) {
  if (!row) return false;
  const wo = intIn(row.weekday_open, 0, 23), wc = intIn(row.weekday_close, 1, 24);
  const so = intIn(row.sat_open, 0, 23), sc = intIn(row.sat_close, 1, 24);
  if (wo === null || wc === null || wc <= wo || so === null || sc === null || sc <= so) return false;
  Object.assign(slots, { weekday_open: wo, weekday_close: wc, sat_open: so, sat_close: sc });
  const ls = intIn(row.lunch_start, 0, 23), le = intIn(row.lunch_end, 1, 24);
  if (ls !== null && le !== null && le > ls) { slots.lunch_start = ls; slots.lunch_end = le; }
  else { slots.lunch_start = null; slots.lunch_end = null; }
  if (Number(row.rate_per_hour) > 0) slots.rate_per_hour = Number(row.rate_per_hour);
  return true;
}

export async function loadSlotSettings() {
  try {
    const r = await supabase.from('shared_collection_slot_settings').select('*').eq('id', 1).maybeSingle();
    return applySlotRow(r && r.data);
  } catch (e) {
    console.warn('slot settings:', e);
    return false;
  }
}

export function hasLunch() { return slots.lunch_start !== null && slots.lunch_end !== null; }
export function isLunch(h) { return hasLunch() && h >= slots.lunch_start && h < slots.lunch_end; }
export function crossesLunch(startH, endH) { return hasLunch() && startH < slots.lunch_end && endH > slots.lunch_start; }

/* Every open hour of a day of the week, lunch included (0 Sunday). */
export function dayHours(dow) {
  if (dow === 0) return [];
  const a = dow === 6 ? slots.sat_open : slots.weekday_open;
  const b = dow === 6 ? slots.sat_close : slots.weekday_close;
  const out = [];
  for (let h = a; h < b; h++) out.push(h);
  return out;
}
/* The hours that can be booked: lunch taken out. */
export function bookableHours(dow) { return dayHours(dow).filter((h) => !isLunch(h)); }
export function closingHour(dow) { return dow === 6 ? slots.sat_close : slots.weekday_close; }
export function hoursNeeded(qty) { return Math.max(1, Math.ceil((Number(qty) || 0) / slots.rate_per_hour)); }
export function lunchLabel(fmt) { return hasLunch() ? fmt(slots.lunch_start) + ' to ' + fmt(slots.lunch_end) : ''; }
