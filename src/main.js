import { createApp } from 'vue'
import App from './App.vue'
import { installThemeBridge } from './theme.js'
import './styles.css'

// 必须在 mount 之前：installThemeBridge 会**同步**把兜底 token 写到 documentElement（首帧即有配色），
// 随后接收宿主的 `obox-theme` 推送（协议见 src/theme.js 顶部注释）。顺序不能反。
installThemeBridge()

createApp(App).mount('#app')
