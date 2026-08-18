/**
 * The calculation history.
 *
 * Entries are held newest-first and mirrored into storage, so the list
 * survives a relaunch. Storage is injected rather than reached for directly,
 * which is what lets the tests drive this without a browser.
 */

const STORAGE_KEY = 'calcutron.history';
const LIMIT = 100;

/** localStorage, or a working stand-in when it is unavailable. */
function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem(STORAGE_KEY); // Private browsing throws here.
      return localStorage;
    }
  } catch {
    /* fall through */
  }
  const memory = new Map();
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, v),
  };
}

export class History {
  constructor({ storage = defaultStorage(), limit = LIMIT } = {}) {
    this.storage = storage;
    this.limit = limit;
    this.serial = 0;
    this.entries = this.read();
  }

  /** Newest first. */
  list() {
    return this.entries;
  }

  get length() {
    return this.entries.length;
  }

  newest() {
    return this.entries[0] ?? null;
  }

  add({ tokens, expression, result }) {
    const entry = {
      id: `${Date.now().toString(36)}-${(this.serial += 1).toString(36)}`,
      tokens: structuredCopy(tokens),
      expression,
      result,
      favourite: false,
    };
    this.entries.unshift(entry);
    this.trim();
    this.write();
    return entry;
  }

  find(id) {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  toggleFavourite(id) {
    const entry = this.find(id);
    if (!entry) return null;
    entry.favourite = !entry.favourite;
    this.write();
    return entry;
  }

  /**
   * Clearing keeps starred entries — that is what starring is for. Unstar an
   * entry first if it should go.
   */
  clear() {
    this.entries = this.entries.filter((entry) => entry.favourite);
    this.write();
    return this.entries;
  }

  /**
   * Oldest unstarred entries fall off the end once past the limit. Index 0 is
   * excluded: it is the entry that was just added, and dropping it would make
   * a calculation vanish the moment it was made.
   */
  trim() {
    let excess = this.entries.length - this.limit;
    if (excess <= 0) return;
    for (let i = this.entries.length - 1; i >= 1 && excess > 0; i -= 1) {
      if (this.entries[i].favourite) continue;
      this.entries.splice(i, 1);
      excess -= 1;
    }
  }

  read() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isEntry);
    } catch {
      return []; // Corrupt or unreadable storage starts from empty.
    }
  }

  write() {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      /* Out of quota or blocked; the in-memory list still works this session. */
    }
  }
}

/** Guard against anything malformed that made it into storage. */
function isEntry(value) {
  return Boolean(value)
    && typeof value.id === 'string'
    && typeof value.expression === 'string'
    && Array.isArray(value.tokens)
    && (typeof value.result === 'number' || typeof value.result === 'string');
}

function structuredCopy(tokens) {
  return tokens.map((token) => ({ ...token }));
}
