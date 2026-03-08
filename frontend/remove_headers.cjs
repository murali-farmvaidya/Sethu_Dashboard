const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'pages');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsx'));

files.forEach(file => {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    if (content.includes("import Header from '../components/Header';")) {
        content = content.replace(/import Header from '\.\.\/components\/Header';\r?\n?/g, '');
        changed = true;
    }

    if (content.includes('<Header />')) {
        content = content.replace(/<Header \/>\r?\n?/g, '');
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${file}`);
    }
});
