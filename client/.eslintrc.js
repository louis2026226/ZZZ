/**
 * ESLint配置 - 代码质量规范
 * 中文注释说明配置项用途
 */

module.exports = {
  // 根配置文件 - 禁止向上查找父目录配置
  root: true,

  // 环境设置 - 浏览器环境 + ES2022语法
  env: {
    browser: true,
    es2022: true,
    node: false
  },

  // 扩展配置 - 使用推荐规则 + React规则 + Prettier兼容
  extends: [
    'eslint:recommended',          // ESLint核心推荐规则
    'plugin:react/recommended',    // React官方推荐规则
    'plugin:react-hooks/recommended', // React Hooks规则
    'prettier'                     // 禁用与Prettier冲突的规则
  ],

  // 插件
  plugins: ['react', 'react-hooks'],

  // 解析器选项
  parserOptions: {
    ecmaVersion: 'latest',         // 使用最新ECMAScript语法
    sourceType: 'module',          // 使用ES模块
    ecmaFeatures: {
      jsx: true                    // 启用JSX支持
    }
  },

  // React版本设置 - 自动检测
  settings: {
    react: {
      version: 'detect'            // 自动检测React版本
    }
  },

  // 自定义规则覆盖
  rules: {
    // React规则
    'react/react-in-jsx-scope': 'off',  // Next.js等不需要React全局引入
    'react/prop-types': 'off',          // TypeScript项目中可关闭

    // 代码质量
    'no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],

    // 控制台语句 - 警告但允许开发使用
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // 调试器语句 - 生产环境禁止
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn'
  },

  // 特定文件覆盖规则
  overrides: [
    {
      // 配置文件特殊规则
      files: ['.eslintrc.js', '.prettierrc.js', '*.config.js'],
      env: {
        node: true  // 允许Node.js全局变量
      }
    }
  ]
};