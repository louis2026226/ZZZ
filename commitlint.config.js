/**
 * Commitlint配置 - Git提交消息规范
 * 中文注释说明配置项用途
 */

module.exports = {
  // 扩展配置 - 使用Conventional Commits规范
  // 参考：https://www.conventionalcommits.org/
  extends: ['@commitlint/config-conventional'],

  // 自定义规则
  rules: {
    // 类型枚举 - 允许的提交类型
    'type-enum': [
      2, // 2: error级别
      'always', // 必须匹配
      [
        'feat',     // 新功能
        'fix',      // Bug修复
        'docs',     // 文档更新
        'style',    // 代码格式（不影响功能）
        'refactor', // 重构（既不是修复bug也不是增加功能）
        'perf',     // 性能优化
        'test',     // 测试相关
        'chore',    // 构建过程或辅助工具变动
        'revert',   // 回滚提交
        'build',    // 构建系统或外部依赖变更
        'ci',       // CI配置变更
        'wip'       // 开发中（Work In Progress）
      ]
    ],

    // 类型大小写 - 必须小写
    'type-case': [2, 'always', 'lower-case'],

    // 类型不能为空
    'type-empty': [2, 'never'],

    // 主题大小写 - 句子格式（首字母大写，其余小写）
    'subject-case': [0], // 0: 不检查

    // 主题不能为空
    'subject-empty': [2, 'never'],

    // 主题最大长度 - 72字符（Git标准）
    'subject-full-stop': [2, 'never', '.'],

    // 主题不能以句号结尾
    'header-max-length': [2, 'always', 72],

    // 正文前空行
    'body-leading-blank': [1, 'always'], // 1: warning级别

    // 脚注前空行
    'footer-leading-blank': [1, 'always'],

    // 引用ISSUE格式
    'references-empty': [0]
  },

  // 帮助消息
  helpUrl: 'https://github.com/conventional-changelog/commitlint/#what-is-commitlint',

  // 默认提交类型描述
  defaultIgnores: true,

  // 跳过特定提交
  ignores: [
    // 跳过合并提交
    (commit) => commit.startsWith('Merge'),
    // 跳过revert提交
    (commit) => commit.startsWith('Revert'),
    // 跳过WIP提交（开发中）
    (commit) => commit.includes('[WIP]')
  ]
};