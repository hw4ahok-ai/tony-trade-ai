const URL=process.env.SUPABASE_URL,KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY=process.env.DRY_RUN!=='false';
if(!URL||!KEY)throw Error('Missing Supabase secrets');
async function get(url){const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json()}
async function run(symbol){
 const raw=await get('https://api.binance.com/api/v3/klines?symbol='+symbol+'&interval=1d&limit=40');
 const b=raw.filter(x=>x[6]<Date.now()).map(x=>({t:x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4]}));
 if(b.length<25)throw Error('Insufficient candles');
 for(let i=0;i<b.length;i++){const x=b[i];if(![x.o,x.h,x.l,x.c].every(v=>Number.isFinite(v)&&v>0)||x.h<Math.max(x.o,x.c,x.l)||x.l>Math.min(x.o,x.c,x.h))throw Error('Invalid OHLC');if(i&&x.t-b[i-1].t!==86400000)throw Error('Daily gap')}
 const last=b.at(-1),i=b.length-1,hi=Math.max(...b.slice(i-20,i).map(x=>x.h)),lo=Math.min(...b.slice(i-10,i).map(x=>x.l));
 const side=last.c>hi?'BUY':last.c<lo?'SELL':'HOLD',date=new Date(last.t).toISOString().slice(0,10);
 const reason=side==='BUY'?'Close > previous 20-day high':side==='SELL'?'Close < previous 10-day low':'No entry or exit';
 const ticker=await get('https://api.binance.com/api/v3/ticker/price?symbol='+symbol),market=+ticker.price;
 if(!Number.isFinite(market)||market<=0)throw Error('Invalid market price');
 const payload={p_symbol:symbol,p_date:date,p_signal:side,p_close:last.c,p_reason:reason,p_market:market,p_execution_time:new Date().toISOString()};
 if(DRY){console.log('DRY RUN',JSON.stringify(payload));return}
 const r=await fetch(URL+'/rest/v1/rpc/apply_paper_signal',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('RPC '+r.status+' '+await r.text());console.log(symbol,await r.json())
}
(async()=>{for(const s of ['BTCUSDT','ETHUSDT','SOLUSDT']){try{await run(s)}catch(e){console.error(s,e);process.exitCode=1}}})();
