"""Synthetic Signal Desk on Streamlit.

The bot itself is the self-contained page in signal_desk.html. It runs in the
visitor's browser and connects to Deriv's public price feed directly, so this
app only has to serve the page. Nothing here talks to Deriv or stores data.
"""
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="Synthetic Signal Desk",
    page_icon=":material/candlestick_chart:",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Let the bot use the whole window: drop Streamlit's header, footer and padding.
st.markdown(
    """
    <style>
      header[data-testid="stHeader"] {display: none;}
      footer {visibility: hidden;}
      .block-container {padding: 0.25rem 0.25rem 0 0.25rem; max-width: 100%;}
      /* Size the bot to the browser window and let it scroll inside,
         so its pop-ups open where you are looking. */
      iframe {border: 0; height: calc(100vh - 0.5rem) !important;}
    </style>
    """,
    unsafe_allow_html=True,
)

HTML_FILE = Path(__file__).parent / "signal_desk.html"


@st.cache_data
def load_page(path: str, modified: float) -> str:
    # `modified` makes the cache refresh when you replace signal_desk.html.
    return Path(path).read_text(encoding="utf-8")


page = load_page(str(HTML_FILE), HTML_FILE.stat().st_mtime)

# The height here is a fallback; the style above stretches the frame to the window.
components.html(page, height=900, scrolling=True)
