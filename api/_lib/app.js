// Shared by the connected-app endpoints (api/chinka/...): key check, request
// limits, and JSON responses. Files under api/_lib are not endpoints.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const PUBLIC_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const send = (res, status, body, headers = {}) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.status(status).send(body === null ? '' : JSON.stringify(body))
}

/** Calls a database function as the public (signed-out) role. */
export async function rpc(name, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (!r.ok) {
    const err = new Error(`database ${r.status}`)
    err.status = r.status
    throw err
  }
  return r.json()
}

/** Today in Ethiopia (the day Yehulu counts interest to). */
export const todayInAddis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Addis_Ababa' }).format(new Date())

/**
 * The start of every connected-app request: method, key, limits.
 * Returns the access key if the request may go on; otherwise it has already
 * answered (and returns null).
 */
export async function admit(req, res, methods) {
  if (req.method === 'OPTIONS') { send(res, 204, null); return null }
  if (!methods.includes(req.method)) { send(res, 405, { error: `Use ${methods.join(' or ')}.` }); return null }
  if (!SUPABASE_URL || !PUBLIC_KEY) { send(res, 503, { error: 'Not set up on this server.' }); return null }

  const key = /^Bearer\s+(ykn_[0-9a-f]{64})$/i.exec(req.headers.authorization ?? '')?.[1]
  if (!key) { send(res, 401, { error: 'Missing or malformed access key. Send: Authorization: Bearer ykn_...' }); return null }

  let check
  try {
    check = await rpc('app_check', { access_key: key })
  } catch (err) {
    // A database without migration 009 yet: no limits, the key is checked by app_read.
    if (err.status === 404) return key
    send(res, 502, { error: 'Yehulu is unavailable. Try again shortly.' })
    return null
  }
  if (check?.ok) return key
  if (check?.reason === 'limit') {
    send(res, 429, { error: 'Too many requests. Limits: 60 a minute and 5,000 a day per key.', retry_after: check.retry_after },
      { 'Retry-After': String(check.retry_after) })
    return null
  }
  send(res, 401, { error: 'This access key is not valid or was disconnected by the user.' })
  return null
}
