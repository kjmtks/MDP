const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const DRAWIO_VERSION = '24.7.17'; 
const DRAWIO_URL = `https://github.com/jgraph/drawio/archive/refs/tags/v${DRAWIO_VERSION}.zip`;
const DEST_DIR = path.join(__dirname, '../drawio');
const TEMP_ZIP = path.join(__dirname, 'drawio.zip');
if (fs.existsSync(DEST_DIR) && fs.existsSync(path.join(DEST_DIR, 'index.html'))) {
  console.log('✅ draw.io is already installed.');
  process.exit(0);
}
console.log(`⬇️ Downloading draw.io v${DRAWIO_VERSION}...`);
const downloadFile = (url, destPath) => {
  const file = fs.createWriteStream(destPath);
  https.get(url, (response) => {
    if ([301, 302, 307].includes(response.statusCode)) {
      file.close();
      fs.unlinkSync(destPath);
      downloadFile(response.headers.location, destPath);
      return;
    }
    if (response.statusCode !== 200) {
      console.error(`❌ Download failed. Status Code: ${response.statusCode}`);
      file.close();
      fs.unlinkSync(destPath);
      process.exit(1);
    }
    response.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        console.log('✅ Download complete. Starting extraction...');
        extractZip();
      });
    });
  }).on('error', (err) => {
    console.error('❌ Download request error:', err.message);
    fs.unlink(destPath, () => {});
    process.exit(1);
  });
};
downloadFile(DRAWIO_URL, TEMP_ZIP);

function extractZip() {
  console.log('📦 Extracting...');
  try {
    if (process.platform === 'win32') {
      execSync(`powershell -command "Expand-Archive -Force '${TEMP_ZIP}' '${__dirname}'"`);
    } else {
      try {
        execSync(`unzip -o '${TEMP_ZIP}' -d '${__dirname}'`);
      } catch (e) {
        console.error('❌ "unzip" command failed. Please install unzip (e.g. "sudo apt install unzip").');
        throw e;
      }
    }
    const extractedFolder = path.join(__dirname, `drawio-${DRAWIO_VERSION}`);
    const webappFolder = path.join(extractedFolder, 'src', 'main', 'webapp');
    if (fs.existsSync(DEST_DIR)) {
      fs.rmSync(DEST_DIR, { recursive: true, force: true });
    }
    fs.cpSync(webappFolder, DEST_DIR, { recursive: true });
    fs.rmSync(extractedFolder, { recursive: true, force: true });
    fs.unlinkSync(TEMP_ZIP);
    console.log('✅ draw.io installed successfully!');
  } catch (error) {
    console.error('❌ Extraction failed:', error.message);
    process.exit(1);
  }
}