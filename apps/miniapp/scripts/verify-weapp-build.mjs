import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const distDir = path.join(projectRoot, 'dist');
const appJsonPath = path.join(distDir, 'app.json');
const projectConfigPath = path.join(projectRoot, 'project.config.json');
const forbiddenHosts = ['api.example.com', 'api.juben-sha.invalid'];
const forbiddenLiterals = ['http://localhost:3000', 'https://api.example.com', 'http://api.example.com'];
const textFileExtensions = new Set(['.js', '.json', '.wxml', '.wxss', '.map']);
const mainPackageLimitBytes = 2 * 1024 * 1024;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

assert(fs.existsSync(appJsonPath), 'dist/app.json is missing; run build:weapp first');
assert(fs.existsSync(projectConfigPath), 'project.config.json is missing');

const appJson = JSON.parse(readText(appJsonPath));
assert(appJson.sitemapLocation === 'sitemap.json', 'app.json should point to sitemap.json');
assert(appJson.lazyCodeLoading === 'requiredComponents', 'lazyCodeLoading should be enabled');
const registeredPages = [
  ...(appJson.pages ?? []),
  ...(appJson.subPackages ?? appJson.subpackages ?? []).flatMap((subpackage) => (
    (subpackage.pages ?? []).map((page) => (
      `${subpackage.root.replace(/\/+$/, '')}/${page.replace(/^\/+/, '')}`
    ))
  )),
];
assert(
  !registeredPages.includes('pages/quota/visual-fixture/index'),
  'production app.json must not register pages/quota/visual-fixture/index',
);

const projectConfig = JSON.parse(readText(projectConfigPath));
assert(projectConfig.miniprogramRoot === 'dist/', 'project.config.json should use dist/ as miniprogramRoot');
assert(fs.existsSync(distDir), 'miniprogramRoot does not exist');

function collectTextFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTextFiles(filePath));
      continue;
    }
    if (entry.isFile() && textFileExtensions.has(path.extname(entry.name))) {
      files.push(filePath);
    }
  }

  return files;
}

function assertNoForbiddenApiHost(filePath, content) {
  for (const literal of forbiddenLiterals) {
    assert(!content.includes(literal), `${path.relative(distDir, filePath)} contains forbidden API URL ${literal}`);
  }

  for (const host of forbiddenHosts) {
    assert(!content.includes(host), `${path.relative(distDir, filePath)} contains forbidden API host ${host}`);
  }
}

for (const filePath of collectTextFiles(distDir)) {
  const content = readText(filePath);
  assertNoForbiddenApiHost(filePath, content);
}

function walkFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(filePath) : [filePath];
  });
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join('/').replace(/^\/+/, '');
}

function isIgnoredByPackOptions(relativePath, packOptions = {}) {
  return (packOptions.ignore ?? []).some((entry) => {
    const value = normalizeRelativePath(String(entry.value ?? '').replace(/\\/g, '/')).replace(/\/+$/, '');
    if (!value) return false;
    return entry.type === 'folder'
      ? relativePath === value || relativePath.startsWith(`${value}/`)
      : relativePath === value;
  });
}

function sumBytes(files) {
  return files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0);
}

const uploadWithSourceMap = projectConfig.setting?.uploadWithSourceMap === true;
const subpackageDefinitions = appJson.subPackages ?? appJson.subpackages ?? [];
const subpackageReports = subpackageDefinitions.map((definition) => ({
  name: definition.name ?? definition.root,
  root: normalizeRelativePath(definition.root).replace(/\/+$/, ''),
  files: [],
}));
const allFiles = walkFiles(distDir);
const excludedSourceMaps = [];
const mainFiles = [];

for (const filePath of allFiles) {
  const relativePath = normalizeRelativePath(path.relative(distDir, filePath));
  if (isIgnoredByPackOptions(relativePath, projectConfig.packOptions)) continue;
  if (!uploadWithSourceMap && filePath.endsWith('.map')) {
    excludedSourceMaps.push(relativePath);
    continue;
  }
  const subpackage = subpackageReports.find((entry) => relativePath === entry.root || relativePath.startsWith(`${entry.root}/`));
  if (subpackage) subpackage.files.push(filePath);
  else mainFiles.push(filePath);
}

const mainPackageBytes = sumBytes(mainFiles);
const wxssFiles = mainFiles
  .concat(...subpackageReports.map((entry) => entry.files))
  .filter((filePath) => filePath.endsWith('.wxss'));
const assetsDir = path.join(distDir, 'assets');
const report = {
  sourceMapPolicy: uploadWithSourceMap ? 'included by uploadWithSourceMap=true' : 'excluded by uploadWithSourceMap=false',
  excludedSourceMapFiles: excludedSourceMaps.length,
  mainPackageBytes,
  mainPackageLimitBytes,
  mainPackageWithinBudget: mainPackageBytes <= mainPackageLimitBytes,
  subPackages: subpackageReports.map((entry) => ({
    name: entry.name,
    root: entry.root,
    bytes: sumBytes(entry.files),
    fileCount: entry.files.length,
  })),
  distAssetsBytes: fs.existsSync(assetsDir) ? sumBytes(walkFiles(assetsDir)) : 0,
  wxss: {
    totalBytes: sumBytes(wxssFiles),
    files: Object.fromEntries(wxssFiles.map((filePath) => [
      normalizeRelativePath(path.relative(distDir, filePath)),
      fs.statSync(filePath).size,
    ])),
  },
  uploadBytes: sumBytes(mainFiles.concat(...subpackageReports.map((entry) => entry.files))),
  uploadFileCount: mainFiles.length + subpackageReports.reduce((total, entry) => total + entry.files.length, 0),
};

console.log(JSON.stringify(report, null, 2));
assert(
  report.mainPackageWithinBudget,
  `main package exceeds 2 MiB: ${mainPackageBytes} > ${mainPackageLimitBytes} bytes`,
);
for (const subpackage of report.subPackages) {
  assert(
    subpackage.bytes <= mainPackageLimitBytes,
    `${subpackage.name} subpackage exceeds 2 MiB: ${subpackage.bytes} > ${mainPackageLimitBytes} bytes`,
  );
}
