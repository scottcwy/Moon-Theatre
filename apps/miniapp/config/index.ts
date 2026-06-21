import path from 'path';

function getApiBaseUrl(): string {
  const apiBaseUrl = process.env.API_BASE_URL?.trim();
  const isDevBuild = process.env.NODE_ENV === 'development' || process.argv.includes('--watch');
  if (isDevBuild) {
    return apiBaseUrl || 'http://localhost:3000';
  }
  if (!apiBaseUrl) {
    throw new Error('API_BASE_URL is required for miniapp production builds');
  }
  if (apiBaseUrl.includes('localhost') || apiBaseUrl.includes('127.0.0.1')) {
    throw new Error('API_BASE_URL must not point to localhost for miniapp production builds');
  }
  return apiBaseUrl;
}

const apiBaseUrl = getApiBaseUrl();

const config = {
  projectName: 'juben-sha-miniapp',
  date: '2026-6-11',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: ['@tarojs/plugin-framework-react'],
  defineConstants: {
    API_BASE_URL: JSON.stringify(apiBaseUrl),
    DEV_AUTH_BYPASS: JSON.stringify(process.env.DEV_AUTH_BYPASS === 'true'),
  },
  copy: {
    patterns: [
      {
        from: 'src/assets',
        to: 'dist/assets',
      },
      {
        from: 'sitemap.json',
        to: 'dist/sitemap.json',
      },
    ],
    options: {},
  },
  framework: 'react',
  compiler: 'webpack5',
  mini: {
    compile: {
      include: [path.resolve(__dirname, '../../../packages/shared/src')],
    },
    webpackChain(chain) {
      chain.resolve.set('extensionAlias', {
        '.js': ['.ts', '.tsx', '.js'],
        '.mjs': ['.mts', '.mjs'],
      });
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: {
        enable: false,
        config: {
          namingPattern: 'module',
          generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
      },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      pxtransform: { enable: true, config: {} },
    },
  },
};

module.exports = config;
