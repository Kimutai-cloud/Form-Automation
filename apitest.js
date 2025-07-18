const fs = require('fs');
const path = require('path');

// Clear any existing environment variables first
delete process.env.OPENAI_API_KEY;

console.log('=== ENVIRONMENT CONFLICT DETECTOR ===\n');

// 1. Check system environment variables BEFORE loading .env
console.log('1. System Environment Variables:');
console.log('OPENAI_API_KEY in system env:', !!process.env.OPENAI_API_KEY);
if (process.env.OPENAI_API_KEY) {
  const sysKey = process.env.OPENAI_API_KEY;
  console.log('System key starts with:', sysKey.substring(0, 20));
  console.log('System key ends with:', sysKey.slice(-20));
}

// 2. Check for multiple .env files
console.log('\n2. Checking for .env files:');
const envFiles = ['.env', '.env.local', '.env.development', '.env.production'];
const projectRoot = process.cwd();

envFiles.forEach(filename => {
  const filepath = path.join(projectRoot, filename);
  if (fs.existsSync(filepath)) {
    console.log(`✅ Found: ${filename}`);
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const lines = content.split('\n');
      const apiKeyLine = lines.find(line => line.trim().startsWith('OPENAI_API_KEY='));
      if (apiKeyLine) {
        const key = apiKeyLine.split('=')[1];
        console.log(`   - Contains OPENAI_API_KEY: ${key.substring(0, 20)}...${key.slice(-20)}`);
      }
    } catch (error) {
      console.log(`   - Error reading ${filename}:`, error.message);
    }
  } else {
    console.log(`❌ Not found: ${filename}`);
  }
});

// 3. Check parent directories for .env files
console.log('\n3. Checking parent directories:');
let currentDir = projectRoot;
for (let i = 0; i < 3; i++) {
  const parentDir = path.dirname(currentDir);
  if (parentDir === currentDir) break; // reached root
  
  const parentEnvPath = path.join(parentDir, '.env');
  if (fs.existsSync(parentEnvPath)) {
    console.log(`⚠️  Found .env in parent directory: ${parentDir}`);
    try {
      const content = fs.readFileSync(parentEnvPath, 'utf8');
      const lines = content.split('\n');
      const apiKeyLine = lines.find(line => line.trim().startsWith('OPENAI_API_KEY='));
      if (apiKeyLine) {
        const key = apiKeyLine.split('=')[1];
        console.log(`   - Contains OPENAI_API_KEY: ${key.substring(0, 20)}...${key.slice(-20)}`);
      }
    } catch (error) {
      console.log(`   - Error reading parent .env:`, error.message);
    }
  }
  currentDir = parentDir;
}

// 4. Now load dotenv and see what happens
console.log('\n4. Loading dotenv:');
require('dotenv').config();

console.log('After dotenv load:');
console.log('OPENAI_API_KEY loaded:', !!process.env.OPENAI_API_KEY);
if (process.env.OPENAI_API_KEY) {
  const loadedKey = process.env.OPENAI_API_KEY;
  console.log('Loaded key starts with:', loadedKey.substring(0, 20));
  console.log('Loaded key ends with:', loadedKey.slice(-20));
  console.log('Full loaded key:', loadedKey);
}

// 5. Test with explicit path loading
console.log('\n5. Testing explicit .env loading:');
try {
  const explicitEnvPath = path.resolve(projectRoot, '.env');
  require('dotenv').config({ path: explicitEnvPath, override: true });
  
  const explicitKey = process.env.OPENAI_API_KEY;
  console.log('Explicit load key starts with:', explicitKey?.substring(0, 20));
  console.log('Explicit load key ends with:', explicitKey?.slice(-20));
  console.log('Full explicit key:', explicitKey);
} catch (error) {
  console.log('Error with explicit loading:', error.message);
}

// 6. Check if they match your expected key
const expectedStart = 'sk-proj-E9H5rhPv0bYi';
const expectedEnd = 'QgI4A7sRjEcA';
const currentKey = process.env.OPENAI_API_KEY;

console.log('\n6. Key Validation:');
console.log('Expected key starts with:', expectedStart);
console.log('Expected key ends with:', expectedEnd);
console.log('Current key matches expected start:', currentKey?.startsWith(expectedStart));
console.log('Current key matches expected end:', currentKey?.endsWith(expectedEnd));

if (!currentKey?.startsWith(expectedStart)) {
  console.log('\n❌ PROBLEM FOUND: The loaded key does not match your .env file!');
  console.log('This means another source is overriding your .env file.');
} else {
  console.log('\n✅ Key matches expected value from .env file');
}