/**
 * lint-staged配置 - 提交前代码检查
 * 中文注释说明配置项用途
 */

module.exports = {
  // 匹配client目录的JavaScript/JSX文件
  'client/src/**/*.{js,jsx}': [
    // 1. ESLint检查 - 自动修复可修复的问题
    'eslint --fix',

    // 2. Prettier格式化 - 确保代码风格一致
    'prettier --write'
  ],

  // 匹配client目录的配置文件
  'client/**/*.{json,md,yml,yaml}': [
    // JSON/Markdown/YAML文件使用Prettier格式化
    'prettier --write'
  ],

  // 匹配server目录的JavaScript文件
  'server/**/*.js': [
    // 服务器代码也进行ESLint检查和格式化
    'eslint --fix',
    'prettier --write'
  ],

  // 匹配根目录配置文件
  '*.{js,json,md,yml,yaml}': [
    // 根目录的配置文件也进行格式化
    'prettier --write'
  ],

  // 忽略的文件
  ignored: [
    '**/node_modules/**',      // 忽略node_modules
    '**/dist/**',             // 忽略构建输出
    '**/package-lock.json',   // 忽略lock文件（有特殊格式）
    '**/yarn.lock',           // 忽略yarn lock文件
    '**/pnpm-lock.yaml'       // 忽略pnpm lock文件
  ],

  // 并发执行 - 提高检查速度
  concurrent: true,

  // 缓存ESLint结果 - 提高性能
  cache: true,

  // 相对路径模式
  relative: true
};