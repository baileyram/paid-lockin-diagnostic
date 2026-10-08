import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifySignature,paidSession,createHandler,PAYMENT_LINK,COHORT} from './lockin-payment-handler.mjs';
const secret='test-only-not-a-live-secret';
async function sign(raw,t=Math.floor(Date.now()/1000)) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${t}.${raw}`));
  return `t=${t},v1=${Buffer.from(sig).toString('hex')}`;
}
const valid=()=>({id:'evt_test',livemode:true,type:'checkout.session.completed',data:{object:{id:'cs_live_fixture',payment_link:PAYMENT_LINK,livemode:true,payment_status:'paid',status:'complete',mode:'payment',currency:'usd',amount_total:5000,metadata:{cohort:COHORT,programme:'10-Week Lock-In'},customer_details:{email:'Member@Example.com'}}}});
test('tampered, expired and unsigned requests cannot be trusted',async()=>{
  const raw=JSON.stringify(valid()); const sig=await sign(raw);
  assert.equal(await verifySignature(raw,sig,secret),true);
  assert.equal(await verifySignature(raw+' ',sig,secret),false);
  assert.equal(await verifySignature(raw,await sign(raw,Math.floor(Date.now()/1000)-600),secret),false);
  assert.equal(await verifySignature(raw,null,secret),false);
});
test('unpaid, unrelated, test-mode and wrong-price sessions cannot fulfil',()=>{
  for (const mutation of [s=>s.payment_status='unpaid',s=>s.payment_link='other',s=>s.amount_total=4000,s=>s.currency='zar',s=>s.livemode=false,s=>s.metadata.cohort='old']) {
    const e=valid();mutation(e.data.object);assert.equal(paidSession(e),null);
  }
  const e=valid();e.type='checkout.session.async_payment_succeeded';assert.equal(paidSession(e).email,'member@example.com');
});
test('duplicate webhook never sends a second confirmation',async()=>{
  let sent=false,sends=0;
  const fetcher=async(url)=>{
    if(url.endsWith('claim_lockin_confirmation'))return Response.json({state:sent?'sent':'claimed'});
    if(url.endsWith('complete_lockin_confirmation')){sent=true;return Response.json({ok:true});}
    sends++;return Response.json({id:'email_fixture'});
  };
  const h=createHandler({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',RESEND_API_KEY:'test',STRIPE_WEBHOOK_SECRET:secret},fetcher);
  const raw=JSON.stringify(valid());const headers={'Stripe-Signature':await sign(raw)};
  assert.equal((await h(new Request('https://example.com',{method:'POST',body:raw,headers}))).status,200);
  assert.equal((await h(new Request('https://example.com',{method:'POST',body:raw,headers}))).status,200);
  assert.equal(sends,1);
});
test('provider failure asks Stripe to retry, never records success',async()=>{
  const calls=[];
  const h=createHandler({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',RESEND_API_KEY:'test',STRIPE_WEBHOOK_SECRET:secret},async url=>{calls.push(url);return url.includes('/rpc/')?Response.json({state:'claimed'}):new Response('',{status:500});});
  const raw=JSON.stringify(valid());const res=await h(new Request('https://example.com',{method:'POST',body:raw,headers:{'Stripe-Signature':await sign(raw)}}));
  assert.equal(res.status,503);assert.equal(calls.some(x=>x.endsWith('complete_lockin_confirmation')),false);
});
