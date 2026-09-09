const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY = process.env.DRY_RUN !== 'false';

if (!URL || !KEY) {
  throw new Error('Missing Supabase secrets');
}

const SYMBOLS = {
  BTCUSDT: 'XBTUSDT',
  ETHUSDT: 'ETHUSDT',
  SOLUSDT: 'SOLUSDT'
};

async function getJson(url) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent': 'TONY-TRADE-AI/3.6.2'
    }
  });

  if (!r.ok) {
    throw new Error('HTTP ' + r.status + ' ' + url);
  }

  const data = await r.json();

  if (Array.isArray(data.error) && data.error.length) {
    throw new Error('Kraken API: ' + data.error.join(', '));
  }

  return data;
}

function getResultKey(result) {
  return Object.keys(result).find(k => k !== 'last');
}

async function getDailyCandles(krakenPair) {
  const url =
    'https://api.kraken.com/0/public/OHLC' +
    '?pair=' + encodeURIComponent(krakenPair) +
    '&interval=1440';

  const data = await getJson(url);
  const key = getResultKey(data.result || {});

  if (!key) {
    throw new Error('OHLC pair key missing');
  }

  const rows = data.result[key];

  if (!Array.isArray(rows) || rows.length < 26) {
    throw new Error('Insufficient candles');
  }

  // Kraken selalu menyertakan candle timeframe yang sedang berjalan.
  // Buang baris terakhir.
  const completed = rows.slice(0, -1);

  const candles = completed
    .map(x => ({
      t: Number(x[0]) * 1000,
      o: Number(x[1]),
      h: Number(x[2]),
      l: Number(x[3]),
      c: Number(x[4])
    }))
    .sort((a, b) => a.t - b.t);

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

async function getLivePrice(krakenPair) {
  const url =
    'https://api.kraken.com/0/public/Ticker' +
    '?pair=' + encodeURIComponent(krakenPair);

  const data = await getJson(url);
  const key = getResultKey(data.result || {});

  if (!key) {
    throw new Error('Ticker pair key missing');
  }

  const ticker = data.result[key];
  const price = Number(ticker?.c?.[0]);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Invalid market price');
  }

  return price;
}

async function run(symbol) {
  const krakenPair = SYMBOLS[symbol];

  const b = await getDailyCandles(krakenPair);

  const last = b.at(-1);
  const i = b.length - 1;

  const hi = Math.max(
    ...b.slice(i - 20, i).map(x => x.h)
  );

  const lo = Math.min(
    ...b.slice(i - 10, i).map(x => x.l)
  );

  const side =
    last.c > hi
      ? 'BUY'
      : last.c < lo
      ? 'SELL'
      : 'HOLD';

  const date = new Date(last.t)
    .toISOString()
    .slice(0, 10);

  const reason =
    side === 'BUY'
      ? 'Close > previous 20-day high'
      : side === 'SELL'
      ? 'Close < previous 10-day low'
      : 'No entry or exit';

  const market = await getLivePrice(krakenPair);

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
      'KrakenPair',
      krakenPair,
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
      'Supabase RPC ' +
      r.status +
      ' ' +
      await r.text()
    );
  }

  console.log(
    symbol,
    await r.json()
  );
}

(async () => {
  for (const symbol of Object.keys(SYMBOLS)) {
    try {
      await run(symbol);
    } catch (e) {
      console.error(symbol, e);
      process.exitCode = 1;
    }
  }
})();
