/**
 * Getting the day's rates, and remembering them.
 *
 * The app is offline-first, so rates are the one thing in it that needs the
 * network. The contract is: show what was last fetched immediately, say when
 * it is from, and go and look for something newer. Never block the screen on
 * a request, and never present a stale number as though it were today's.
 *
 * Two sources, tried in order. They are public, keyless and CORS-enabled —
 * this app has no server to hide a key behind, so an API that needs one is no
 * use to it. The second is there because a rates screen that cannot reach its
 * one source is a dead screen.
 */

import { fromFrankfurter, fromOpenExchange, DEFAULT_BASE } from './rates.js';

export const SOURCES = [
  {
    name: 'ECB',
    // The European Central Bank's daily reference rates, published each
    // working day; on a weekend the latest is Friday's, and says so.
    url: `https://api.frankfurter.dev/v1/latest?base=${DEFAULT_BASE}`,
    read: fromFrankfurter,
  },
  {
    name: 'exchangerate-api',
    url: `https://open.er-api.com/v6/latest/${DEFAULT_BASE}`,
    read: fromOpenExchange,
  },
];

const KEY = 'calcutron.rates';
const TIMEOUT = 8000;
/** Below this, the rates on screen are as new as anything worth fetching. */
const FRESH_FOR = 30 * 60 * 1000;

export class Exchange {
  constructor({
    storage = safeStorage(),
    fetcher = globalThis.fetch?.bind(globalThis),
    now = () => Date.now(),
    sources = SOURCES,
  } = {}) {
    this.storage = storage;
    this.fetcher = fetcher;
    this.now = now;
    this.sources = sources;
    this.inFlight = null;
  }

  /** The last rates fetched, or null if this device has never had any. */
  read() {
    try {
      const saved = JSON.parse(this.storage?.getItem(KEY) ?? 'null');
      if (!saved || typeof saved !== 'object') return null;
      const checked = fromFrankfurter(saved);
      if (!checked) return null;
      return { ...checked, source: String(saved.source ?? ''), fetchedAt: Number(saved.fetchedAt) || 0 };
    } catch {
      return null;
    }
  }

  /** True when what is stored is new enough that fetching again is noise. */
  isFresh() {
    const saved = this.read();
    return Boolean(saved) && this.now() - saved.fetchedAt < FRESH_FOR;
  }

  /**
   * Try each source until one answers with something believable. Concurrent
   * callers share the one request rather than racing.
   *
   * @returns {Promise<object|null>} the new snapshot, or null if none answered
   */
  refresh() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.attempt().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async attempt() {
    for (const source of this.sources) {
      const snapshot = await this.ask(source);
      if (!snapshot) continue;

      const stored = { ...snapshot, source: source.name, fetchedAt: this.now() };
      try {
        this.storage?.setItem(KEY, JSON.stringify(stored));
      } catch {
        // No storage to remember it in; the rates still work for this session.
      }
      return stored;
    }
    return null;
  }

  async ask(source) {
    if (!this.fetcher) return null;

    // A request left hanging would leave the screen saying "checking" forever.
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = abort ? setTimeout(() => abort.abort(), TIMEOUT) : null;

    try {
      const response = await this.fetcher(source.url, {
        signal: abort?.signal,
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (!response?.ok) return null;
      return source.read(await response.json());
    } catch {
      // Offline, blocked, timed out, or nonsense on the wire: try the next.
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;   // Private browsing can make even touching it throw.
  }
}
