### Installation (pm2 recommended)

Cross-platform process manager with auto-restart and optional boot startup.

```bash
# Install pm2 globally
npm i -g pm2

# Start with environment variables
pm2 start printer.js --name printer-bridge --env production -- \
  SERIAL_PATH=/dev/ttyUSB0 BAUD=9600 PORT=8081

# Persist the current process list
pm2 save

# Enable pm2 to start on boot (follow the printed instructions)
pm2 startup
```

Linux serial permissions for `/dev/ttyUSB0` (permanent):

```bash
# Add your user to the dialout group (then LOG OUT and back in, or reboot)
sudo usermod -aG dialout $USER

# After re-login, verify you can access the port without sudo
ls -l /dev/ttyUSB0
```

That is enough on most Linux distros. No need to run `sudo chmod` each time.


---

### Printer Bridge API

- **Base URL**: `http://<host>:<port>` (default `http://localhost:8081`)
- **Content types**:
  - JSON: `application/json`
  - Binary: `application/octet-stream`

### Environment variables
- **PORT**: HTTP port (default `8081`)
- **SERIAL_PATH**: Serial device path (e.g., `/dev/ttyUSB0`, `COM4`)
- **BAUD**: Baud rate (default `9600`)
- **AUTO_OPEN**: Auto-open port if found (`true`|`false`, default `true`)
- **POLL_MS**: Poll interval for auto-open in ms (default `3000`)
- **ALLOWED_ORIGINS**: CORS origins, comma-separated, `*` for all (default `*`)

### Quick start

```bash
cd /your-codebase-path/printer-bridge
PORT=8081 SERIAL_PATH=/dev/ttyUSB0 BAUD=9600 node printer.js
```

Verify:

```bash
curl -s http://localhost:8081/health
```

### Endpoints

#### GET `/health`
- **Description**: Health check and serial status.
- **Response 200**:
```json
{ "ok": true, "serialPath": "/dev/ttyUSB0", "serialOpen": true }
```

#### GET `/list-ports`
- **Description**: List available serial ports on the OS.
- **Response 200**:
```json
{ "ok": true, "ports": [ { "path": "/dev/ttyUSB0", "...": "..." } ] }
```

#### POST `/open`
- **Description**: Open a serial port.
- **Body (json)**:
```json
{ "path": "/dev/ttyUSB0", "baud": 9600 }
```
- Both fields optional; defaults to `SERIAL_PATH` and `BAUD`.
- **Response 200**:
```json
{ "ok": true, "opened": true, "path": "/dev/ttyUSB0", "baud": 9600 }
```

#### POST `/close`
- **Description**: Close the serial port if open.
- **Response 200**:
```json
{ "ok": true }
```

#### POST `/write-hex`
- **Description**: Write a hex string to the serial port.
- **Body (json)**:
```json
{ "hex": "1B401B610148454C4C4F0A" }
```
- **Responses**:
  - 200: `{ "ok": true, "bytes": 12 }`
  - 400: `{ "error": "invalid hex" }`
  - 503: `{ "error": "serial not open" }`

#### POST `/write-base64`
- **Description**: Write base64-encoded data to the serial port.
- **Body (json)**:
```json
{ "b64": "GxQAAA==" }
```
- **Responses**:
  - 200: `{ "ok": true, "bytes": 8 }`
  - 400/503 on error

#### POST `/write-binary`
- **Description**: Write raw binary to the serial port.
- **Body**: Binary payload
- **Responses**:
  - 200: `{ "ok": true, "bytes": 64 }`
  - 400/503 on error

#### POST `/print-voucher`
- **Description**: Build and print an ESC/POS voucher using the same layout as `index.tsx`. Converts ASCII fields to hex and prints the receipt.
- **Body (json)**: All fields optional; defaults used when missing.
```json
{
  "station": {
    "name": "Fuel Station A",
    "address": "42 Street",
    "city": "Yangon",
    "state": "MM",
    "phone1": "09-111111111",
    "phone2": "09-222222222"
  },
  "voucher": {
    "dailyReportDate": "Fri Sep 26 2025",
    "createAt": "2025-09-26T14:23:45.000Z",
    "nozzleNo": "03",
    "vocono": "VC987654",
    "salePrice": "2530",
    "saleLiter": "5.25",
    "totalPrice": "13282.5",
    "fuelType": "DIESEL"
  }
}
```
- Notes:
  - You may also send flattened data under `data` instead of `voucher`.
  - If body is empty, server prints with default sample data.
- **Responses**:
  - 200: `{ "ok": true, "bytes": <number>, "usedDefaults": <boolean> }`
  - 503: `{ "error": "serial not open" }`
  - 401: when secret is required and missing/invalid

### Curl examples

- Health:
```bash
curl -s http://localhost:8081/health
```

- Open port:
```bash
curl -s -H 'x-bridge-secret: mysecret' -H 'Content-Type: application/json' \
  -d '{"path":"/dev/ttyUSB0","baud":9600}' http://localhost:8081/open
```

- Write hex:
```bash
curl -s -H 'x-bridge-secret: mysecret' -H 'Content-Type: application/json' \
  -d '{"hex":"1B401B610148454C4C4F0A"}' http://localhost:8081/write-hex
```

- Print voucher (defaults):
```bash
curl -s -H 'x-bridge-secret: mysecret' -X POST http://localhost:8081/print-voucher
```

- Print voucher (custom):
```bash
curl -s -H 'x-bridge-secret: mysecret' -H 'Content-Type: application/json' \
  -d '{
    "station":{"name":"Fuel Station A","address":"42 Street","city":"Yangon","state":"MM","phone1":"09-111111111","phone2":"09-222222222"},
    "voucher":{"dailyReportDate":"Fri Sep 26 2025","createAt":"2025-09-26T14:23:45.000Z","nozzleNo":"03","vocono":"VC987654","salePrice":"2530","saleLiter":"5.25","totalPrice":"13282.5","fuelType":"DIESEL"}
  }' \
  http://localhost:8081/print-voucher
```

- Close port:
```bash
curl -s -H 'x-bridge-secret: mysecret' -X POST http://localhost:8081/close
```


