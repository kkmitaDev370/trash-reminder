import fs from 'node:fs';
import path from 'node:path';

const appJsonPath = path.resolve('app.json');
const packageJsonPath = path.resolve('package.json');

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const currentVersion = appJson?.expo?.version ?? packageJson.version ?? '1.0.0';
const [major, minor, patch] = currentVersion.split('.').map((value) => Number(value || 0));
const nextVersion = `${major}.${minor}.${(patch || 0) + 1}`;

if (!appJson.expo) {
  appJson.expo = {};
}

appJson.expo.version = nextVersion;
appJson.expo.runtimeVersion = {
  policy: 'appVersion',
};

if (!appJson.expo.android) {
  appJson.expo.android = {};
}
appJson.expo.android.versionCode = (appJson.expo.android.versionCode ?? 0) + 1;

if (!appJson.expo.ios) {
  appJson.expo.ios = {};
}
const iosBuildNumber = Number(appJson.expo.ios.buildNumber ?? '0') + 1;
appJson.expo.ios.buildNumber = String(iosBuildNumber);

packageJson.version = nextVersion;

fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`, 'utf8');
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

console.log(`Bumped version: ${currentVersion} -> ${nextVersion}`);
console.log(`Android versionCode: ${appJson.expo.android.versionCode}`);
console.log(`iOS buildNumber: ${appJson.expo.ios.buildNumber}`);
