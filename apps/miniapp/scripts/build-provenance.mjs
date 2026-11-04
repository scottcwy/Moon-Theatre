import fs from 'node:fs';
import path from 'node:path';

export const BUILD_PROVENANCE_SCHEMA_VERSION = 1;
export const BUILD_PROVENANCE_FILE = '.build-provenance.json';

export const REAL_DATA_BUILD_CONTEXT = Object.freeze({
  buildProfile: 'development',
  apiBaseUrl: 'http://127.0.0.1:3000',
  devAuthBypass: true,
  visualFixtures: false,
});

const REQUIRED_FIELDS = [
  'schemaVersion',
  'buildProfile',
  'apiBaseUrl',
  'devAuthBypass',
  'visualFixtures',
  'completedAt',
];

export function resolveBuildProfile(env = process.env) {
  if (env.VISUAL_FIXTURES === 'true') return 'visual-fixture';
  return env.NODE_ENV === 'production' ? 'production' : 'development';
}

export function createBuildProvenance({
  apiBaseUrl,
  env = process.env,
  completedAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: BUILD_PROVENANCE_SCHEMA_VERSION,
    buildProfile: resolveBuildProfile(env),
    apiBaseUrl,
    devAuthBypass: env.DEV_AUTH_BYPASS === 'true',
    visualFixtures: env.VISUAL_FIXTURES === 'true',
    completedAt,
  };
}

export function getBuildProvenanceMismatches(actual, expected = REAL_DATA_BUILD_CONTEXT) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
    return [{ field: 'sidecar', expected: 'object', actual }];
  }

  const mismatches = [];
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(actual, field)) {
      mismatches.push({ field, expected: expected[field], actual: '<missing>' });
    }
  }
  if (actual.schemaVersion !== BUILD_PROVENANCE_SCHEMA_VERSION) {
    mismatches.push({
      field: 'schemaVersion',
      expected: BUILD_PROVENANCE_SCHEMA_VERSION,
      actual: actual.schemaVersion,
    });
  }
  for (const field of ['buildProfile', 'apiBaseUrl', 'devAuthBypass', 'visualFixtures']) {
    if (actual[field] !== expected[field]) {
      mismatches.push({ field, expected: expected[field], actual: actual[field] });
    }
  }
  return mismatches;
}

export function needsRealApiRebuild(actual, expected = REAL_DATA_BUILD_CONTEXT) {
  return getBuildProvenanceMismatches(actual, expected).length > 0;
}

export function writeBuildProvenance(outputPath, provenance) {
  const directory = path.dirname(outputPath);
  const temporaryPath = path.join(
    directory,
    `${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(provenance, null, 2)}\n`);
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

export class BuildProvenancePlugin {
  constructor({ outputPath, createMetadata }) {
    this.outputPath = outputPath;
    this.createMetadata = createMetadata;
  }

  apply(compiler) {
    compiler.hooks.beforeCompile.tap('BuildProvenancePlugin', () => {
      fs.rmSync(this.outputPath, { force: true });
    });
    compiler.hooks.done.tap('BuildProvenancePlugin', (stats) => {
      if (stats.hasErrors()) return;
      writeBuildProvenance(this.outputPath, this.createMetadata());
    });
  }
}
