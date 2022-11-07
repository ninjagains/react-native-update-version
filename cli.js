#!/usr/bin/env node

import * as path from 'node:path';

import find from 'find';
import { promises as fs } from 'node:fs';
import isGitClean from 'is-git-clean';
import meow from 'meow';
import { exec as nativeExec } from 'node:child_process';
import { promisify } from 'node:util';
import semver from 'semver';

const exec = promisify(nativeExec);

const cli = meow(
  `
Usage
  $ react-native-update-version <patch|minor|major>

Options
  --branch, git branch name
  --silent, do not show any output
`,
  {
    importMeta: import.meta,
    flags: {
      silent: {
        type: 'boolean',
      },
      branch: {
        type: 'string',
        default: 'main',
      },
    },
  }
);

const semverLevel = cli.input[0] || 'patch';
const branchName = cli.flags.branch;

function log(...args) {
  if (cli.flags.silent) {
    return;
  }

  console.log(...args);
}

async function updateAndroidVersionName(nextVersion, buildNumber) {
  const filename = 'android/app/build.gradle';
  const content = await fs.readFile(filename, 'utf8');
  const newContent = content
    .replace(/(versionName) "([0-9].+)"/, `$1 "${nextVersion}"`)
    .replace(/(versionCode) ([0-9]+)/, `$1 ${buildNumber}`);

  try {
    return await fs.writeFile(filename, newContent);
  } catch (error) {
    throw new Error(`Set versionName ${nextVersion} in ${filename}`);
  }
}

async function countGitCommits() {
  return parseInt((await exec(`git rev-list ${branchName} --count`)).stdout);
}

function findPlistFiles() {
  return new Promise((resolve) => {
    find.file(
      /ios\/(\w+)\/Info.plist$/,
      path.resolve(process.cwd(), 'ios'),
      (files) => {
        resolve(files.filter((file) => !file.includes('Tests/Info.plist')));
      }
    );
  });
}

async function updatePlistAtKey(plist, key, value) {
  return exec(`/usr/libexec/PlistBuddy -c "Set :${key} ${value}" ${plist}`);
}

async function main() {
  const isRepoClean = await isGitClean();

  if (!isRepoClean) {
    console.error(
      'This command requires a clean git repo. Please stash or commit any changes before re-running this command.'
    );
    return;
  }

  const packageJson = JSON.parse(await fs.readFile('package.json'));
  const currentVersion = packageJson.version;
  const nextVersion = semver.inc(currentVersion, semverLevel);
  const buildNumber = await countGitCommits();

  for (const plistFile of await findPlistFiles()) {
    await updatePlistAtKey(
      plistFile,
      'CFBundleShortVersionString',
      nextVersion
    );
    await updatePlistAtKey(plistFile, 'CFBundleVersion', buildNumber);
  }

  await updateAndroidVersionName(nextVersion, buildNumber);

  packageJson.version = nextVersion;
  await fs.writeFile(
    'package.json',
    JSON.stringify(packageJson, null, 2) + '\n'
  );

  await exec('git add .');
  await exec(`git commit -m ${nextVersion}`);
  await exec(`git tag -a '${nextVersion}' -m '${nextVersion}'`);

  log(
    `Version numbers successfully updated to ${nextVersion} (${buildNumber}).`
  );
  log();
  log('ios: cd ios && bundle exec fastlane beta');
  log('android: cd android && ./gradlew assembleRelease');
  log();
}

main();
