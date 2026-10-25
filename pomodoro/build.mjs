/**
 * 把 pomodoro/ 下的 index.html + styles.css + app.js
 * 打包成根目录的单文件版本 番茄钟.html
 *
 * 用法：node pomodoro/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const read = (name) => fs.readFileSync(path.join(here, name), 'utf8');
let html = read('index.html');
const css = read('styles.css');
const js = read('app.js');

if (!html.includes('<link rel="stylesheet" href="styles.css" />')) throw new Error('找不到样式表引用');
if (!html.includes('<script src="app.js"></script>')) throw new Error('找不到脚本引用');
if (css.includes('</style')) throw new Error('CSS 中包含 </style，无法内联');
if (js.includes('</script')) throw new Error('JS 中包含 </script>，无法内联');

// 注意：必须用函数式替换，否则 JS 里的 "$$" 会被当成 replace 的转义符
html = html.replace('<link rel="stylesheet" href="styles.css" />', () => `<style>\n${css}\n</style>`);
html = html.replace('<script src="app.js"></script>', () => `<script>\n${js}\n</script>`);

const out = path.join(root, '番茄钟.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`已生成 ${out}（${(html.length / 1024).toFixed(1)} KB）`);
