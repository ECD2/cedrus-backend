// Prelude for the N1 admin-panel bundle. Concatenated after
// reliability-core.js and before the stripped src files:
//   src/utils/phone.js → src/routes/admin.js → (adminRouter glue)
//   → src/services/adminOps.js → src/routes/adminPanel.js.
//
// Provides the module doubles those files import: an express Router double
// (callable like the real thing, with use/get/post, :param extraction and
// query parsing), a `crypto` double whose timingSafeEqual RECORDS that it was
// invoked (the timing-safety proof hook), `config`, and a `logger` that
// captures every audit event for assertions. Also patches the
// reliability-core supabase double with the `.range()` pagination terminal
// that adminOps.listUsers uses.

// ── Buffer polyfill (jsc fallback only; bun/node have the real one) ────────
if (typeof Buffer === 'undefined') {
  globalThis.Buffer = {
    from(s) {
      const str = String(s);
      const arr = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xff;
      return arr;
    },
  };
}

// ── crypto double — constant-time-compare spy ──────────────────────────────
let __tseCalls = 0;
const crypto = {
  timingSafeEqual(a, b) {
    __tseCalls++;
    if (a.length !== b.length) throw new Error('timingSafeEqual: length mismatch');
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  },
};

// ── express Router double ──────────────────────────────────────────────────
// Mirrors the slice of Router the admin files use: router-level use(),
// get/post with a middleware chain per route, :param extraction, query-string
// parsing, fall-through to the outer `next` when nothing matches. The
// returned value is CALLABLE (req, res, next) exactly like a real Router, so
// adminOps.dispatchFounderAdmin works unchanged in the rig.
function Router() {
  const uses = [];
  const routes = [];

  function matchPath(pattern, actual) {
    const ps = pattern.split('/').filter(Boolean);
    const as = actual.split('/').filter(Boolean);
    if (ps.length !== as.length) return null;
    const params = {};
    for (let i = 0; i < ps.length; i++) {
      if (ps[i][0] === ':') params[ps[i].slice(1)] = decodeURIComponent(as[i]);
      else if (ps[i] !== as[i]) return null;
    }
    return params;
  }

  function dispatch(req, res, out) {
    const rawUrl = req.url || '/';
    const pathOnly = rawUrl.split('?')[0];
    if (req.path === undefined) req.path = pathOnly;
    if (req.query === undefined) {
      req.query = {};
      const qs = rawUrl.split('?')[1];
      if (qs) {
        for (const kv of qs.split('&')) {
          const eq = kv.indexOf('=');
          const k = eq === -1 ? kv : kv.slice(0, eq);
          const v = eq === -1 ? '' : kv.slice(eq + 1);
          if (k) req.query[decodeURIComponent(k)] = decodeURIComponent(v);
        }
      }
    }
    if (typeof req.get !== 'function') {
      req.get = (name) => (req.headers || {})[String(name).toLowerCase()];
    }

    let matched = null;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const params = matchPath(r.path, pathOnly);
      if (params) { matched = { fns: r.fns, params }; break; }
    }

    // Express runs router-level middleware for every request entering the
    // router, whether or not a route eventually matches.
    const chain = uses.slice();
    if (matched) {
      chain.push(...matched.fns.map((fn) => (rq, rs, nx) => {
        rq.params = matched.params;
        return fn(rq, rs, nx);
      }));
    }

    let i = 0;
    function next(err) {
      if (err) { if (out) out(err); return; }
      const fn = chain[i++];
      if (!fn) { if (!matched && out) out(); return; }
      try { fn(req, res, next); } catch (e) { if (out) out(e); }
    }
    next();
  }

  dispatch.use = (fn) => { uses.push(fn); return dispatch; };
  dispatch.get = (p, ...fns) => { routes.push({ method: 'GET', path: p, fns }); return dispatch; };
  dispatch.post = (p, ...fns) => { routes.push({ method: 'POST', path: p, fns }); return dispatch; };
  return dispatch;
}

// ── config double ──────────────────────────────────────────────────────────
// testerPhones already normalized (digits with country code), as config.js
// produces. Tests mutate adminKey/testerPhones between sections.
const config = {
  adminKey: 'test-admin-key',
  testerPhones: ['15550001111'],
  isProduction: false,
  nodeEnv: 'test',
};

// ── logger double — audit-event capture ────────────────────────────────────
const __logEvents = [];
const logger = {
  info() {}, warn() {}, error() {}, addContext() {},
  runWithContext(_store, fn) { return fn(); },
  event(name, fields = {}) {
    __logEvents.push(Object.assign({ __name: name }, fields));
    return name;
  },
};
function eventsNamed(name) { return __logEvents.filter((e) => e.__name === name); }
function clearEvents() { __logEvents.length = 0; }

// ── supabase double: add the .range() pagination terminal ──────────────────
// reliability-core's builder has no .range(); wrap from() so range slices the
// resolved row set (order() remains a no-op there, so slices follow seed
// order — tests assert on that, not on sort).
const __coreFrom = supabase.from;
supabase.from = (table) => {
  const api = __coreFrom(table);
  let rangeSpec = null;
  const coreThen = api.then;
  api.range = (from, to) => { rangeSpec = [from, to]; return api; };
  api.then = (resolve, reject) => coreThen.call(api, (out) => {
    if (rangeSpec && out && Array.isArray(out.data)) {
      out.data = out.data.slice(rangeSpec[0], rangeSpec[1] + 1);
    }
    return out;
  }, reject).then(resolve, reject);
  return api;
};
