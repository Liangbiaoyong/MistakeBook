/**
 * electron-vite 的 `?asset` 导入：把文件复制进构建产物，并给出运行时路径。
 * 主进程里的 HTML / 图片等非 JS 资源必须这样引入，否则不会被打进 out/。
 */
declare module '*?asset' {
  const src: string
  export default src
}
