/* THE AL BALANCE, WORKED OUT THE WAY THE OFFICE BOOKING PAGE WORKS IT OUT.

   balance = quantity_ordered
             minus the total_qty of every DO on that AL number
             that is not Cancelled and carries no [CANCELLED] in its remark

   The original is fetchData() in mjm-ai-system/operation/operation_booking.html,
   and the database holds the same rule in shared/RUN_ME_al_balance_is_the_dos.sql
   (al_delivered_qty), which keeps shared_al_orders.balance_quantity equal to it
   on every write. Change one, change all three.

   The stored balance_quantity used to be written by six screens as "the old
   figure minus this DO", so a stale read anywhere left it wrong — 82 of 429
   ALs on 25 Nov 2026, 81 of them too high, and these pages showed it. So the
   pages work it out from the DOs themselves.

   IT FAILS BACK TO THE STORED FIGURE. With no line, or a refused read, the
   rows keep the balance_quantity they came with — which the database trigger
   keeps right — rather than reading as nought and emptying the list. */

export function doCounts(d) {
  return !!d && d.status !== 'Cancelled' && !String(d.remark || '').includes('[CANCELLED]');
}

export function balanceFrom(al, delivered) {
  return (Number(al && al.quantity_ordered) || 0) - (Number(delivered) || 0);
}

/* Total delivered per AL number, for the AL numbers asked about. Paged and
   chunked, because PostgREST stops at 1,000 rows and says nothing. Answers
   null when any read fails, so the caller keeps the stored figure. */
export async function deliveredByAl(supabase, alNumbers) {
  const wanted = [...new Set((alNumbers || []).filter(Boolean).map(String))];
  const sums = new Map(wanted.map((a) => [a, 0]));
  if (!wanted.length) return sums;
  const CHUNK = 150, PAGE = 1000;
  try {
    for (let i = 0; i < wanted.length; i += CHUNK) {
      const part = wanted.slice(i, i + CHUNK);
      for (let from = 0; from < 100000; from += PAGE) {
        const { data, error } = await supabase
          .from('shared_do_records')
          .select('id,al_number,total_qty,status,remark')
          .in('al_number', part)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) return null;
        (data || []).forEach((d) => {
          if (!doCounts(d)) return;
          const k = String(d.al_number);
          if (sums.has(k)) sums.set(k, sums.get(k) + (Number(d.total_qty) || 0));
        });
        if (!data || data.length < PAGE) break;
      }
    }
  } catch (_) {
    return null;
  }
  return sums;
}

/* The rows with balance_quantity worked out from the DOs. The figure the
   database stored rides along as _storedBalance, for anybody comparing. */
export async function withLiveBalance(supabase, rows) {
  const list = rows || [];
  if (!list.length) return list;
  const sums = await deliveredByAl(supabase, list.map((r) => r.al_number));
  if (!sums) return list;
  return list.map((r) => ({
    ...r,
    _storedBalance: r.balance_quantity,
    balance_quantity: balanceFrom(r, sums.get(String(r.al_number)) || 0),
  }));
}

/* Every row a query answers, paged past PostgREST's 1,000. `make` builds the
   query afresh for each page; it must carry an order. Answers the first error as
   { data: null, error }, the shape a single read answers, so callers are unchanged. */
export async function readAllRows(make) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; from < 100000; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}
