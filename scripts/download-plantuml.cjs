const fs = require('fs');
const path = require('path');
const https = require('https');

const PLANTUML_VERSION = '1.2024.3';
const DOWNLOAD_URL = `https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/plantuml-${PLANTUML_VERSION}.jar`;

const DEST_DIR = path.join(__dirname, '../plantuml');
const DEST_FILE = path.join(DEST_DIR, 'plantuml.jar');

if (!fs.existsSync(DEST_DIR)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
}

if (fs.existsSync(DEST_FILE)) {
  console.log('✅ PlantUML is already installed.');
  process.exit(0);
}

console.log(`⬇️ Downloading PlantUML v${PLANTUML_VERSION}...`);

const file = fs.createWriteStream(DEST_FILE);

const download = (url) => {
  https.get(url, (response) => {
    if (response.statusCode === 301 || response.statusCode === 302) {
      download(response.headers.location);
      return;
    }

    if (response.statusCode !== 200) {
      console.error(`❌ Download failed. Status Code: ${response.statusCode}`);
      file.close();
      fs.unlinkSync(DEST_FILE);
      process.exit(1);
    }

    response.pipe(file);

    file.on('finish', () => {
      file.close(() => {
        console.log('✅ PlantUML installed successfully!');
      });
    });
  }).on('error', (err) => {
    console.error('❌ Download error:', err.message);
    fs.unlink(DEST_FILE, () => {});
    process.exit(1);
  });
};

download(DOWNLOAD_URL);