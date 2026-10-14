/**
 * 打包 .oix（= zip，扁平布局；manifest.json 必须在 zip 根）→ out/webapp-<version>.oix。
 *
 * **零依赖**：手写 stored（不压缩）zip——不装 adm-zip，也不依赖系统 `zip`/`tar`，
 * 因此 `npm test` / `npm run pack` 无需 `npm install` 即可跑。
 *
 * 分发白名单：manifest.json / index.js / helper.cjs / **lib/** / ui/** / icon.svg / LICENSE。
 * - `lib/**` 必须进包：`index.js` 静态 `import './lib/…mjs'`，缺了入口直接加载失败。
 * - `ui/**` 必须进包：App 卡片子窗口加载 `ui/index.html`（Vite 产物）。
 * - **显式排除 `data/`**：它是扩展运行时数据目录（宿主在**升级/覆盖安装**时保留的那份：
 *   条目库 `webapp.db` 与 `chrome/**` 里的所有站点登录态），且宿主安装器会**拒绝**含 `data/`
 *   的包（错误码 `forbidden-entry`，原文案即"升级时由宿主保留"）。
 *   另外排除 `out/`、`node_modules/`、`.git/`、`src/`（界面源码，产物已进 `ui/`）。
 *
 * 用法：npm run pack（界面需先 npm run build 产出 ui/index.html）。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
const name = manifest.name
const version = manifest.version

/** 分发白名单（相对扩展根目录；文件缺失自动跳过，目录递归收集） */
const INCLUDE = [
  'manifest.json',
  'index.js',
  'helper.cjs',
  'lib',
  'ui',
  'icon.svg',
  'icon.png',
  'LICENSE'
]
/** 这些目录/文件名永不进包（data/ 是宿主保留的运行时数据目录，含它会被安装器拒绝） */
const EXCLUDE_DIRS = new Set([
  'data',
  'out',
  'node_modules',
  '.git',
  'src',
  'docs',
  'test',
  'scripts'
])
/** 必须存在的分发文件 */
const REQUIRED = ['manifest.json', 'index.js', 'helper.cjs']
/** 必须存在的库模块（index.js / helper.cjs 都会加载它们，缺任一就是运行期必崩） */
const REQUIRED_LIB = [
  'lib/webapp.mjs',
  'lib/chromeArgs.mjs',
  'lib/nameSanitize.mjs',
  'lib/profileLimit.mjs',
  // v1.0.3：profile 根校验 / 标记 / 迁移判据的**唯一实现**，入口与助手都 import 它
  'lib/profileRoot.mjs',
  // v1.0.4：`cmd /c start` 的参数数组与护栏（助手 lazy import 它；缺了 launch 必崩）
  'lib/chromeLaunch.mjs'
]

/** 递归收集（返回 zip 内路径，统一正斜杠；跳过排除目录与隐藏文件） */
function collect(rel) {
  const abs = join(root, rel)
  if (!existsSync(abs)) return []
  const info = statSync(abs)
  if (info.isFile()) return [rel]
  const found = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (EXCLUDE_DIRS.has(entry.name)) continue
    found.push(...collect(`${rel}/${entry.name}`))
  }
  return found
}

for (const file of REQUIRED) {
  if (!existsSync(join(root, file))) throw new Error(`缺少分发文件 ${file}（扩展根目录下必须存在）`)
}

const entryNames = [...new Set(INCLUDE.flatMap((rel) => collect(rel)))].sort((a, b) => {
  // manifest.json 放最前（阅读方便；zip 顺序不影响宿主安装）
  if (a === 'manifest.json') return -1
  if (b === 'manifest.json') return 1
  return a < b ? -1 : 1
})

// 硬闸门 1：白名单 + 排除目录也不该漏（例如 ui/ 下混进了 data/）
for (const entryName of entryNames) {
  const first = entryName.split('/')[0]
  if (EXCLUDE_DIRS.has(first)) {
    throw new Error(`拒绝打包：条目 ${entryName} 落在排除目录 ${first}/ 下`)
  }
}

// 硬闸门 2：库模块必须在包内（rdp 的 README 记录过"设计稿漏了 lib/"这个坑）
const missingLib = REQUIRED_LIB.filter((rel) => !entryNames.includes(rel))
if (missingLib.length) {
  throw new Error(`拒绝打包：缺少库模块 ${missingLib.join('、')}（入口会加载失败）`)
}

if (!entryNames.includes('ui/index.html')) {
  console.warn(
    '[pack] 警告：ui/index.html 不存在——请先 `npm run build`（vite 产物）。' +
      '当前包缺少界面，安装后卡片会打不开（不阻断打包，便于后端单独验证）。'
  )
}

// ---------------------------------------------------------------------------
// stored zip（无压缩）实现
// ---------------------------------------------------------------------------

/** CRC32 表（IEEE 802.3，zip 用） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** JS Date → DOS 日期/时间（zip 只支持 1980–2107，早于 1980 的按 1980-01-01 存） */
function dosDateTime(date) {
  const year = date.getFullYear()
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 }
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
/** 通用标志位 bit 11：文件名是 UTF-8（中文文件名/路径安全） */
const FLAG_UTF8 = 0x0800

/** @param {Array<{ name: string, data: Buffer, mtime: Date }>} files */
function buildZip(files) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const crc = crc32(file.data)
    const { time, date } = dosDateTime(file.mtime)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(0, 8) // method: stored
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(file.data.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra length
    locals.push(local, nameBuf, file.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(0, 10) // method: stored
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(file.data.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + file.data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4) // this disk
  eocd.writeUInt16LE(0, 6) // disk with central dir
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...locals, centralBuf, eocd])
}

const files = entryNames.map((entryName) => {
  const abs = join(root, entryName)
  return { name: entryName, data: readFileSync(abs), mtime: statSync(abs).mtime }
})

const outDir = join(root, 'out')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, `${name}-${version}.oix`)
rmSync(outPath, { force: true })
const zip = buildZip(files)
writeFileSync(outPath, zip)

// 回读自检：stored zip 的 EOCD 与条目名必须与期望一致，且不得含 data/ 或 src/
const readBack = zip.subarray(zip.length - 22)
if (readBack.readUInt32LE(0) !== EOCD_SIG) throw new Error('自检失败：EOCD 缺失')
if (readBack.readUInt16LE(10) !== files.length) throw new Error('自检失败：条目数不一致')
for (const entryName of entryNames) {
  if (entryName === 'data' || entryName.startsWith('data/')) {
    throw new Error(`自检失败：产物含 data/ 条目 ${entryName}`)
  }
  if (entryName.startsWith('src/')) {
    throw new Error(`自检失败：产物含界面源码 src/ 条目 ${entryName}`)
  }
}

console.log(`已打包: ${outPath}（${zip.length} 字节，${files.length} 个条目）`)
console.log(`条目: ${entryNames.join(', ')}`)
