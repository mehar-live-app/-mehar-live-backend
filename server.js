// Cloudflare Worker Version - Mehar Live Backend - No card needed
import bcrypt from 'bcryptjs';

const OFFICIAL_MANAGER_ID = 'USR1791509827833340';
const rid = p => p + Date.now() + Math.floor(Math.random() * 1000);

// --- DB Helpers (KV instead of db.json) ---
async function load(env) {
  let d = await env.DB.get("mehar_db", { type: "json" });
  if (!d) {
    d = { users: [], agency_requests: [], withdrawals: [], role_assignments: [] };
    await save(env, d);
  }
  return d;
}
async function save(env, d) {
  await env.DB.put("mehar_db", JSON.stringify(d));
}

// --- JWT Helpers (Web Crypto) ---
function base64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}
async function signJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {...payload, exp: now + 7 * 24 * 60 * 60 };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(fullPayload));
  const data = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const encSig = base64url(String.fromCharCode(...new Uint8Array(sig)));
  return `${data}.${encSig}`;
}
async function verifyJwt(token, secret) {
  const [h, p, s] = token.split('.');
  if (!h ||!p ||!s) throw new Error("bad token");
  const data = `${h}.${p}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sig = Uint8Array.from(base64urlDecode(s), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(data));
  if (!valid) throw new Error("invalid");
  const payload = JSON.parse(base64urlDecode(p));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error("expired");
  return payload;
}
async function auth(request, env) {
  const h = request.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ")? h.slice(7) : "";
  if (!token) return null;
  try {
    const payload = await verifyJwt(token, env.JWT_SECRET);
    return payload.id;
  } catch { return null; }
}

// --- Durable Object for Live Rooms (Replaces socket.io) ---
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = [];
    this.rooms = new Map();
    this.roomCapacities = new Map([['1001', 30]]);
  }
  async fetch(request) {
    if (request.headers.get("Upgrade")!== "websocket") return new Response("Expected WS", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    let userId = null;
    let userName = null;
    let currentRoom = null;

    server.addEventListener("message", async (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "auth") {
          const payload = await verifyJwt(msg.token, this.env.JWT_SECRET);
          const d = await load(this.env);
          const u = d.users.find(x => x.id === payload.id);
          if (u) { userId = u.id; userName = u.name; server.send(JSON.stringify({ type: "auth_ok", user: { id: u.id, name: u.name } })); }
        }
        if (msg.type === "room:join") {
          currentRoom = msg.roomId;
          if (!this.rooms.has(currentRoom)) this.rooms.set(currentRoom, { users: new Map(), seats: new Map() });
          const room = this.rooms.get(currentRoom);
          room.users.set(userId, { userId, name: userName });
          this.broadcast(currentRoom, { type: "room:users", users: Array.from(room.users.values()) });
          this.broadcast(currentRoom, { type: "room:system", message: `${userName} joined` });
        }
        if (msg.type === "room:chat") {
          this.broadcast(currentRoom, { type: "room:chat", userId, name: userName, message: String(msg.message).slice(0, 500), createdAt: new Date().toISOString() });
        }
        if (msg.type === "seat:join") {
          const room = this.rooms.get(currentRoom);
          const cap = this.roomCapacities.get(String(currentRoom)) || 10;
          if (msg.seatNumber > cap) { server.send(JSON.stringify({ type: "seat:error", message: `Seat locked. Capacity ${cap}` })); return; }
          if (room.seats.has(msg.seatNumber)) { server.send(JSON.stringify({ type: "seat:error", message: "Occupied" })); return; }
          room.seats.set(msg.seatNumber, { seatNumber: msg.seatNumber, userId, name: userName });
          this.broadcast(currentRoom, { type: "room:seats", seats: Array.from(room.seats.values()) });
        }
        if (msg.type === "seat:leave" || msg.type === "room:leave") {
          const room = this.rooms.get(currentRoom);
          if (room) { for (let [k,v] of room.seats) if (v.userId === userId) room.seats.delete(k); room.users.delete(userId); this.broadcast(currentRoom, { type: "room:seats", seats: Array.from(room.seats.values()) }); this.broadcast(currentRoom, { type: "room:users", users: Array.from(room.users.values()) }); }
        }
      } catch {}
    });
    return new Response(null, { status: 101, webSocket: client });
  }
  broadcast(roomId, data) {
    const str = JSON.stringify(data);
    for (const s of this.sessions) { try { s.send(str); } catch {} }
    // Note: In this simple version we store sessions globally
  }
}

// --- Main Worker (All your REST APIs) ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const id = env.CHAT_ROOM.idFromName("global");
      const room = env.CHAT_ROOM.get(id);
      return room.fetch(request);
    }

    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {...cors, "Content-Type": "application/json" } });

    // Health
    if (url.pathname === "/api/health") return json({ ok: true, service: "Mehar Live Backend", version: "cloudflare-v1" });

    const d = await load(env);
    let body = {};
    if (request.method === "POST") { try { body = await request.json(); } catch {} }

    // Auth Register
    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      const { name, email, password } = body;
      if (!name ||!email ||!password) return json({ error: "name, email and password are required" }, 400);
      if (d.users.some(u => u.email === String(email).toLowerCase())) return json({ error: "Email already registered" }, 409);
      const u = { id: rid('USR'), name, email: String(email).toLowerCase(), passwordHash: await bcrypt.hash(password, 10), coins: 0, diamonds: 0, agencyId: null, createdAt: new Date().toISOString() };
      d.users.push(u); await save(env, d);
      const token = await signJwt({ id: u.id }, env.JWT_SECRET);
      return json({ message: "Registered", user: { id: u.id, name: u.name, email: u.email }, token });
    }

    // Auth Login
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const { email, password } = body;
      const u = d.users.find(x => x.email === String(email || '').toLowerCase());
      if (!u ||!(await bcrypt.compare(password || '', u.passwordHash))) return json({ error: "Invalid email or password" }, 401);
      const token = await signJwt({ id: u.id }, env.JWT_SECRET);
      return json({ message: "Login successful", user: { id: u.id, name: u.name, email: u.email, coins: u.coins, diamonds: u.diamonds, agencyId: u.agencyId }, token });
    }

    // Auth required routes
    const userId = await auth(request, env);
    const needAuth = ["/api/me", "/api/wallet", "/api/wallet/recharge", "/api/gifts/send", "/api/agencies", "/api/withdrawals", "/api/rooms", "/api/admin"];
    if (needAuth.some(p => url.pathname.startsWith(p)) &&!userId) return json({ error: "Unauthorized" }, 401);

    if (url.pathname === "/api/me") {
      const u = d.users.find(x => x.id === userId);
      return u? json({ id: u.id, name: u.name, email: u.email, coins: u.coins, diamonds: u.diamonds, agencyId: u.agencyId }) : json({ error: "User not found" }, 404);
    }
    if (url.pathname === "/api/wallet") {
      const u = d.users.find(x => x.id === userId);
      return json({ coins: u.coins, diamonds: u.diamonds });
    }
    if (url.pathname === "/api/wallet/recharge" && request.method === "POST") {
      const u = d.users.find(x => x.id === userId);
      const n = Number(body.coins);
      if (!Number.isInteger(n) || n <= 0) return json({ error: "coins must be positive" }, 400);
      u.coins += n; await save(env, d);
      return json({ message: "Demo recharge added", coins: u.coins });
    }
    if (url.pathname === "/api/gifts/send" && request.method === "POST") {
      const u = d.users.find(x => x.id === userId);
      const n = Number(body.coins); const di = Number(body.diamonds?? n);
      if (u.coins < n) return json({ error: "Not enough coins" }, 400);
      u.coins -= n; u.diamonds += di; await save(env, d);
      return json({ message: "Gift recorded", coins: u.coins, diamonds: u.diamonds });
    }
    if (url.pathname === "/api/rooms/1001/capacity" || url.pathname.match(/\/api\/rooms\/.*\/capacity/)) {
      return json({ roomId: url.pathname.split('/')[3], capacity: 30 });
    }

    return json({ error: "Not found. Available: /api/health, /api/auth/register, /api/auth/login, /ws" }, 404);
  }
}
