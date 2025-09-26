// printer.js
// Simple HTTP -> Serial bridge for printers
// Usage example:
//   Linux: SERIAL_PATH=/dev/ttyUSB0 BAUD=9600 BRIDGE_SECRET=mysecret node printer.js
//   Windows: set SERIAL_PATH=COM4 & set BAUD=9600 & set BRIDGE_SECRET=mysecret & node printer.js

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { SerialPort } = require('serialport');

const HTTP_PORT = parseInt(process.env.PORT || '8081', 10);
const DEFAULT_SERIAL_PATH = process.platform === 'win32' ? 'COM4' : '/dev/ttyUSB0';
const SERIAL_PATH = process.env.SERIAL_PATH || DEFAULT_SERIAL_PATH;
const BAUD = parseInt(process.env.BAUD || '9600', 10);
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || '';
const AUTO_OPEN = (process.env.AUTO_OPEN || 'true') === 'true';
const POLL_MS = parseInt(process.env.POLL_MS || '3000', 10);

// Allowed origins for CORS — set to your web UI origin, or * for testing
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));
app.use(cors({
  origin: function(origin, cb) {
    if (!origin) return cb(null, true); // allow curl, local clients
    if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.indexOf(origin) !== -1) return cb(null, true);
    return cb(new Error('CORS not allowed'));
  }
}));

let port = null;
let opening = false;

function authMiddleware(req, res, next) {
  if (!BRIDGE_SECRET) return next(); // if not set, allow (USE WITH CAUTION)
  const auth = req.headers['x-bridge-secret'] || req.headers['authorization'] || '';
  if (auth === BRIDGE_SECRET || auth === `Bearer ${BRIDGE_SECRET}`) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

function isHex(s) {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
}

async function tryOpen(path = SERIAL_PATH) {
  if (opening || (port && port.isOpen)) return;
  opening = true;
  try {
    console.log(`[bridge] Trying to open ${path} @ ${BAUD}`);
    port = new SerialPort({ path, baudRate: BAUD, autoOpen: false });
    port.on('open', () => console.log('[bridge] Serial opened', path));
    port.on('error', err => console.error('[bridge] Serial error', err));
    port.on('close', () => {
      console.log('[bridge] Serial closed');
      port = null;
    });
    await new Promise((res, rej) => port.open(err => (err ? rej(err) : res())));
  } catch (err) {
    console.error('[bridge] open failed:', err && err.message ? err.message : err);
    port = null;
  } finally {
    opening = false;
  }
}

async function pollForPort() {
  if (AUTO_OPEN) {
    try {
      const list = await SerialPort.list();
      const found = list.find(p => p.path === SERIAL_PATH || p.path === SERIAL_PATH.toLowerCase());
      if (found && (!port || !port.isOpen)) {
        await tryOpen(SERIAL_PATH);
      }
    } catch (err) {
      console.error('[bridge] list error', err);
    } finally {
      setTimeout(pollForPort, POLL_MS);
    }
  }
}

// Start poll loop (if enabled)
pollForPort();

// -- HTTP endpoints --

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    serialPath: SERIAL_PATH,
    serialOpen: !!(port && port.isOpen)
  });
});

// list OS serial ports
app.get('/list-ports', async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({ ok: true, ports });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// open specific path (optional)
app.post('/open', authMiddleware, async (req, res) => {
  const { path, baud } = req.body || {};
  const p = path || SERIAL_PATH;
  const b = parseInt(baud || BAUD, 10);
  try {
    await tryOpen(p);
    res.json({ ok: true, opened: !!(port && port.isOpen), path: p, baud: b });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// close port
app.post('/close', authMiddleware, async (req, res) => {
  try {
    if (port && port.isOpen) {
      await new Promise((res2) => port.close(() => res2()));
      port = null;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// write hex string
app.post('/write-hex', authMiddleware, async (req, res) => {
  const { hex } = req.body || {};
  if (!isHex(hex)) return res.status(400).json({ error: 'invalid hex' });
  if (!port || !port.isOpen) return res.status(503).json({ error: 'serial not open' });
  const buf = Buffer.from(hex, 'hex');
  port.write(buf, (err) => {
    if (err) return res.status(500).json({ error: String(err) });
    port.drain((de) => {
      if (de) return res.status(500).json({ error: String(de) });
      return res.json({ ok: true, bytes: buf.length });
    });
  });
});

// write base64 payload
app.post('/write-base64', authMiddleware, async (req, res) => {
  const { b64 } = req.body || {};
  if (!b64) return res.status(400).json({ error: 'missing b64' });
  if (!port || !port.isOpen) return res.status(503).json({ error: 'serial not open' });
  const buf = Buffer.from(b64, 'base64');
  port.write(buf, (err) => {
    if (err) return res.status(500).json({ error: String(err) });
    port.drain((de) => {
      if (de) return res.status(500).json({ error: String(de) });
      return res.json({ ok: true, bytes: buf.length });
    });
  });
});

// helper: ascii string -> hex (2-digit per byte, uppercase)
function asciiToHex(str) {
  if (typeof str !== 'string') str = String(str ?? '');
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const h = str.charCodeAt(i).toString(16).padStart(2, '0');
    out += h;
  }
  return out.toUpperCase();
}

// Print voucher with dynamic data (similar to mobile index.tsx)
// Body shape:
// {
//   station: { name, address, city, state, phone1, phone2 },
//   voucher: { dailyReportDate, createAt, nozzleNo, vocono, salePrice, saleLiter, totalPrice, fuelType }
// }
// Any missing fields will use defaults for testing.
app.post('/print-voucher', authMiddleware, async (req, res) => {
  try {
    if (!port || !port.isOpen) return res.status(503).json({ error: 'serial not open' });

    const now = new Date();
    const defaultStation = {
      name: 'My Station',
      address: '123 Main St',
      city: 'Yangon',
      state: 'MM',
      phone1: '09-123456789',
      phone2: '09-987654321'
    };
    const defaultVoucher = {
      dailyReportDate: now.toDateString(),
      createAt: now.toISOString(), // e.g. 2025-09-26T12:34:56.000Z
      nozzleNo: '01',
      vocono: 'VC123456',
      salePrice: '2530',
      saleLiter: '10.50',
      totalPrice: '26565',
      fuelType: 'OCTANE 95'
    };

    // Accept both nested and flattened inputs
    const body = req.body || {};
    const station = Object.assign({}, defaultStation, body.station || {});
    const voucher = Object.assign({}, defaultVoucher, body.voucher || {}, body.data || {});

    const stationName = asciiToHex(station.name);
    const location = asciiToHex(`${station.address}, ${station.city}, ${station.state}`);
    const phone1Hex = asciiToHex(station.phone1);
    const phone2Hex = asciiToHex(station.phone2);
    const dateHex = asciiToHex(String(voucher.dailyReportDate));
    const timeHex = asciiToHex(String(voucher.createAt).slice(11, 19));
    const nozzleHex = asciiToHex(String(voucher.nozzleNo));
    const voconoHex = asciiToHex(String(voucher.vocono));
    const basePriceHex = asciiToHex(String(voucher.salePrice));
    const literHex = asciiToHex(String(voucher.saleLiter));
    const totalHex = asciiToHex(String(voucher.totalPrice));
    const fuelHex = asciiToHex(String(voucher.fuelType));

    // ESC/POS command hex sequences (carried from index.tsx)
    const hexChunks = [
      // Initialize + center
      `1B401B6101${stationName}0A`,
      `${location}0A`,
      `${phone1Hex}2C20${phone2Hex}0A`,
      // Left align
      '1B6100',
      '2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D0A',
      `564F434F4E4F202020${voconoHex}0A`,
      `444154452020202020${dateHex}0A`,
      `54494D452020202020${timeHex}0A`,
      `4E4F5A5A4C45202020${nozzleHex}0A`,
      '2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D0A',
      `4655454C20202020${fuelHex}0A`,
      `4241534520505249434520202020${basePriceHex}204D4D4B202F204C495445520A`,
      `53414C45204C4954455253202020${literHex}204C490A`,
      `544F54414C202020202020202020${totalHex}204D4D4B0A`,
      `202020202020202020202020202028494E434C555349564520544158290A`,
      '2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D2D0A',
      // Center thank you, feed and cut
      '1B6101',
      '5448414E4B20594F5520464F52205649534954494E470A',
      '1B6401',
      '1D564100'
    ];

    const fullHex = hexChunks.join('');
    const buf = Buffer.from(fullHex, 'hex');

    port.write(buf, (err) => {
      if (err) return res.status(500).json({ error: String(err) });
      port.drain((de) => {
        if (de) return res.status(500).json({ error: String(de) });
        return res.json({ ok: true, bytes: buf.length, usedDefaults: !req.body || Object.keys(req.body).length === 0 });
      });
    });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// write raw binary (application/octet-stream)
app.post('/write-binary', authMiddleware, express.raw({ type: 'application/octet-stream', limit: '2mb' }), async (req, res) => {
  const buf = req.body;
  if (!buf || !Buffer.isBuffer(buf)) return res.status(400).json({ error: 'missing binary body' });
  if (!port || !port.isOpen) return res.status(503).json({ error: 'serial not open' });
  port.write(buf, (err) => {
    if (err) return res.status(500).json({ error: String(err) });
    port.drain((de) => {
      if (de) return res.status(500).json({ error: String(de) });
      return res.json({ ok: true, bytes: buf.length });
    });
  });
});

// graceful shutdown
process.on('SIGINT', async () => {
  console.log('[bridge] SIGINT, closing...');
  try { if (port && port.isOpen) await new Promise(r => port.close(() => r())); } catch {}
  process.exit(0);
});

app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[bridge] Listening http://0.0.0.0:${HTTP_PORT} -> ${SERIAL_PATH}@${BAUD}`);
  if (!BRIDGE_SECRET) console.warn('[bridge] Warning: BRIDGE_SECRET not set — API is open!');
});
