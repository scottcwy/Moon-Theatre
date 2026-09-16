import path from 'path';
import { getApiBaseUrlForMode } from './api-base-url';

const H5_OUTPUT_ROOT = 'dist/h5';
const h5OutputPath = path.resolve(__dirname, '..', H5_OUTPUT_ROOT);
const ASSET_COPY_IGNORE = ['**/*.md', '**/.DS_Store'];

function applyTsExtensionAlias(chain) {
  chain.resolve.set('extensionAlias', {
    '.js': ['.ts', '.tsx', '.js'],
    '.mjs': ['.mts', '.mjs'],
  });
}

// H5 playground：微信专有 API（getMenuButtonBoundingClientRect 等）在 H5 端走 rejected promise，
// 页面里的 try/catch 拦不住，会触发 react-refresh 的 runtime overlay 全屏遮挡渲染。
// 只关 overlay，保留 fast refresh；prod 构建里该 plugin 不存在，此处自动 no-op。
function applyH5WebpackChain(chain) {
  applyTsExtensionAlias(chain);
  if (chain.plugins.has('fastRefreshPlugin')) {
    chain.plugin('fastRefreshPlugin').tap((args) => [{ ...args[0], overlay: false }]);
  }
}

function getApiBaseUrl(): string {
  const isDevBuild = process.env.NODE_ENV === 'development' || process.argv.includes('--watch');
  return getApiBaseUrlForMode(isDevBuild ? 'development' : 'production');
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
    API_DEBUG_LOGS: JSON.stringify(process.env.API_DEBUG_LOGS === 'true'),
  },
  copy: {
    patterns: [
      {
        from: 'src/assets',
        to: 'dist/assets',
        ignore: ASSET_COPY_IGNORE,
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
      include: [
        path.resolve(__dirname, '../../../packages/shared/src'),
        path.resolve(__dirname, '../../../packages/miniapp-ui/src'),
      ],
    },
    webpackChain: applyTsExtensionAlias,
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
    outputRoot: H5_OUTPUT_ROOT,
    output: {
      path: h5OutputPath,
    },
    compiler: {
      type: 'webpack5',
      prebundle: {
        enable: false,
      },
    },
    webpackChain: applyH5WebpackChain,
    compile: {
      include: [
        path.resolve(__dirname, '../../../packages/shared/src'),
        path.resolve(__dirname, '../../../packages/miniapp-ui/src'),
      ],
    },
    publicPath: '/',
    staticDirectory: 'static',
    copy: {
      patterns: [
        {
          from: 'src/assets',
          to: `${H5_OUTPUT_ROOT}/assets`,
          ignore: ASSET_COPY_IGNORE,
        },
      ],
      options: {},
    },
    postcss: {
      pxtransform: { enable: true, config: {} },
    },
    devServer: {
      port: 10086,
      client: {
        overlay: {
          runtimeErrors: false,
        },
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },
  },
};

module.exports = config;
