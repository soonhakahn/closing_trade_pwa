import { openDb, put, del, get, listByIndex, listAll, clearAll } from './db.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uuid(){
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] % 16) | 0;
    const v = c==='x'? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function todayKST(){
  // Use local time; device should be KST.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const da = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}

function pct(n){
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${(n*100).toFixed(2)}%`;
}

function num(n){
  if (n === null || n === undefined || n === '') return '-';
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return x.toLocaleString('ko-KR');
}

let db;
let state = { tab: 'auto', date: todayKST() };

async function init(){
  db = await openDb();
  $('#date').value = state.date;
  bindTabs();
  bindActions();
  await render();

  // Register SW
  if ('serviceWorker' in navigator){
    try { await navigator.serviceWorker.register('./sw.js'); } catch(e) {}
  }
}

function bindTabs(){
  $$('.tab').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      state.tab = btn.dataset.tab;
      $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===state.tab));
      await render();
    });
  });
}

function bindActions(){
  $('#date').addEventListener('change', async (e)=>{
    state.date = e.target.value;
    await render();
  });

  $('#reloadAuto').addEventListener('click', async ()=>{
    await renderAuto(true);
  });

  $('#addCandidate').addEventListener('click', async ()=>{
    const symbol = $('#c_symbol').value.trim();
    const name = $('#c_name').value.trim();
    if (!symbol) return alert('종목코드를 입력해주세요');
    const rec = {
      id: uuid(),
      date: state.date,
      symbol,
      name,
      theme: $('#c_theme').value.trim(),
      newsTier: $('#c_newsTier').value,
      pattern: $('#c_pattern').value,
      notes: $('#c_notes').value.trim(),
      checklist: {
        liquidity: $('#ck_liquidity').checked,
        leader: $('#ck_leader').checked,
        candle: $('#ck_candle').checked,
        position: $('#ck_position').checked,
        minute: $('#ck_minute').checked,
        orderbook: $('#ck_orderbook').checked,
        afterHours: $('#ck_afterhours').checked,
      },
      createdAt: Date.now()
    };
    await put(db, 'candidates', rec);
    $('#c_symbol').value=''; $('#c_name').value=''; $('#c_theme').value=''; $('#c_notes').value='';
    await renderToday();
  });

  $('#clearAll').addEventListener('click', async ()=>{
    if (!confirm('모든 로컬 데이터를 삭제할까요? (복구 불가)')) return;
    await clearAll(db);
    await render();
  });

  $('#exportJson').addEventListener('click', async ()=>{
    const data = {
      exportedAt: new Date().toISOString(),
      candidates: await listAll(db,'candidates'),
      trades: await listAll(db,'trades'),
      settings: await listAll(db,'settings')
    };
    const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `closing-trade-${todayKST()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#importJson').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    const text = await f.text();
    const data = JSON.parse(text);
    if (data.candidates) for (const r of data.candidates) await put(db,'candidates',r);
    if (data.trades) for (const r of data.trades) await put(db,'trades',r);
    if (data.settings) for (const r of data.settings) await put(db,'settings',r);
    e.target.value='';
    await render();
    alert('가져오기 완료');
  });

  $('#addTrade').addEventListener('click', async ()=>{
    const symbol = $('#t_symbol').value.trim();
    if(!symbol) return alert('종목코드를 입력해주세요');
    const entry = Number($('#t_entry').value);
    const exit = Number($('#t_exit').value);
    const qty = Number($('#t_qty').value || 0);
    const pnl = (entry && exit) ? (exit-entry)/entry : null;

    const rec = {
      id: uuid(),
      date: $('#t_date').value || state.date,
      symbol,
      name: $('#t_name').value.trim(),
      entry, exit, qty,
      pnl,
      plan: $('#t_plan').value.trim(),
      result: $('#t_result').value.trim(),
      createdAt: Date.now()
    };
    await put(db,'trades',rec);
    ['#t_symbol','#t_name','#t_entry','#t_exit','#t_qty','#t_plan','#t_result'].forEach(s=>$(s).value='');
    await renderJournal();
  });
}

async function render(){
  $('#panel-auto').style.display = state.tab==='auto' ? '' : 'none';
  $('#panel-today').style.display = state.tab==='today' ? '' : 'none';
  $('#panel-patterns').style.display = state.tab==='patterns' ? '' : 'none';
  $('#panel-journal').style.display = state.tab==='journal' ? '' : 'none';
  $('#panel-stats').style.display = state.tab==='stats' ? '' : 'none';
  $('#panel-settings').style.display = state.tab==='settings' ? '' : 'none';

  if (state.tab==='auto') return renderAuto();
  if (state.tab==='today') return renderToday();
  if (state.tab==='patterns') return renderPatterns();
  if (state.tab==='journal') return renderJournal();
  if (state.tab==='stats') return renderStats();
  if (state.tab==='settings') return renderSettings();
}

async function renderAuto(bustCache=false){
  const list = $('#autoList');
  list.innerHTML = '';
  $('#autoDate').textContent = '-';
  $('#autoGen').textContent = '-';
  $('#autoMarket').textContent = '-';

  try{
    const ts = bustCache ? `?ts=${Date.now()}` : '';
    const res = await fetch(`./reports/today.json${ts}`, { cache: 'no-store' });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    $('#autoDate').textContent = data.date || '-';
    $('#autoGen').textContent = (data.generatedAt || '-').replace('T',' ').replace(/\+09:00$/,'');

    const p = data?.market?.program;
    if(p){
      $('#autoMarket').textContent = `프로그램(참고): buy=${p.buy ?? '-'} sell=${p.sell ?? '-'} net=${p.net ?? '-'} · ${p.note || ''}`;
    }

    const items = (data.candidates || []).slice(0, 20);
    for (const it of items){
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="top">
          <div><b>${it.code}</b> <span class="small">${it.name||''}</span></div>
          <span class="badge">Score ${it.leaderScore ?? '-'} · ${it.market||''} · 거래대금rank ${it.amountRank ?? '-'}</span>
        </div>
        <div class="small" style="margin-top:6px">등락률: ${it.rate==null?'-':(it.rate*100).toFixed(2)+'%'} · 거래대금(원단위 아님/원문표기 기반): ${num(it.amount)} · 외국인상위참고: ${it.foreignTop?'Y':'-'}</div>
        <div class="row" style="margin-top:10px">
          <button class="btn ok" data-act="save" data-code="${it.code}">오늘 후보로 저장</button>
          <button class="btn" data-act="copy" data-code="${it.code}">요약 복사</button>
        </div>
      `;
      list.appendChild(el);
    }

    list.querySelectorAll('button[data-act]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const act = btn.dataset.act;
        const code = btn.dataset.code;
        const it = (data.candidates||[]).find(x=>x.code===code);
        if(!it) return;

        if(act==='copy'){
          const text = `[자동후보] ${data.date}\n- ${it.code} ${it.name||''}\n- Score:${it.leaderScore ?? '-'} 거래대금rank:${it.amountRank ?? '-'} 등락:${it.rate==null?'-':(it.rate*100).toFixed(2)+'%'}\n- 참고: 외국인상위=${it.foreignTop?'Y':'-'}\n(앱에서 체크리스트/패턴 확인 후 종가 접근)`;
          await navigator.clipboard.writeText(text);
          alert('복사 완료');
        }

        if(act==='save'){
          // Save as candidate with minimal fields
          const rec = {
            id: uuid(),
            date: state.date,
            symbol: it.code,
            name: it.name || '',
            theme: '',
            newsTier: 'Tier2(단독/핵심)',
            pattern: '패턴1(20MA 회복)',
            notes: `자동후보 Score:${it.leaderScore ?? '-'} 거래대금rank:${it.amountRank ?? '-'} 외국인상위:${it.foreignTop?'Y':'-'}`,
            checklist: { liquidity:true, leader:true, candle:false, position:false, minute:false, orderbook:false, afterHours:false },
            createdAt: Date.now()
          };
          await put(db, 'candidates', rec);
          alert('오늘 후보로 저장했습니다. "오늘 후보" 탭에서 체크리스트/메모를 추가하세요.');
        }
      });
    });

  }catch(e){
    list.innerHTML = `<div class="small">자동 후보 로드 실패: ${escapeHtml(String(e))}<br>보고서 파일이 아직 없거나 캐시일 수 있습니다. (설정→Export/Import는 로컬 데이터용이며 자동 후보는 reports/today.json을 읽습니다)</div>`;
  }
}

async function renderToday(){
  const items = (await listByIndex(db,'candidates','byDate',state.date))
    .sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));

  $('#todayCount').textContent = String(items.length);
  const list = $('#candidateList');
  list.innerHTML = '';

  for (const it of items){
    const okCount = Object.values(it.checklist||{}).filter(Boolean).length;
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="top">
        <div><b>${it.symbol}</b> ${it.name?`<span class="small">${it.name}</span>`:''}</div>
        <span class="badge">${it.newsTier} · ${it.pattern} · 체크 ${okCount}/7</span>
      </div>
      <div class="small" style="margin-top:6px">테마: ${it.theme || '-'} · 메모: ${escapeHtml(it.notes||'')}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn" data-act="copy" data-id="${it.id}">텔레그램용 복사</button>
        <button class="btn ok" data-act="toTrade" data-id="${it.id}">저널로 가져오기</button>
        <button class="btn danger" data-act="del" data-id="${it.id}">삭제</button>
      </div>
    `;
    list.appendChild(el);
  }

  list.querySelectorAll('button[data-act]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const rec = await get(db,'candidates',id);
      if(!rec) return;
      if(act==='del'){
        if(!confirm('삭제할까요?')) return;
        await del(db,'candidates',id);
        await renderToday();
      }
      if(act==='copy'){
        const text = buildTelegramCandidateText(rec);
        await navigator.clipboard.writeText(text);
        alert('복사 완료. 텔레그램(@shahn01bot)으로 붙여넣기 하세요.');
      }
      if(act==='toTrade'){
        // Prefill trade form
        state.tab='journal';
        $$('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===state.tab));
        $('#t_date').value = rec.date;
        $('#t_symbol').value = rec.symbol;
        $('#t_name').value = rec.name || '';
        $('#t_plan').value = `뉴스:${rec.newsTier} / 패턴:${rec.pattern} / 테마:${rec.theme||'-'}\n체크:${Object.entries(rec.checklist||{}).filter(([,v])=>v).map(([k])=>k).join(', ')}`;
        await render();
      }
    });
  });
}

function buildTelegramCandidateText(rec){
  const ck = rec.checklist||{};
  const ok = Object.entries(ck).filter(([,v])=>v).map(([k])=>k);
  return [
    `[종가후보] ${rec.date}`,
    `- 종목: ${rec.symbol} ${rec.name||''}`.trim(),
    `- 테마: ${rec.theme||'-'}`,
    `- 뉴스: ${rec.newsTier}`,
    `- 패턴: ${rec.pattern}`,
    `- 체크(OK): ${ok.length? ok.join(', ') : '-'}`,
    rec.notes?`- 메모: ${rec.notes}`:null,
    `\n[루틴] 15:59 시간외 잔량 체크 → 익일 09:00~09:05 전량 청산(원칙)`
  ].filter(Boolean).join('\n');
}

async function renderPatterns(){
  $('#patternsText').innerHTML = `
  <div class="kv">
    <div class="badge">패턴 1</div><div><b>신고가 영역 개미털기 후 20MA 회복</b><div class="small">10~40일 조정 후 20일선 재회복 + 거래량 동반</div></div>
    <div class="badge">패턴 2</div><div><b>장대양봉 후 5MA 위 가격 방어</b><div class="small">대량 음봉에도 종가가 5일선 위 유지</div></div>
    <div class="badge">패턴 3</div><div><b>엔벨로프(20,40) 돌파 후 7/15MA 지지</b><div class="small">돌파→눌림→지지 확인 후 종가 접근</div></div>
  </div>`;
}

async function renderJournal(){
  // preset date
  if(!$('#t_date').value) $('#t_date').value = state.date;

  const trades = (await listAll(db,'trades')).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  $('#tradeCount').textContent = String(trades.length);
  const list = $('#tradeList');
  list.innerHTML='';
  for (const t of trades){
    const el = document.createElement('div');
    el.className='item';
    el.innerHTML = `
      <div class="top">
        <div><b>${t.symbol}</b> ${t.name?`<span class="small">${t.name}</span>`:''}</div>
        <span class="badge">${t.date} · 수익 ${t.pnl===null?'-':pct(t.pnl)}</span>
      </div>
      <div class="small" style="margin-top:6px">진입 ${num(t.entry)} · 청산 ${num(t.exit)} · 수량 ${num(t.qty)}</div>
      ${t.plan?`<div class="small" style="margin-top:6px">플랜: ${escapeHtml(t.plan)}</div>`:''}
      ${t.result?`<div class="small" style="margin-top:6px">결과: ${escapeHtml(t.result)}</div>`:''}
      <div class="row" style="margin-top:10px">
        <button class="btn" data-act="copy" data-id="${t.id}">요약 복사</button>
        <button class="btn danger" data-act="del" data-id="${t.id}">삭제</button>
      </div>
    `;
    list.appendChild(el);
  }
  list.querySelectorAll('button[data-act]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const rec = await get(db,'trades',id);
      if(!rec) return;
      if(act==='del'){
        if(!confirm('삭제할까요?')) return;
        await del(db,'trades',id);
        await renderJournal();
      }
      if(act==='copy'){
        const text = `[종가매매 결과] ${rec.date}\n- ${rec.symbol} ${rec.name||''}\n- 진입:${rec.entry||'-'} / 청산:${rec.exit||'-'} / 수익:${rec.pnl===null?'-':pct(rec.pnl)}\n- 메모:${rec.result||'-'}`;
        await navigator.clipboard.writeText(text);
        alert('복사 완료');
      }
    })
  });
}

async function renderStats(){
  const trades = await listAll(db,'trades');
  const pnls = trades.map(t=>t.pnl).filter(x=>typeof x==='number' && !Number.isNaN(x));
  const wins = pnls.filter(x=>x>0).length;
  const loss = pnls.filter(x=>x<0).length;
  const winRate = pnls.length? wins/pnls.length : 0;
  const avg = pnls.length? pnls.reduce((a,b)=>a+b,0)/pnls.length : 0;

  // simple equity curve + max drawdown (assume equal weight per trade)
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of pnls){
    eq *= (1+r);
    if (eq>peak) peak=eq;
    const dd = (peak-eq)/peak;
    if (dd>mdd) mdd=dd;
  }

  $('#statsBox').innerHTML = `
    <div class="kv">
      <div class="small">총 거래</div><div><b>${pnls.length}</b></div>
      <div class="small">승/패</div><div><b>${wins}</b> / ${loss}</div>
      <div class="small">승률</div><div><b>${(winRate*100).toFixed(1)}%</b></div>
      <div class="small">평균 수익률</div><div><b>${pct(avg)}</b></div>
      <div class="small">누적(가정)</div><div><b>${((eq-1)*100).toFixed(1)}%</b></div>
      <div class="small">MDD(가정)</div><div><b>${(mdd*100).toFixed(1)}%</b></div>
    </div>
    <hr>
    <div class="small">※ 통계는 ‘거래당 동일 비중’ 가정의 간이 계산입니다. (초보용)</div>
  `;
}

async function renderSettings(){
  // show quick tips
  $('#settingsText').innerHTML = `
    <div class="small">
      <b>알림(텔레그램)</b><br>
      iOS PWA는 자동 붙여넣기가 제한됩니다. 따라서 후보/결과를 "복사" 후 텔레그램 @shahn01bot에 붙여넣는 UX로 설계했습니다.<br><br>
      <b>자동 시세/뉴스</b><br>
      2번에서 "자동"도 선택하셔서, 다음 단계에서 무료 소스 기반(제약 있음)으로 옵션을 붙일 수 있게 구조를 열어둘게요.
    </div>
  `;
}

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, (c)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

init();
