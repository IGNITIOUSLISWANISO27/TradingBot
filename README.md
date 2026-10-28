# Synthetic Signal Desk

Price-action signal bot for Deriv synthetic indices: fair value gaps, order blocks,
Fibonacci retracement, support and resistance, trading sessions, backtests and
TradingView export.

This folder holds two things that live in the same GitHub repository:

1. **The Streamlit app**, the bot page you open in a browser.
2. **Phone alerts**, a free GitHub schedule that checks Deriv every 5 minutes and
   sends new signals to Telegram, even when the Streamlit app is asleep and your
   computer is off.

## Files

| File | What it is |
| --- | --- |
| `app.py` | The Streamlit app. It shows the bot full-window. |
| `signal_desk.html` | The bot itself. |
| `requirements.txt` | Tells Streamlit Cloud to install Streamlit. |
| `.streamlit/config.toml` | Dark theme to match the bot. |
| `alert-worker.js` | The alert checker that GitHub runs every 5 minutes. |
| `signal-core.js` | The signal engine, the same code the bot page uses. |
| `alerts.json` | Which market, timeframe and strategies to alert on. |
| `.github/workflows/alerts.yml` | The 5-minute schedule. |

---

## Part 1: put the bot online with Streamlit

1. Create a free account at github.com.
2. Create a new **public** repository, for example `signal-desk` (Part 2 explains why public).
3. Upload everything in this folder. GitHub's upload page skips folders whose names
   start with a dot, so add those two files by hand:
   - **Add file → Create new file**, name it `.streamlit/config.toml`, paste its contents, commit.
   - **Add file → Create new file**, name it `.github/workflows/alerts.yml`, paste its contents, commit.
4. Go to share.streamlit.io and sign in with GitHub.
5. Choose **Create app**, then **Deploy a public app from GitHub**. Pick your
   repository, branch `main` and main file `app.py`, then **Deploy**.
6. A minute or two later the bot is live at `https://<your-name>.streamlit.app`.

To try it on your computer first: `pip install -r requirements.txt`, then `streamlit run app.py`.

---

## Part 2: phone alerts with Telegram

### 1. Make a Telegram bot (2 minutes)

1. In Telegram, open a chat with **@BotFather** and send `/newbot`.
2. Give it a name and a username ending in `bot`. BotFather replies with a
   **token** like `123456789:AAH...`. Keep it private.
3. Open a chat with your new bot and press **Start**, then send it any message.
4. In a browser, open `https://api.telegram.org/bot<your token>/getUpdates`.
   Find `"chat":{"id":` followed by a number. That number is your **chat ID**.

### 2. Give GitHub the token and chat ID

In your repository: **Settings → Secrets and variables → Actions → New repository secret**.
Add two secrets:

| Name | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `TELEGRAM_CHAT_ID` | your chat ID |

Secrets stay hidden, even in a public repository.

### 3. Choose what to alert on

`alerts.json` starts with Volatility 15 (1s) Index on 1h and all five built-in strategies.
To change it, open the bot, pick the market and timeframe, turn on the strategies you
want, then go to **Alerts → Copy alert settings**. In GitHub, open `alerts.json`, press
the pencil icon, replace everything with what you copied, and commit.

To watch several markets, add more entries under `"markets"`, for example:

```json
"markets": [
  { "symbol": "1HZ15V", "name": "Volatility 15 (1s) Index", "timeframe": 3600 },
  { "symbol": "R_75",   "name": "Volatility 75 Index",      "timeframe": 900 }
]
```

Timeframes are in seconds: 60, 300, 900, 3600, 14400 or 86400.

### 4. Switch it on and send a test

1. In your repository open the **Actions** tab. If GitHub asks, press
   **I understand my workflows, go ahead and enable them**.
2. Choose **Signal alerts** on the left, then **Run workflow → Run workflow**.
3. Within a minute your Telegram bot sends **"Synthetic Signal Desk alerts are working"**
   with the latest price and each strategy's last signal.

If the test fails, open the run in the Actions tab to read the error. The most common
causes are a wrong token or chat ID, or not having pressed **Start** in your bot's chat.

From then on GitHub checks every 5 minutes. Each alert looks like this:

```
🟢 BUY · Volatility 15 (1s) Index · 1h
Order block retest
Entry ≈ 13,617.131
SL 13,578.423 · TP 13,694.546
Candle closed 2026-10-28 02:00 UTC
```

### Good to know

- **Cost.** GitHub Actions is free and unlimited for public repositories. A private
  repository gets 2,000 free minutes a month, and checking every 5 minutes uses about
  8,600. If you make the repository private, change `*/5` to `*/30` in `alerts.yml`.
- **Timing.** GitHub starts scheduled checks late when it is busy, usually by a few
  minutes, sometimes longer. Alerts suit the 15m timeframe and above. Late checks still
  catch every signal, because each run picks up from the last candle it checked.
- **60-day rule.** GitHub pauses schedules in public repositories after 60 days without
  any change to the repository. If alerts stop, open the Actions tab and re-enable
  the workflow, or commit any small change.
- **Updating the bot.** When you get a new `signal_desk.html`, also update `signal-core.js`
  so alerts follow the same rules: in the bot, **Alerts → Copy signal engine**, then
  paste it over `signal-core.js` in GitHub.
- **Only Deriv's public markets.** The checker uses Deriv's public price feed, the same
  one the bot uses. The 2-second Volatility 15 Index isn't on that feed. For that market,
  use TradingView alerts from the bot's **Use in TradingView** script.
- **Streamlit details.** Free Streamlit apps can be private, and they sleep after some
  days without visitors. Sleeping doesn't affect phone alerts. Strategies and settings
  are saved in your own browser.
- **Not trading advice.** The bot and the alerts read prices and report signals. They
  never place trades.
