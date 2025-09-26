// list-ports.js
const { SerialPort } = require('serialport');

(async () => {
  try {
    const ports = await SerialPort.list();
    if (!ports.length) {
      console.log('No serial ports found.');
      return;
    }
    console.log('Detected serial ports:');
    ports.forEach((p, i) => {
      console.log(`#${i+1}`);
      console.log('  path:', p.path);
      if (p.vendorId) console.log('  vendorId:', p.vendorId);
      if (p.productId) console.log('  productId:', p.productId);
      if (p.manufacturer) console.log('  manufacturer:', p.manufacturer);
      console.log('---');
    });
  } catch (err) {
    console.error('Error listing ports:', err);
  }
})();
