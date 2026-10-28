/*
 * Synthetic Signal Desk: alert checker.
 *
 * Runs on a schedule (see .github/workflows/alerts.yml), with no page open.
 * Each run it:
 *   1. downloads recent candles from Deriv's public price feed,
 *   2. runs the same signal engine as the bot (signal-core.js),
 *   3. sends a Telegram message for every new signal on a closed candle,
 *   4. remembers the last candle it checked, so nothing is sent twice.
 *
 * Settings: alerts.json (copy it from the bot's Alerts tab).
 * Secrets (GitHub → Settings → Secrets and variables → Actions):
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * Without the secrets it still runs and prints the signals in the log.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const core = require("./signal-core.js");

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, "alerts.json");
const STATE_FILE = path.join(ROOT, ".alert-state", "state.json");
const TEST = process.env.ALERT_TEST === "1" || process.env.ALERT_TEST === "true";
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const CHAT = (process.env.TELEGRAM_CHAT_ID || "").trim();
const TELEGRAM_API = process.env.TELEGRAM_API || "https://api.telegram.org";
const ENDPOINTS = process.env.DERIV_WS_URL
  ? [process.env.DERIV_WS_URL]
  : [
      "wss://api-core.deriv.com/options/v1/ws/public",
      "wss://api.derivws.com/trading/v1/options/ws/public",
      "wss://ws.derivws.com/websockets/v3?app_id=1089",
      "wss://ws.binaryws.com/websockets/v3?app_id=1089",
    ];
const TF_NAME = { 60: "1m", 300: "5m", 900: "15m", 3600: "1h", 14400: "4h", 86400: "1d" };

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

/* ---------- Deriv connection ---------- */
function openSocket(url) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
    const t = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("no answer within 10 s")); }, 10000);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error("connection refused")); };
  });
}
async function connect() {
  const fails = [];
  for (const url of ENDPOINTS) {
    try { const ws = await openSocket(url); log("Connected to", url); return client(ws); }
    catch (e) { fails.push(`${url}: ${e.message}`); }
  }
  throw new Error("Couldn't reach Deriv.\n" + fails.join("\n"));
}
function client(ws) {
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    const w = m.req_id != null && waiting.get(m.req_id);
    if (w) { waiting.delete(m.req_id); clearTimeout(w.t); w.resolve(m); }
  };
  return {
    request(obj) {
      return new Promise((resolve, reject) => {
        const req_id = ++id;
        const t = setTimeout(() => { waiting.delete(req_id); reject(new Error("Deriv didn't answer within 20 s")); }, 20000);
        waiting.set(req_id, { resolve, t });
        ws.send(JSON.stringify({ ...obj, req_id }));
      });
    },
    close() { try { ws.close(); } catch (e) {} },
  };
}
async function getCandles(api, symbol, tf) {
  const m = await api.request({ ticks_history: symbol, style: "candles", count: 1000, end: "latest", granularity: tf, adjust_start_time: 1 });
  if (m.error) throw new Error(`${symbol}: ${m.error.message || m.error.code}`);
  const bars = (m.candles || []).map((c) => ({ t: +(c.epoch ?? c.open_time), o: +c.open, h: +c.high, l: +c.low, c: +c.close }))
    .filter((b) => [b.t, b.o, b.h, b.l, b.c].every(Number.isFinite));
  // Drop the candle that is still forming: signals only count on closed candles.
  const now = Date.now() / 1000;
  while (bars.length && bars[bars.length - 1].t + tf > now) bars.pop();
  const dec = m.pip_size != null ? (Number(m.pip_size) >= 1 ? Number(m.pip_size) : Math.max(0, Math.round(-Math.log10(Number(m.pip_size))))) : 3;
  return { bars, dec };
}

/* ---------- Telegram ---------- */
async function telegram(text) {
  if (!TOKEN || !CHAT) { log("(Telegram not set up, message not sent)\n" + text.replace(/<[^>]+>/g, "")); return false; }
  const r = await fetch(`${TELEGRAM_API}/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Telegram refused the message (${r.status}). Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, and that you have pressed Start in your bot's chat. ${body.slice(0, 200)}`);
  }
  return true;
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const fmt = (v, d) => Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
const when = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/* ---------- main ---------- */
function loadJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; } }

async function main() {
  const cfg = loadJSON(CONFIG_FILE, null);
  if (!cfg || !Array.isArray(cfg.markets) || !Array.isArray(cfg.strategies)) throw new Error("alerts.json is missing or not valid. Copy it from the bot's Alerts tab.");
  const strategies = cfg.strategies.map((s, k) => ({ ...core.cleanRules(s), id: String(s.id || "s" + k), name: String(s.name || "Strategy " + (k + 1)) }))
    .filter((s) => s.buy.length || s.sell.length);
  if (!strategies.length) throw new Error("alerts.json has no strategies with rules.");
  const state = loadJSON(STATE_FILE, {});
  const api = await connect();
  let sent = 0, found = 0;
  const summary = [];
  try {
    for (const mk of cfg.markets) {
      const symbol = String(mk.symbol), tf = Number(mk.timeframe) || 3600, name = mk.name || symbol, tfName = TF_NAME[tf] || tf + "s";
      const { bars, dec } = await getCandles(api, symbol, tf);
      if (bars.length < 60) { log(`${name} ${tfName}: only ${bars.length} closed candles, skipped`); continue; }
      const last = bars.length - 1, eng = core.makeEngine(bars), A = eng.series({ t: "atr" });
      const key = `${symbol}|${tf}`;
      if (TEST) summary.push(`<b>${esc(name)} · ${tfName}</b>: last closed candle ${when(bars[last].t)} at ${fmt(bars[last].c, dec)}`);
      // First run for this market: only the newest closed candle counts, so old history isn't sent.
      const since = state[key] != null ? state[key] : bars[last - 1].t;
      for (const st of strategies) {
        const sigs = eng.signals(st, last);
        const latest = sigs[sigs.length - 1];
        if (TEST) summary.push(esc(`${st.name}: ${latest ? `last ${latest.dir > 0 ? "BUY" : "SELL"} on the candle at ${when(bars[latest.i].t)}` : "no signal in the loaded history"}`));
        for (const s of sigs) {
          const b = bars[s.i];
          if (b.t <= since) continue;
          found++;
          const lv = core.exitLevels(st, s.dir, b.c, A[s.i], s.stop);
          const text = [
            `<b>${s.dir > 0 ? "🟢 BUY" : "🔴 SELL"} · ${esc(name)} · ${tfName}</b>`,
            esc(st.name),
            `Entry ≈ ${fmt(b.c, dec)}` + (lv ? `\nSL ${fmt(lv.sl, dec)} · TP ${fmt(lv.tp, dec)}` : ""),
            `Candle closed ${when(b.t + tf)}`,
          ].join("\n");
          log(`Signal: ${st.name} ${s.dir > 0 ? "BUY" : "SELL"} ${name} ${tfName} at ${when(b.t)}`);
          if (await telegram(text)) sent++;
        }
      }
      state[key] = bars[last].t;
      log(`${name} ${tfName}: checked up to ${when(bars[last].t)} (${fmt(bars[last].c, dec)})`);
    }
  } finally { api.close(); }
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  if (TEST) {
    await telegram(["✅ <b>Synthetic Signal Desk alerts are working.</b>", summary.join("\n"),
      "From now on you'll get a message whenever a strategy signals on a closed candle."].join("\n\n"));
  }
  log(`Done. ${found} new signal${found === 1 ? "" : "s"}, ${sent} message${sent === 1 ? "" : "s"} sent.`);
}

main().catch((e) => { console.error("Alert check failed: " + e.message); process.exit(1); });
