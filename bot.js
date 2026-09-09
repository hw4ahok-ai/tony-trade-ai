const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY = process.env.DRY_RUN !== 'false';

if (!URL || !KEY) throw new Error('Missing Supabase secrets');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

async function getJson(url) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(20000)
  });

  if (!r.ok) {
    throw new Error('HTTP ' + r.status + ' ' + url);
  }

  const data = await r.json();

  if (data.retCode !== 0) {
    throw new Error('Bybit retCode ' + data.retCode + ': ' + data.retMsg);
  }

  return data;
}

async function getDailyCandles(symbol) {
  const url =
    'https://api.bybit.com/v5/market/kline' +
    '?category=spot' +
    '&symbol=' + symbol +
    '&interval=D' +
    '&limit=40';

  const data = await getJson(url);
  const rows = data?.result?.list;

  if (!Array.isArray(rows) || rows.length < 25) {
    throw new Error('Insufficient candles');
  }

  const now = Date.now();

  let candles = rows
    .map(x => ({
      t: Number(x[0]),
      o: Number(x[1]),
      h: Number(x[2]),
      l: Number(x[3]),
      c: Number(x[4])
    }))
    .sort((a, b) => a.t - b.t);

  // Candle harian Bybit terbaru dapat masih berjalan.
  // Hanya pakai candle yang sudah selesai.
  candles = candles.filter(x => x.t + 86400000 <= now);

  if (candles.length < 25) {
    throw new Error('Insufficient completed candles');
  }

  for (let i = 0; i < candles.length; i++) {
    const x = candles[i];

    if (
      ![x.o, x.h, x.l, x.c].every(v => Number.isFinite(v) && v > 0) ||
      x.h < Math.max(x.o, x.c, x.l) ||
      x.l > Math.min(x.o, x.c, x.h)
    ) {
      throw new Error('Invalid OHLC');
    }

    if (i && x.t - candles[i - 1].t !== 86400000) {
      throw new Error('Daily gap');
    }
  }

  return candles;
}

async function getLivePrice(symbol) {
  const url =
    'https://api.bybit.com/v5/market/tickers' +
    '?category=spot' +
    '&symbol=' + symbol;

  const data = await getJson(url);
  const ticker = data?.result?.list?.[0];

  if (!ticker) {
    throw new Error('Ticker missing');
  }

  const price = Number(ticker.lastPrice);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Invalid market price');
  }

  return price;
}

async function run(symbol) {
  const b = await getDailyCandles(symbol);

  const last = b.at(-1);
  const i = b.length - 1;

  const hi = Math.max(...b.slice(i - 20, i).map(x => x.h));
  const lo = Math.min(...b.slice(i - 10, i).map(x => x.l));

  const side =
    last.c > hi ? 'BUY' :
    last.c < lo ? 'SELL' :
    'HOLD';

  const date = new Date(last.t).toISOString().slice(0, 10);

  const reason =
    side === 'BUY'
      ? 'Close > previous 20-day high'
      : side === 'SELL'
      ? 'Close < previous 10-day low'
      : 'No entry or exit';

  const market = await getLivePrice(symbol);

  const payload = {
    p_symbol: symbol,
    p_date: date,
    p_signal: side,
    p_close: last.c,
    p_reason: reason,
    p_market: market,
    p_execution_time: new Date().toISOString()
  };

  if (DRY) {
    console.log(
      'DRY RUN',
      symbol,
      date,
      side,
      'close',
      last.c,
      'market',
      market
    );
    return;
  }

  const r = await fetch(
    URL + '/rest/v1/rpc/apply_paper_signal',
    {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    }
  );

  if (!r.ok) {
    throw new Error(
      'Supabase RPC ' + r.status + ' ' + await r.text()
    );
  }

  console.log(symbol, await r.json());
}

(async () => {
  for (const symbol of SYMBOLS) {
    try {
      await run(symbol);
    } catch (e) {
      console.error(symbol, e);
      process.exitCode = 1;
    }
  }
})();
