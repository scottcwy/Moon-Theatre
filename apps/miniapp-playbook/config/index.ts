import path from 'path';

interface WebpackChain {
  resolve: {
    set: (key: string, value: unknown) => void;
  };
}

const config = {
  projectName: 'juben-sha-miniapp-playbook',
  date: '2026-7-4',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: ['@tarojs/plugin-framework-react'],
  defineConstants: {},
  copy: {
    patterns: [
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
    webpackChain(chain: WebpackChain) {
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
