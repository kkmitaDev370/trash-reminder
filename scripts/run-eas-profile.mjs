import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , mode, profile, ...extraArgs] = process.argv;

if (!mode || !profile) {
  console.error('Usage: node scripts/run-eas-profile.mjs <build|update> <profile> [...args]');
  process.exit(1);
}

const easJsonPath = path.resolve('eas.json');
const easConfig = JSON.parse(fs.readFileSync(easJsonPath, 'utf8'));
const profileConfig = easConfig?.build?.[profile];

if (!profileConfig) {
  console.error(`EAS profile not found: ${profile}`);
  process.exit(1);
}

const env = {
  ...process.env,
  ...(profileConfig.env ?? {}),
};

let easArgs;

if (mode === 'build') {
  easArgs = ['eas-cli', 'build', '--platform', 'android', '--profile', profile, ...extraArgs];
} else if (mode === 'update') {
  if (!profileConfig.channel) {
    console.error(`EAS profile ${profile} does not define a channel.`);
    process.exit(1);
  }

  easArgs = [
    'eas-cli',
    'update',
    '--platform',
    'android',
    '--channel',
    profileConfig.channel,
    '--non-interactive',
    ...extraArgs,
  ];
} else {
  console.error(`Unsupported mode: ${mode}`);
  process.exit(1);
}

const result = spawnSync('npx', easArgs, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);