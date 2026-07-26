const P = [];

// —— 生图参数卡：统一 96px 标签列，控件左缘全部对齐 ——
P.push(`<section class="card">
  <div class="card-h">
    <div><span class="ord">STEP 01 / 04</span><strong>资产生成参数</strong></div>
    <span class="pill ok"><i></i>已解析 24</span>
  </div>
  <div class="form">
    <div class="row"><label>风格预设</label><div class="ctl">
      <div class="seg"><button class="on">写实电影</button><button>动画</button><button>写意</button></div>
    </div></div>
    <div class="row"><label>风格参考图</label><div class="ctl">
      <div class="upl" style="flex:1"><u></u><span>拖入或点击上传 · PNG / JPG</span></div>
      <button class="btn">选择文件</button>
    </div></div>
    <div class="row"><label>绑定目标</label><div class="ctl">
      <input class="inp" value="主角 · 猎人 阿岩"/>
      <button class="btn">绑定参考图</button>
    </div></div>
    <div class="row"><label>输出比例</label><div class="ctl">
      <div class="seg"><button class="on">9:16</button><button>16:9</button><button>1:1</button></div>
    </div></div>
  </div>
  <div class="card-f"><small>参数改动只影响后续生成，已有资产不受影响。</small><button class="cta">生成资产</button></div>
</section>`);

// —— 分镜墙：媒体优先 ——
P.push(`<section class="card">
  <div class="card-h">
    <div><span class="ord">STEP 03 / 04</span><strong>视频 Take</strong></div>
    <span class="pill run"><i></i>4 / 6 生成中</span>
  </div>
  <div class="shots">
    ${[
      ['f1','01','雪原远景 · 推轨','ok','已完成','4.2s'],
      ['f2','02','阿岩侧脸特写','ok','已完成','3.6s'],
      ['f3','03','篝火夜谈','run','生成中','5.0s'],
      ['f4','04','','idle','',''],
    ].map(([f,n,t,st,lbl,dur]) => `
      <div class="shot${n==='03'?' sel':''}">
        <div class="frame ${f}">
          <b>${n}</b>
          ${st==='idle' ? `<div class="empty" style="position:absolute;inset:0"><u></u><span>待生成</span></div>` : `
          <em><i style="background:${st==='ok'?'var(--ok)':'var(--amb)'};box-shadow:0 0 7px ${st==='ok'?'var(--ok)':'var(--amb)'}"></i>${lbl}</em>
          <span>${dur}</span>`}
        </div>
        <p>${t || '未命名镜头'}</p>
      </div>`).join('')}
  </div>
  <div class="card-f"><small>点选镜头后可单独重生成；批量生成会跳过已完成片段。</small><button class="cta">批量生成剩余</button></div>
</section>`);

// —— 成片卡：上排预览+规格，下排全宽段轨 ——
const SEG = [['g1','01','已完成','var(--ok)'],['g2','02','已完成','var(--ok)'],['g3','03','已完成','var(--ok)'],
             ['g4','04','已完成','var(--ok)'],['g5','05','生成中','var(--amb)'],['g6','06','待生成','#3A3A46']];
P.push(`<section class="card">
  <div class="card-h">
    <div><span class="ord">STEP 04 / 04</span><strong>组装成片</strong></div>
    <span class="pill idle"><i></i>未组装</span>
  </div>
  <div class="cut">
    <div class="cut-top">
      <div class="cut-prev"><div class="play">\u25B6</div></div>
      <div class="cut-info">
        <div class="specs">
          <dl class="spec"><dt>OUTPUT</dt><dd>1080\u00D71920</dd></dl>
          <dl class="spec"><dt>FRAMERATE</dt><dd>24 <u>fps</u></dd></dl>
          <dl class="spec"><dt>SEGMENTS</dt><dd>4 / 6 <u>就绪</u></dd></dl>
          <dl class="spec"><dt>DURATION</dt><dd>00:26</dd></dl>
        </div>
        <div class="note"><b>ASSEMBLY RULES</b><ul><li>按镜号顺序硬切拼接，不插入转场</li><li>统一缩放至 1080\u00D71920，不足部分补黑边</li><li>保留各片段原声，不做混音或响度归一</li><li>全部片段完成后才能组装，缺片时服务端返回缺失镜号</li></ul></div>
      </div>
      <div class="dl"><u></u><div><b>rough_cut.mp4</b><small>尚未生成</small></div><button class="btn">下载成片</button></div>
    </div>
    <div class="track">
      <div class="track-h"><span class="eyebrow">Assembly order</span><span>6 段 · 按镜号顺序硬切</span></div>
      <div class="segs">${SEG.map(([g,n,l,c]) => `
        <div class="seg-c"><div class="seg-f ${g}"><b>${n}</b><i style="background:${c};box-shadow:0 0 6px ${c}"></i></div><p>${l}</p></div>`).join('')}</div>
    </div>
  </div>
  <div class="card-f"><small>还有 2 段未完成，组装按钮将在全部就绪后启用。</small><button class="cta">组装成片</button></div>
</section>`);

document.getElementById('wrap').innerHTML = P.join('');
