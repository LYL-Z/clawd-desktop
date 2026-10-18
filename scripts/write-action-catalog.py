"""Document actual action descriptors and their runtime use."""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[1]
m = json.loads((root / 'assets/runtime/animations.json').read_text(encoding='utf-8'))
labels = dict(re.findall(r"\['([^']+)','([^']+)'\]", (root / 'src/shared/types.ts').read_text(encoding='utf-8')))
notes = {
    'idle': '默认循环；呼吸与眨眼，注视方向由宿主选择',
    'running-right': '巡游或用户播放；正序向右步态',
    'running-left': '巡游或用户播放；逐帧镜像，不倒放',
    'waving': '单击、真实done短反馈或主动播放',
    'jumping': '主动播放；源帧本身包含离地高度',
    'failed': '真实failed只播放一次；随后安静待机',
    'waiting': '本地waiting任务或主动播放；无问号粒子',
    'running': '真实working任务或主动播放；原地工作',
    'review': '真实thinking任务或主动播放；探身复核',
    'held': '物理拖拽期间保持；菜单单次播放后回待机',
    'thrown': '真实抛掷时由物理接管；菜单单次播放后回待机',
    'landing': '真实落地触发；压缩、回弹、接回当前任务/造型',
    'peek-left': '共享身体配合局部遮罩，逐步从左侧出现',
    'peek-right': '共享身体配合局部遮罩，逐步从右侧出现',
    'turn': '共享右行/检查/左行/站姿四帧，短暂转向并回稳；独立于16向注视',
    'sway': '采用用户喜欢的06生成歪头/下压姿态，首尾回共享站姿',
    'sleep': '3分钟系统空闲或用户命令；保持低身闭眼，手动睡眠需唤醒',
    'wake': '一眼睁开、身体回正；自然或手动唤醒',
    'headphone-groove': '耳机道具独立节拍与身体点头',
    'skate': '滑板道具与向右步态；实际巡游位置由宿主移动',
    'skate-jump': '真实跳跃源帧与滑板附着，附加小幅抬升',
    'wizard-charge': '紫帽/法杖蓄势，等待核心身体配合道具延迟',
    'wizard-cast': '挥手核心身体与法杖招牌源帧，局部发光效果在演出层',
    'hardhat-work': '安全帽/工具招牌帧配合原地工作身体',
    'detective-inspect': '侦探帽/镜招牌帧配合检查身体',
    'chef-prepare': '厨帽与工作台；台面固定地面，帽子跟随身体',
    'cowboy-tip': '牛仔帽招牌帧与挥手身体',
    'football': '隐藏动作，球只在局部源帧出现；不扩充公开衣柜数量',
}
lines = ['# 动作、造型与演出实录', '',
    '本表由当前 `animations.json` 生成。核心九行来自独立生成条带；扩展动作包含独立生成姿态、共享核心身体、附件节拍、遮罩和桌面物理编排，并非28套独立手绘身体。', '',
    '| 动作 | 单次素材节拍 | 真实源 | 触发与编排 |', '| --- | ---: | --- | --- |']
for name, d in m['animations'].items():
    atlas = d.get('atlas', m['atlas'])
    durations = '/'.join(str(v) for v in d['durations'])
    source = f"{atlas} · row {d['row']} · {d.get('startFrame',0)}起{d['count']}格"
    lines.append(f"| {labels.get(name,name)} `{name}` | {sum(d['durations'])/1000:g}s（{durations}ms） | {source} | {notes[name]} |")
lines += ['', '普通独立动作播放一轮后回待机；巡游、物理抛掷和持续任务按当前状态保持，睡眠持续至唤醒。动作剧场允许暂停/逐帧/重播，用于检查，不代表真实桌面物理。', '',
    '中断时取消旧演出和待发单击：用户/系统暂停优先，其次拖拽和抛掷、真实任务、用户动作、自主日常。临时演出造型不写入持久衣柜，结束后回原造型，并留20秒安静间隔；减少动态时保留静态主体。', '',
    '公开衣柜共8套：默认、耳机、滑板、巫师、安全帽、侦探、厨师、牛仔。所有衣柜都叠加同一核心身体，站姿、眨眼、移动与回稳使用共享帧，道具按自己的节拍播放。足球是隐藏扩展。', '',
    '| 演出 | 时长 | 进入、高潮与退出 |', '| --- | ---: | --- |',
    '| 欢迎屏裂开一条缝 | 3.2s | 欢迎卡进入；纸边遮罩下探出、跨边；跳下落地、挥手，恢复日常尺寸 |',
    '| You’re Absolutely Right! | 4.8s | 起跳紫帽；放射标记、粗体标题与四只持物小蟹；纸面回收、主蟹归位 |',
    '| 陶土星印 | 4s | 蓄势；放射标记与局部像素分合，双眼中心可追踪；聚回并回到原造型 |',
    '| 小蟹合奏 | 5.5s | 配角从左右入场；错拍短跳与工作台；同步跳、两侧退场、恢复衣柜 |', '',
    '演出为实时Canvas时间轴；默认无声。日常不随机播放大型演出。仅首次欢迎、用户主动触发，或动作剧场验收时播放。真实任务失败不会触发海报庆祝。', '']
(root / 'docs/action-catalog.md').write_text('\n'.join(lines), encoding='utf-8')
print(f'Documented {len(m["animations"])} actual descriptors; look available: {bool(m.get("look"))}')
