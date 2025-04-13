const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

// Is production environment
const isProd = process.env.NODE_ENV === 'production';
// Is analyze mode
const isAnalyze = process.argv.includes('--analyze');

module.exports = {
  target: 'node',
  mode: isProd ? 'production' : 'development',
  entry: {
    extension: './src/extension.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'commonjs2',
    clean: true
  },
  devtool: isProd ? 'source-map' : 'eval-source-map',
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    modules: [path.resolve(__dirname, 'src'), 'node_modules'],
    mainFields: ['module', 'main'],
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                module: 'esnext',
                removeComments: isProd
              },
              transpileOnly: true
            }
          }
        ]
      }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
      'process.env.IS_PROD': JSON.stringify(isProd)
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'src/webview/*.js',
          to: 'webview/[name][ext]'
        },
        {
          from: 'src/webview/*.css',
          to: 'webview/[name][ext]'
        }
      ]
    }),
    ...(isAnalyze ? [new BundleAnalyzerPlugin()] : [])
  ],
  optimization: {
    minimize: isProd,
    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          ecma: 2020,
          compress: {
            drop_console: isProd,
            drop_debugger: true,
            pure_funcs: isProd ? ['console.log', 'console.info'] : [],
            passes: 3,
            keep_infinity: true,
            unsafe: true,
            unsafe_math: true,
            unsafe_methods: true
          },
          format: {
            comments: false,
            ascii_only: true
          },
          mangle: {
            safari10: true
          }
        },
        extractComments: false
      })
    ],
    splitChunks: isProd ? {
      chunks: 'all',
      minSize: 20000,
      maxSize: 250000,
      minChunks: 1,
      maxAsyncRequests: 30,
      maxInitialRequests: 30,
      automaticNameDelimiter: '~',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name(module) {
            const packageName = module.context.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/)[1];
            return `vendor.${packageName.replace('@', '')}`;
          },
          priority: -10
        },
        common: {
          minChunks: 2,
          priority: -20,
          reuseExistingChunk: true
        }
      }
    } : false,
    usedExports: true,
    moduleIds: 'deterministic',
    chunkIds: 'deterministic'
  },
  performance: {
    hints: false
  },
  cache: {
    type: 'filesystem',
    buildDependencies: {
      config: [__filename]
    }
  }
};
