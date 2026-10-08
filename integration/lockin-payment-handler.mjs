// Deployment preparation. Not live until Supabase and Stripe are configured.
export const PAYMENT_LINK = 'plink_1UNw2VCnsMOrVdOI0VKJMttK';
export const COHORT = '2026-10-12_2026-12-20';

export async function verifySignature(body, header, secret, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = header.split(',').map(p => p.trim().split('='));
  const timestamp = parts.find(p => p[0] === 't')?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['verify']);
  const bytes = new TextEncoder().encode(`${timestamp}.${body}`);
  for (const [, value] of parts.filter(p => p[0] === 'v1')) {
    if (!/^[a-fA-F0-9]{64}$/.test(value ?? '')) continue;
    const signature = Uint8Array.from(value.match(/../g), x => parseInt(x, 16));
    if (await crypto.subtle.verify('HMAC', key, signature, bytes)) return true;
  }
  return false;
}

export function paidSession(event) {
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event?.type)) return null;
  const s = event.data?.object;
  if (event.livemode !== true || s?.livemode !== true || s.payment_link !== PAYMENT_LINK || s.payment_status !== 'paid' || s.status !== 'complete' || s.mode !== 'payment' || s.currency !== 'usd' || s.amount_total !== 5000 || s.metadata?.cohort !== COHORT || s.metadata?.programme !== '10-Week Lock-In') return null;
  const email = s.customer_details?.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !s.id?.startsWith('cs_live_')) throw new Error('Paid session missing usable identity');
  return {session_id:s.id, payment_intent:s.payment_intent, email, name:s.customer_details?.name ?? '', event_id:event.id};
}

export function createHandler(env, fetcher = fetch) {
  async function rpc(name, args) {
    const res = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {method:'POST', headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json'}, body:JSON.stringify(args)});
    if (!res.ok) throw new Error(`Database operation failed: ${res.status}`);
    return res.json();
  }
  return async req => {
    if (req.method !== 'POST') return new Response('Method not allowed', {status:405});
    if (['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','STRIPE_WEBHOOK_SECRET'].some(k => !env[k])) return new Response('Configuration required', {status:503});
    const raw = await req.text();
    if (!await verifySignature(raw, req.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET)) return new Response('Invalid signature', {status:400});
    try {
      const event = JSON.parse(raw);
      const payment = paidSession(event);
      if (!payment) return Response.json({ignored:true});
      // Persists paid status before email delivery; sales worker must check this table.
      const claimed = await rpc('claim_lockin_confirmation', {p_session:payment.session_id,p_email:payment.email,p_name:payment.name,p_intent:payment.payment_intent,p_event:payment.event_id});
      if (claimed.state === 'sent') return Response.json({already_sent:true});
      if (claimed.state !== 'claimed') return new Response('Confirmation pending; retry or reconcile delivery', {status:503});
      // Payload is fixed for a session, including during retries.
      const res = await fetcher('https://api.resend.com/emails', {method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`lockin-confirmation-${payment.session_id}`},body:JSON.stringify({from:'Bailey at The Paid Squad <lockin@paid-squad.com>',reply_to:'baleseng.ram@gmail.com',to:[payment.email],subject:'Your US$50 Lock-In place is confirmed',template:{id:'a7bde0fe-fc32-4897-8c1b-ab06b0679e8a'}}),signal:AbortSignal.timeout(20000)});
      if (!res.ok) throw new Error(`Email provider failed: ${res.status}`);
      const data = await res.json();
      if (!data.id) throw new Error('Missing email message ID');
      await rpc('complete_lockin_confirmation', {p_session:payment.session_id,p_message:data.id});
      return Response.json({accepted:true});
    } catch {
      // Never log request bodies, addresses, or secrets. Non-2xx asks Stripe to retry.
      return new Response('Confirmation processing failed', {status:503});
    }
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(createHandler(Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','STRIPE_WEBHOOK_SECRET'].map(k => [k,Deno.env.get(k)]))));
}
