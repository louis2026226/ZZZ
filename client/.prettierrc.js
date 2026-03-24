/**
 * Prettier配置 - 代码格式化规范
 * 中文注释说明配置项用途
 */

module.exports = {
  // 行尾分号 - true: 需要分号 | false: 不需要分号
  semi: true,

  // 引号类型 - true: 单引号 | false: 双引号
  singleQuote: true,

  // 尾随逗号 - 'es5': ES5有效逗号 | 'none': 无尾随逗号 | 'all': 所有尾随逗号
  trailingComma: 'es5',

  // 缩进大小 - 使用2空格（行业标准）
  tabWidth: 2,

  // 使用空格缩进 - true: 空格 | false: 制表符
  useTabs: false,

  // 行宽度 - 超过此宽度自动换行
  printWidth: 100,

  // JSX中使用单引号 - 与singleQuote保持一致
  jsxSingleQuote: true,

  // 对象花括号内空格 - true: { foo: bar } | false: {foo: bar}
  bracketSpacing: true,

  // JSX标签闭合位置 - true: <div> | false: <div>
  //                </div>         </div>
  bracketSameLine: false,

  // 箭头函数参数括号 - 'avoid': 单参数省略括号 | 'always': 总是需要括号
  arrowParens: 'avoid',

  // 文件顶部插入特殊注释 - 用于配置编辑器识别
  // @prettier | @format
  requirePragma: false,

  // 文件顶部有特殊注释时才格式化
  insertPragma: false,

  // HTML空白敏感度 - 'css': CSS显示属性 | 'strict': 严格 | 'ignore': 忽略
  htmlWhitespaceSensitivity: 'css',

  // 换行符 - 'lf' Linux/Mac | 'crlf' Windows | 'auto' 自动检测
  endOfLine: 'auto',

  // 属性换行 - 'auto' 自动 | 'force' 强制换行
  proseWrap: 'preserve',

  // Vue文件script/style标签缩进
  vueIndentScriptAndStyle: false,

  // 引用模块顺序 - 按字母排序
  importOrder: ['^react', '^[^.]', '^[./]'],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true
};