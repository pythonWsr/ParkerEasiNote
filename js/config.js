/* ============================================================
   ParkerEasiNote10 · 全局配置
   只改这个文件就能换品牌、换仓库、换官网、换团队名单
   ============================================================ */
window.EN10_CONFIG = {
  name: 'ParkerEasiNote10',
  shortName: 'ParkerEasiNote',
  cnName: '快捷白板',
  version: '10.1.7',
  kernel: '10.1.5',
  build: '2026.11.21',
  slogan: '让板书成为画面里唯一的主角',
  /* 关于页按钮 */
  website: 'https://parkerstudioxkissice.app.workbuddy.host/?sharecode=UZYO5WR4L6',
  github: 'https://github.com/ParkerStudio/ParkerEasiNote10',
  /* 启动时静默检查更新的仓库（owner/repo）；查询失败或没有新版本都不会打扰用户 */
  repo: 'ParkerStudio/ParkerEasiNote10',
  /* 交流群 */
  qq: '1129349388',

  /* 关于页团队：顺序即展示顺序 */
  team: [
    { name: 'ParkerStudio',          role: 'UP主', avatar: 'assets/avatars/01-parkerstudio.jpg' },
    { name: 'Chevrolet7275',         role: '设计', avatar: 'assets/avatars/02-chevrolet7275.jpg' },
    { name: '苏易云SYYUN_冲1万粉_', role: '策划', avatar: 'assets/avatars/03-suyiyun.jpg' },
    { name: '数不清的宇宙',          role: '研发', avatar: 'assets/avatars/04-yuzhou.jpg' },
    { name: '8班课代表',             role: '研发', avatar: 'assets/avatars/05-class8.jpg' },
    { name: '我是电脑糕手',          role: '研发', avatar: 'assets/avatars/06-gaoshou.jpg' }
  ],

  /* AI 默认接口（可在设置里改） */
  ai: {
    base: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    balancePath: '/user/balance',
    chatPath: '/chat/completions'
  }
};
