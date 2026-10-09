const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const DB = path.join(__dirname, 'db.json');
if (process.env.JWT_SECRET === undefined || process.env.JWT_SECRET.length === 0) throw new Error('JWT_SECRET environment variable is required');
const SECRET = process.env.JWT_SECRET;

const OFFICIAL_MANAGER_ID = 'USR1791509827833340';

const load = () =>
  JSON.parse(fs.readFileSync(DB, 'utf8'));

const save = d =>
  fs.writeFileSync(DB, JSON.stringify(d, null, 2));

const rid = p =>
  p + Date.now() + Math.floor(Math.random() * 1000);

function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    req.userId = jwt.verify(
      h.startsWith('Bearer ') ? h.slice(7) : '',
      SECRET
    ).id;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

/* =========================
   ROOM SEAT CAPACITY
========================= */

const roomCapacities = new Map([['1001', 30]]);

app.get('/api/rooms/:roomId/capacity', auth, (req, res) => {
  const roomId = String(req.params.roomId);
  const capacity = roomCapacities.get(roomId) || 10;

  res.json({
    roomId,
    capacity
  });
});

app.post('/api/rooms/:roomId/unlock-seats', auth, (req, res) => {
  const roomId = String(req.params.roomId);
  const target = Number(req.body?.target);
  const COST = 500000;

  if (![20, 30].includes(target)) {
    return res.status(400).json({
      error: 'Target must be 20 or 30'
    });
  }

  const current = roomCapacities.get(roomId) || 10;

  if (target <= current) {
    return res.status(400).json({
      error: `Room already has ${current} seats unlocked`
    });
  }

  const d = load();
  const u = d.users.find(x => x.id === req.userId);

  if (!u) {
    return res.status(404).json({
      error: 'User not found'
    });
  }

  if (u.coins < COST) {
    return res.status(400).json({
      error: 'Not enough coins'
    });
  }

  u.coins -= COST;
  roomCapacities.set(roomId, target);
  save(d);

  res.json({
    message: `${target} seats unlocked`,
    roomId,
    capacity: target,
    coins: u.coins
  });
});

/* =========================
   HEALTH
========================= */

app.get('/api/health', (q, s) =>
  s.json({
    ok: true,
    service: 'Mehar Live Backend',
    version: '15'
  })
);

/* =========================
   AUTH
========================= */

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({
      error: 'name, email and password are required'
    });
  }

  const d = load();

  if (
    d.users.some(
      u => u.email === String(email).toLowerCase()
    )
  ) {
    return res.status(409).json({
      error: 'Email already registered'
    });
  }

  const u = {
    id: rid('USR'),
    name,
    email: String(email).toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    coins: 0,
    diamonds: 0,
    agencyId: null,
    createdAt: new Date().toISOString()
  };

  d.users.push(u);
  save(d);

  res.json({
    message: 'Registered',
    user: {
      id: u.id,
      name: u.name,
      email: u.email
    },
    token: jwt.sign(
      { id: u.id },
      SECRET,
      { expiresIn: '7d' }
    )
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const d = load();

  const u = d.users.find(
    x => x.email === String(email || '').toLowerCase()
  );

  if (
    !u ||
    !(await bcrypt.compare(
      password || '',
      u.passwordHash
    ))
  ) {
    return res.status(401).json({
      error: 'Invalid email or password'
    });
  }

  res.json({
    message: 'Login successful',
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      coins: u.coins,
      diamonds: u.diamonds,
      agencyId: u.agencyId
    },
    token: jwt.sign(
      { id: u.id },
      SECRET,
      { expiresIn: '7d' }
    )
  });
});

app.get('/api/me', auth, (req, res) => {
  const u = load().users.find(
    x => x.id === req.userId
  );

  u
    ? res.json({
        id: u.id,
        name: u.name,
        email: u.email,
        coins: u.coins,
        diamonds: u.diamonds,
        agencyId: u.agencyId
      })
    : res.status(404).json({
        error: 'User not found'
      });
});

/* =========================
   WALLET
========================= */

app.get('/api/wallet', auth, (req, res) => {
  const u = load().users.find(
    x => x.id === req.userId
  );

  u
    ? res.json({
        coins: u.coins,
        diamonds: u.diamonds
      })
    : res.status(404).json({
        error: 'User not found'
      });
});

app.post('/api/wallet/recharge', auth, (req, res) => {
  const n = Number(req.body?.coins);
  const d = load();

  const u = d.users.find(
    x => x.id === req.userId
  );

  if (!Number.isInteger(n) || n <= 0) {
    return res.status(400).json({
      error: 'coins must be a positive integer'
    });
  }

  u.coins += n;
  save(d);

  res.json({
    message: 'Demo recharge added',
    coins: u.coins
  });
});

/* =========================
   GIFTS
========================= */

app.post('/api/gifts/send', auth, (req, res) => {
  const n = Number(req.body?.coins);
  const di = Number(req.body?.diamonds ?? n);

  const d = load();

  const u = d.users.find(
    x => x.id === req.userId
  );

  if (
    !Number.isInteger(n) ||
    n <= 0 ||
    !Number.isInteger(di) ||
    di < 0
  ) {
    return res.status(400).json({
      error: 'Invalid gift values'
    });
  }

  if (u.coins < n) {
    return res.status(400).json({
      error: 'Not enough coins'
    });
  }

  u.coins -= n;
  u.diamonds += di;

  save(d);

  res.json({
    message: 'Gift recorded',
    coins: u.coins,
    diamonds: u.diamonds
  });
});

/* =========================
   AGENCIES
========================= */

app.post('/api/agencies/requests', auth, (req, res) => {
  const { hostId } = req.body || {};
  const d = load();

  if (!d.users.some(u => u.id === hostId)) {
    return res.status(404).json({
      error: 'Host not found'
    });
  }

  const r = {
    id: rid('REQ'),
    agencyOwnerId: req.userId,
    hostId,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  d.agency_requests.push(r);
  save(d);

  res.json(r);
});

app.get('/api/agencies/requests', auth, (req, res) =>
  res.json(
    load().agency_requests.filter(
      r =>
        r.hostId === req.userId ||
        r.agencyOwnerId === req.userId
    )
  )
);

app.post(
  '/api/agencies/requests/:id/accept',
  auth,
  (req, res) => {
    const d = load();

    const r = d.agency_requests.find(
      x =>
        x.id === req.params.id &&
        x.hostId === req.userId
    );

    if (!r) {
      return res.status(404).json({
        error: 'Request not found'
      });
    }

    r.status = 'accepted';

    d.users.find(
      u => u.id === req.userId
    ).agencyId = r.agencyOwnerId;

    save(d);

    res.json({
      message: 'Agency request accepted',
      agencyId: r.agencyOwnerId
    });
  }
);

app.post(
  '/api/agencies/requests/:id/reject',
  auth,
  (req, res) => {
    const d = load();

    const r = d.agency_requests.find(
      x =>
        x.id === req.params.id &&
        x.hostId === req.userId
    );

    if (!r) {
      return res.status(404).json({
        error: 'Request not found'
      });
    }

    r.status = 'rejected';
    save(d);

    res.json({
      message: 'Agency request rejected'
    });
  }
);

/* =========================
   WITHDRAWALS
========================= */

app.post('/api/withdrawals', auth, (req, res) => {
  const { sellerId } = req.body || {};
  const n = Number(req.body?.diamonds);

  const d = load();

  const u = d.users.find(
    x => x.id === req.userId
  );

  if (
    !sellerId ||
    !Number.isInteger(n) ||
    n <= 0
  ) {
    return res.status(400).json({
      error: 'sellerId and diamonds are required'
    });
  }

  if (!u.agencyId) {
    return res.status(400).json({
      error: 'Join an agency before withdrawal'
    });
  }

  if (u.diamonds < n) {
    return res.status(400).json({
      error: 'Not enough diamonds'
    });
  }

  u.diamonds -= n;

  const w = {
    id: rid('WD'),
    userId: u.id,
    sellerId,
    diamonds: n,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  d.withdrawals.push(w);
  save(d);

  res.json({
    message: 'Withdrawal request created',
    withdrawal: w,
    diamondsRemaining: u.diamonds
  });
});

app.get('/api/withdrawals', auth, (req, res) =>
  res.json(
    load().withdrawals.filter(
      w => w.userId === req.userId
    )
  )
);

/* =========================
   ADMIN ROLES
========================= */

app.post('/api/admin/roles', auth, (req, res) => {
  if (req.userId !== OFFICIAL_MANAGER_ID) {
    return res.status(403).json({ error: 'Only the Official Manager can assign roles' });
  }

  const { userId, role } = req.body || {};
  const allowedRoles = ['admin', 'super_admin', 'coin_seller'];

  if (!userId || !allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid userId or role' });
  }

  if (userId === OFFICIAL_MANAGER_ID) {
    return res.status(400).json({ error: 'Official Manager account cannot be reassigned' });
  }

  const d = load();

  if (!d.users.some(u => u.id === userId)) {
    return res.status(404).json({ error: 'User not found' });
  }

  d.role_assignments = (d.role_assignments || []).filter(r => r.userId !== userId);
  d.role_assignments.push({
    id: rid('ROLE'),
    userId,
    role,
    assignedBy: req.userId,
    createdAt: new Date().toISOString()
  });

  save(d);
  res.json({ message: 'Role assigned', role });
});

/* ==================================================
   STEP 6 — REAL-TIME LIVE ROOM + CHAT
================================================== */

const rooms = new Map();

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    const payload = jwt.verify(token, SECRET);
    const u = load().users.find(x => x.id === payload.id);
    if (!u) return next(new Error('Unauthorized'));
    socket.data.user = { id: u.id, name: u.name };
    next();
  } catch (e) {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', socket => {
  console.log('Socket connected:', socket.id);

  socket.on('room:join', ({ roomId } = {}) => {
    const user = socket.data.user;
    if (!roomId || !user) return;

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        users: new Map(),
        seats: new Map()
      });
    }

    const room = rooms.get(roomId);

    room.users.set(socket.id, {
      socketId: socket.id,
      userId: user.id,
      name: user.name
    });

    socket.data.roomId = roomId;
    socket.data.user = user;

    const users = Array.from(
      room.users.values()
    );

    io.to(roomId).emit('room:users', users);

    io.to(roomId).emit('room:system', {
      message: `${user.name} joined the room`
    });

    console.log(
      `${user.name} joined room ${roomId}`
    );
  });

  socket.on('room:chat', ({ roomId, message }) => {
    if (!roomId || !message || socket.data.roomId !== roomId) return;

    const user = socket.data.user;

    if (!user) return;

    io.to(roomId).emit('room:chat', {
      userId: user.id,
      name: user.name,
      message: String(message).slice(0, 500),
      createdAt: new Date().toISOString()
    });
  });

  socket.on('seat:join', ({ roomId, seatNumber }) => {
    if (!roomId || !Array.from({length:30},(_,i)=>i+1).includes(Number(seatNumber))) return;

    const room = rooms.get(roomId);
    const user = socket.data.user;

    if (!room || !user || socket.data.roomId !== roomId) return;

    const seat = Number(seatNumber);
    const capacity = roomCapacities.get(String(roomId)) || 10;

    if (seat > capacity) {
      socket.emit('seat:error', {
        message: `Seat ${seat} is locked. Room capacity is ${capacity}.`
      });
      return;
    }

    if (room.seats.has(seat)) {
      socket.emit('seat:error', { message: `Seat ${seat} is already occupied` });
      return;
    }

    room.seats.set(seat, {
      seatNumber: seat,
      userId: user.id,
      name: user.name
    });

    io.to(roomId).emit(
      'room:seats',
      Array.from(room.seats.values())
    );
  });

  socket.on('seat:leave', ({ roomId }) => {
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    for (const [seat, occupant] of room.seats.entries()) {
      if (occupant.userId === socket.data.user?.id) {
        room.seats.delete(seat);
      }
    }

    io.to(roomId).emit(
      'room:seats',
      Array.from(room.seats.values())
    );
  });

  socket.on('room:leave', () => {
    leaveRoom(socket);
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
    console.log(
      'Socket disconnected:',
      socket.id
    );
  });
});

function leaveRoom(socket) {
  const roomId = socket.data.roomId;

  if (!roomId || !rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);
  const user = room.users.get(socket.id);

  room.users.delete(socket.id);

  for (const [seat, occupant] of room.seats.entries()) {
    if (occupant.userId === socket.data.user?.id) {
      room.seats.delete(seat);
    }
  }

  if (user) {
    io.to(roomId).emit('room:system', {
      message: `${user.name} left the room`
    });
  }

  io.to(roomId).emit(
    'room:users',
    Array.from(room.users.values())
  );

  if (room.users.size === 0) {
    rooms.delete(roomId);
  }

  socket.data.roomId = null;
}

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Mehar Live Backend running on port ${PORT}`);
});0
