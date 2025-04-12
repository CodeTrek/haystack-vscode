const fs = require('fs');
const sharp = require('sharp');

const svgBuffer = fs.readFileSync('./resources/icon.svg');

sharp(svgBuffer)
  .resize(128, 128)
  .png()
  .toFile('./resources/icon.png')
  .then(() => console.log('SVG successfully converted to PNG'))
  .catch(err => console.error('Error converting SVG to PNG:', err));
