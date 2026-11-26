const DB = 'thermo-expert-vladimir-v1';
const $ = id => document.getElementById(id);
const defaults = {
  clients: [], orders: [], findings: [], reports: [],
  prices: [
    ['Обстеження будинку', 1500], ['Тепла підлога', 500], ['Електропроводка', 700],
    ['Додаткове приміщення', 150], ['PDF-звіт', 300]
  ]
};
let data = defaults;
let storageBlocked = false;
let currentPdf = null;
let screens = ['home'];
let activeClientId = null;
let editingClientId = null;
let conclusionClientId = null;
const conclusionDrafts = new Map();

function validate(source) {
  if (!source || !Object.keys(defaults).every(key => Array.isArray(source[key]))) {
    throw new Error('Invalid database');
  }
  for (const key of ['clients', 'orders', 'findings', 'reports']) {
    if (source[key].some(record => !record || typeof record.id !== 'string')) {
      throw new Error('Invalid record');
    }
  }
  if (source.reports.some(report => !Array.isArray(report.findings)) ||
      source.orders.some(order => !Number.isFinite(+order.total)) ||
      source.prices.some(price => !Array.isArray(price) || typeof price[0] !== 'string' ||
        !Number.isFinite(Number(price[1])))) {
    throw new Error('Invalid report, order or price');
  }
  return source;
}

function load() {
  try {
    const nativeData = window.Native ? Native.loadData() : '';
    if (nativeData === 'ERROR') throw new Error('Read failed');
    const raw = nativeData || localStorage.getItem(DB);
    if (raw) data = validate({ ...defaults, ...JSON.parse(raw) });
    if (window.Native) {
      if (!nativeData && !Native.saveData(JSON.stringify(data))) throw new Error('Write failed');
      Native.dailyBackup();
    }
  } catch (error) {
    storageBlocked = true;
    alert('Не вдалося прочитати або перенести дані. Для відновлення імпортуйте резервну копію.');
  }
}

function persist(next, restoring = false) {
  try {
    if (storageBlocked && !restoring) throw new Error('Storage blocked');
    const raw = JSON.stringify(next);
    if (window.Native) {
      if (!Native.saveData(raw)) throw new Error('Write failed');
    } else {
      localStorage.setItem(DB, raw);
    }
  } catch (error) {
    alert('Не вдалося зберегти дані.');
    return false;
  }
  data = next;
  storageBlocked = false;
  if (window.Native && !Native.dailyBackup()) {
    alert('Дані збережено, але автоматичну копію створити не вдалося.');
  }
  render();
  return true;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function photoMarkup(photo) {
  if (typeof photo !== 'string' || !/^data:image\/[\w.+-]+;base64,[\w+/=\s]+$/i.test(photo)) return '';
  return '<img class="photo" alt="Фото обстеження" src="' + esc(photo) + '">';
}

// Category indexes are shared by the two existing 100-entry catalogs.
const inspectionCategoryMap = Object.freeze({
  'Будинок / тепловтрати':Object.freeze([2,3,4,7]),
  'Тепла підлога':Object.freeze([6]),
  'Електропроводка':Object.freeze([0,1]),
  'Система опалення':Object.freeze([5,6]),
  'Інженерні системи':Object.freeze([8,7]),
  'Енергоаудит':Object.freeze([9,2,3,4,5,8])
});
function inspectionCategories(type, showAll=false) {
  return showAll ? Array.from({length:10},(_,i)=>i) : (inspectionCategoryMap[type]||[]);
}

function showScreen() {
  const screen = screens[screens.length - 1];
  document.body.classList.toggle('home-screen', screen === 'home');
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === screen);
  });
  document.querySelectorAll('nav button').forEach(button => {
    const selected = button.dataset.tab === screens[0];
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('backButton').hidden = screens.length === 1 && screen === 'home';
  if (screen === 'archive') renderPdfs();
  if (screen === 'clientDirectory') renderClientDirectory();
  if (screen === 'clientHistory') renderClientHistory();
  window.scrollTo(0, 0);
}

function tab(id, root = false) {
  if (root) screens = [id];
  else if (screens[screens.length - 1] !== id) screens.push(id);
  showScreen();
}

function goBack() {
  if (screens.length > 1) screens.pop();
  else if (screens[0] !== 'home') screens = ['home'];
  else return false;
  document.activeElement?.blur();
  showScreen();
  return true;
}

document.querySelectorAll('nav button').forEach(button => {
  button.onclick = () => tab(button.dataset.tab, true);
});
$('backButton').onclick = goBack;
document.querySelectorAll('[data-inspection]').forEach(button => {
  button.onclick = () => {
    $('iType').value = button.dataset.inspection;
    $('iType').dispatchEvent(new Event('change',{bubbles:true}));
    tab('inspection');
  };
});

function addClient() {
  const name = $('cName').value.trim();
  if (!name) return alert('Вкажіть ім’я або назву клієнта');
  const client = {
    id: uid(), name, phone: $('cPhone').value, address: $('cAddress').value,
    type: $('cType').value, note: $('cNote').value
  };
  if (persist({ ...data, clients: [...data.clients, client] })) {
    ['cName', 'cPhone', 'cAddress', 'cNote'].forEach(id => $(id).value = '');
    $('cType').selectedIndex = 0;
    // Do not reassign unsaved measurements to a different client.
    const draftFields = ['iRoom', 'iAir', 'iSurface', 'iHumidity', 'iDefect', 'iRecommendation', 'iPhoto', 'iConclusion'];
    if (!draftFields.some(id => $(id).value)) $('iClient').value = client.id;
    renderFindings();
    document.activeElement?.blur();
    tab('home', true);
  }
}

function clientName(id) {
  return data.clients.find(client => client.id === id)?.name || 'Клієнт видалений';
}

function orderTotal() {
  return Math.max(0, Math.round((+$('oQty').value * +$('oPrice').value - +$('oDiscount').value) * 100) / 100);
}

function calcOrder() {
  $('oTotal').textContent = orderTotal().toFixed(2);
}

function addOrder() {
  const cid = $('oClient').value;
  if (!cid) return alert('Спочатку створіть клієнта');
  if (['oQty', 'oPrice', 'oDiscount', 'oPaid'].some(id => !$(id).checkValidity() || !$(id).value)) {
    return alert('Перевірте числові поля');
  }
  const order = {
    id: uid(), cid, service: $('oService').value, qty: +$('oQty').value, price: +$('oPrice').value,
    discount: +$('oDiscount').value, total: orderTotal(), paid: +$('oPaid').value,
    status: $('oStatus').value, date: new Date().toLocaleDateString('uk-UA')
  };
  persist({ ...data, orders: [order, ...data.orders] });
}

function readFile(file, readerMethod) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader[readerMethod](file);
  });
}

function inspectionResultFields() {
  return ['iRoom','iAir','iSurface','iHumidity','iDefect','iRecommendation','iPhoto'];
}

function clearInspectionResultFields() {
  inspectionResultFields().forEach(id => $(id).value = '');
  if (window.resetRecommendationState) window.resetRecommendationState();
  // Close both pickers and discard any checked, but not inserted, catalog entries.
  $('defClose').click();
  $('recClose').click();
}

async function addFinding() {
  const cid = $('iClient').value;
  if (!cid) return alert('Спочатку створіть клієнта');
  if (['iAir', 'iSurface', 'iHumidity'].some(id => !$(id).checkValidity())) {
    return alert('Перевірте температуру та вологість');
  }
  if (window.syncRecommendations) window.syncRecommendations();
  const finding = {
    id: uid(), cid, type: $('iType').value, room: $('iRoom').value, air: $('iAir').value,
    surface: $('iSurface').value, humidity: $('iHumidity').value, defect: $('iDefect').value,
    recommendation: $('iRecommendation').value, date: new Date().toLocaleDateString('uk-UA'),
    photo: ''
  };
  const file = $('iPhoto').files[0];
  if (file && file.size > 8000000) return alert('Фото завелике. Виберіть файл до 8 МБ.');
  $('addFindingButton').disabled = true;
  try {
    if (file) {
      finding.photo = await readFile(file, 'readAsDataURL');
      if (!photoMarkup(finding.photo)) throw new Error('Invalid photo');
    }
    if (persist({ ...data, findings: [...data.findings, finding] })) {
      clearInspectionResultFields();
    }
  } catch (error) {
    alert('Не вдалося прочитати фото.');
  } finally {
    $('addFindingButton').disabled = false;
  }
}

function pending(cid) {
  const used = new Set(data.reports.flatMap(report => report.findings));
  return data.findings.filter(finding => finding.cid === cid && !used.has(finding.id));
}


// Build the conclusion only from recommendations actually recorded by the expert.
// Keep multi-sentence catalog recommendations intact: safety conditions and
// qualifications must never be separated from the action they govern.
function recommendationKey(text) {
  return String(text).normalize('NFC').replace(/[’ʼ']/g,'’')
    .replace(/\s+/g,' ').trim().toLocaleLowerCase('uk');
}
function buildInspectionConclusion(findings) {
  const entries=new Map();
  for(const finding of findings){
    const location=String(finding.room||'').trim();
    const type=String(finding.type||'').trim();
    // Catalog entries and manual list items are newline-separated. Do not
    // split sentences or semicolons within one recommendation.
    const recommendations=String(finding.recommendation??'').split(/\r?\n/)
      .map(line=>line.trim().replace(/^(?:\d+[.)]|[•–-])\s+/u,'').trim()).filter(Boolean);
    for(const recommendation of recommendations){
      const key=recommendationKey(recommendation);
      if(!entries.has(key))entries.set(key,{text:recommendation,locations:new Set()});
      const entry=entries.get(key);
      if(location)entry.locations.add(location);
      else if(type)entry.locations.add(type);
    }
  }
  if(!entries.size)return {text:'',count:0};
  const blocks=[...entries.values()].map((entry,i)=>{
    const locations=[...entry.locations];
    return (i+1)+'. '+entry.text+(locations.length?'\nДілянка / напрямок: '+locations.join('; '):'');
  });
  // This is an explicitly general follow-up, not an inferred diagnosis.
  const followUp='Після усунення підтверджених дефектів провести повторне тепловізійне обстеження за порівнянних умов.';
  if(![...entries.values()].some(entry=>recommendationKey(entry.text)===recommendationKey(followUp))){
    blocks.push('Загальна рекомендація\n'+followUp);
  }
  return {text:blocks.join('\n\n'),count:entries.size};
}

function conclusionHtml(value) {
  return String(value||'Висновок не внесено').split('\n').map(line=>{
    const safe=esc(line);
    return /^\d+\.\s+\S/.test(line)||line==='Загальна рекомендація'?'<b>'+safe+'</b>':safe;
  }).join('<br>');
}
function rememberConclusionDraft() {
  if(conclusionClientId===null)return;
  const old=conclusionDrafts.get(conclusionClientId);
  if(old)old.value=$('iConclusion').value;
}
function updateConclusionPreview() {
  const value=$('iConclusion').value;
  $('conclusionPreview').hidden=!value.trim();
  $('conclusionFormatted').innerHTML=conclusionHtml(value);
}
function syncInspectionConclusion(force=false) {
  const cid=$('iClient').value, field=$('iConclusion');
  if(conclusionClientId!==cid){
    rememberConclusionDraft();conclusionClientId=cid;
    field.value=conclusionDrafts.get(cid)?.value||'';
  }
  const findings=pending(cid);
  const generated=buildInspectionConclusion(findings);
  const old=conclusionDrafts.get(cid)||{value:field.value,automatic:'',signature:''};
  const signature=JSON.stringify(findings.map(f=>[f.id,f.type,f.room,f.air,f.surface,f.humidity,f.defect,f.recommendation]));
  const manual=field.value!==old.automatic;
  if(force||!manual){
    field.value=generated.text;
    conclusionDrafts.set(cid,{value:field.value,automatic:generated.text,signature});
    $('conclusionStatus').textContent=generated.count?'Висновок сформовано з рекомендацій: '+generated.count+'. Перевірте перед збереженням.':findings.length?'У доданих результатах немає рекомендацій. Внесіть їх або заповніть висновок вручну.':'Додайте результати обстеження.';
  }else{
    old.value=field.value;conclusionDrafts.set(cid,old);
    $('conclusionStatus').textContent=old.signature!==signature?'Результати змінилися. Ручний висновок збережено; перевірте або оновіть його.':'Ручний висновок збережено. Перевірте перед збереженням.';
  }
  updateConclusionPreview();
  return field.value;
}
function refreshInspectionConclusion() {
  const state=conclusionDrafts.get($('iClient').value);
  if(state&&$('iConclusion').value!==state.automatic&&!confirm('Замінити власноруч відредагований висновок автоматичним?'))return;
  syncInspectionConclusion(true);
}

function saveReport() {
  if ($('addFindingButton').disabled) return alert('Дочекайтеся збереження поточного результату.');
  const cid = $('iClient').value;
  if (!cid) return alert('Оберіть клієнта');
  const findings = pending(cid);
  if (!findings.length) return alert('Додайте хоча б один результат обстеження');
  if (inspectionResultFields().some(id => $(id).value.trim()) &&
      !confirm('У формі є недоданий результат. Він не увійде до звіту. Зберегти наявні результати й очистити форму?')) return;
  const report = {
    id: uid(), cid, type: findings[findings.length - 1].type,
    findings: findings.map(finding => finding.id), conclusion: syncInspectionConclusion(),
    expert: $('iExpert').value, date: new Date().toLocaleDateString('uk-UA'),
    client: { ...data.clients.find(client => client.id === cid) }
  };
  if (persist({ ...data, reports: [report, ...data.reports] })) {
    clearInspectionResultFields();
    $('iConclusion').value = '';
    conclusionDrafts.delete(cid);conclusionClientId=null;syncInspectionConclusion();
    if (activeClientId === cid && screens[screens.length - 2] === 'clientHistory') goBack();
    else tab('archive', true);
  }
}

function makeReport() {
  const cid = $('iClient').value;
  if (!cid) return alert('Оберіть клієнта');
  const findings = pending(cid);
  if (!findings.length) return alert('Немає результатів для звіту');
  showReport(data.clients.find(client => client.id === cid), findings, syncInspectionConclusion(),
    $('iExpert').value, new Date().toLocaleDateString('uk-UA'));
}

function sharePdf() {
  if (currentPdf && window.Native) Native.sharePdf(JSON.stringify(currentPdf));
  else alert('Надсилання PDF доступне в Android.');
}

function renderPdfs() {
  const box = $('pdfList');
  box.textContent = '';
  try {
    const files = window.Native ? JSON.parse(Native.listPdfs()) : [];
    if (!files.length) box.textContent = 'Немає збережених PDF';
    for (const name of files) {
      const row = document.createElement('div');
      row.className = 'item';
      const label = document.createElement('p');
      label.textContent = name;
      row.append(label);
      const actions = document.createElement('div');
      actions.className = 'actions';
      for (const share of [false, true]) {
        const button = document.createElement('button');
        button.className = 'secondary';
        button.textContent = share ? 'Надіслати' : 'Відкрити';
        button.onclick = () => Native.archivedPdf(name, share);
        actions.append(button);
      }
      row.append(actions);
      box.append(row);
    }
  } catch (error) {
    box.textContent = 'Не вдалося прочитати архів PDF';
  }
}

function savePdf() {
  if (currentPdf && window.Native) Native.savePdf(JSON.stringify(currentPdf));
  else window.print();
}

function showReport(client, findings, conclusion, expert, date, title = '', conditions = '') {
  currentPdf = { c: client, fs: findings, conclusion, expert, date, title, conditions };
  const body = findings.map((finding, index) => `
    <div class="card">
      <h3>${index + 1}. ${esc(finding.room || finding.type)}</h3>
      <p><b>Напрямок:</b> ${esc(finding.type)}</p>
      <p><b>Температура повітря:</b> ${esc(finding.air || 'не вказано')} °C</p>
      <p><b>Температура поверхні:</b> ${esc(finding.surface || 'не вказано')} °C</p>
      <p><b>Вологість:</b> ${esc(finding.humidity || 'не вказано')} %</p>
      <p><b>Спостереження:</b> ${esc(finding.defect || 'Не зазначено')}</p>
      <p><b>Рекомендації:</b> ${esc(finding.recommendation || 'Не зазначено')}</p>
      ${photoMarkup(finding.photo)}
    </div>`).join('');
  $('reportContent').innerHTML = `
    <h2>${esc(title || 'ЗВІТ ТЕПЛОВІЗІЙНОГО ОБСТЕЖЕННЯ')}</h2>
    <p><b>THERMO EXPERT VLADIMIR</b></p>
    <p>Дата: ${esc(date)}</p>
    <p><b>Замовник:</b> ${esc(client.name)}<br><b>Телефон:</b> ${esc(client.phone)}<br>
       <b>Адреса об’єкта:</b> ${esc(client.address)}<br><b>Тип об’єкта:</b> ${esc(client.type)}</p>
    ${conditions ? `<div class="card"><h3>Умови та методика</h3><p>${esc(conditions).replace(/\n/g, '<br>')}</p></div>` : ''}
    <h3>Результати обстеження</h3>${body}
    <div class="card">
      <h3>Підсумковий висновок експерта</h3>
      <p>${conclusionHtml(conclusion)}</p>
      <p><b>Виконавець:</b> ${esc(expert)}</p>
      <p>Підпис: ____________________</p>
    </div>
    <p class="muted">Висновок потребує перевірки й затвердження відповідальним фахівцем.</p>`;
  tab('report');
}

function updateOrderPrice() {
  const price = data.prices.find(entry => entry[0] === $('oService').value);
  if (price) $('oPrice').value = price[1];
  calcOrder();
}

function savePrices() {
  const fields = Array.from(document.querySelectorAll('[data-price]'));
  if (fields.some(field => !field.checkValidity() || !field.value)) return alert('Перевірте ціни');
  const prices = data.prices.map(([name], index) => [name, +fields[index].value]);
  if (persist({ ...data, prices })) {
    updateOrderPrice();
    alert('Прайс збережено');
  }
}

function backup() {
  if (storageBlocked) return alert('Спробуйте експортувати останню автоматичну копію.');
  const json = JSON.stringify(data, null, 2);
  if (window.Native) return Native.exportBackup(json);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'thermo-expert-backup.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDailyBackup() {
  if (window.Native) Native.exportDailyBackup();
  else alert('Експорт автоматичної копії доступний в Android.');
}

async function restore(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  try {
    const restored = validate(JSON.parse(await readFile(file, 'readAsText')));
    if (restored.findings.some(finding => finding.photo && !photoMarkup(finding.photo))) {
      throw new Error('Invalid backup photo');
    }
    if (confirm('Замінити поточні дані резервною копією?') && persist(restored, true)) {
      currentPdf = null;
      conclusionDrafts.clear();conclusionClientId=null;$('iConclusion').value='';syncInspectionConclusion();
      alert('Резервну копію відновлено');
    }
  } catch (error) {
    alert('Не вдалося прочитати файл резервної копії');
  } finally {
    input.value = '';
  }
}

function openArchived(index) {
  const report = data.reports[index];
  if (!report) return;
  const client = report.client || data.clients.find(entry => entry.id === report.cid) ||
    { name: 'Клієнт видалений' };
  showReport(client, data.findings.filter(finding => report.findings.includes(finding.id)),
    report.conclusion, report.expert, report.date, report.title, report.conditions);
}


function clientReports(cid) {
  return data.reports.filter(report => report.cid === cid);
}
function openClientDirectory() {
  $('clientSearch').value = '';
  tab('clientDirectory');
}
function renderClientDirectory() {
  const raw = $('clientSearch').value.trim().toLocaleLowerCase('uk');
  const digits = raw.replace(/\D/g, '');
  const phoneQuery = digits.length >= 2 && /^[+\d\s().-]+$/.test(raw);
  const clients = data.clients.filter(c => !raw ||
    [c.name,c.phone,c.address,c.type].some(v => String(v||'').toLocaleLowerCase('uk').includes(raw)) ||
    (phoneQuery && String(c.phone||'').replace(/\D/g,'').includes(digits)));
  $('directoryCount').textContent = 'Клієнтів: ' + clients.length + ' / ' + data.clients.length;
  const list=$('directoryList'); list.replaceChildren();
  if (!clients.length) {list.textContent=raw?'Клієнтів не знайдено':'Поки немає клієнтів';return;}
  for (const client of clients) {
    const row=document.createElement('div');row.className='item';
    const b=document.createElement('button');b.type='button';b.className='secondary directory-client';
    b.innerHTML='<b>'+esc(client.name)+'</b><span class="muted">'+esc([client.phone,client.address,client.type].filter(Boolean).join(' · '))+'</span><span>Обстежень: '+clientReports(client.id).length+' ›</span>';
    b.onclick=()=>openClientHistory(client.id);
    row.append(b);list.append(row);
  }
}
function openClientHistory(cid) {
  if (!data.clients.some(c=>c.id===cid)) return;
  activeClientId=cid;
  tab('clientHistory');
}
function renderClientHistory() {
  const client=data.clients.find(c=>c.id===activeClientId);
  const profile=$('historyProfile'),list=$('historyReports');
  profile.replaceChildren();list.replaceChildren();
  $('clientNewInspection').disabled=!client;
  if(!client){profile.textContent='Клієнта не знайдено';$('historyHeading').textContent='Історія обстежень';return;}
  profile.innerHTML='<h3>'+esc(client.name)+'</h3><p>Телефон: '+esc(client.phone||'Не зазначено')+'</p><p>Адреса: '+esc(client.address||'Не зазначено')+'</p><p>Тип об’єкта: '+esc(client.type||'Не зазначено')+'</p>'+(client.note?'<p>Примітки: '+esc(client.note)+'</p>':'');
  const edit=document.createElement('button');edit.className='secondary';edit.textContent='Редагувати дані клієнта';edit.onclick=openClientEdit;profile.append(edit);
  const reports=clientReports(client.id);
  $('historyHeading').textContent='Історія обстежень ('+reports.length+')';
  if(!reports.length)list.textContent='Збережених обстежень немає';
  for(const report of reports){
    const row=document.createElement('div');row.className='item';
    row.innerHTML='<b>'+esc(report.title||report.type||'Обстеження')+'</b><p class="muted">'+esc(report.date)+' · Результатів: '+report.findings.length+'</p>';
    const actions=document.createElement('div');actions.className='actions';
    for(const [label,action] of [['Перегляд','view'],['PDF','pdf'],['Надіслати','share'],['Сформувати акт','act']]){
      const button=document.createElement('button');button.className='secondary';button.textContent=label;
      button.onclick=()=>openClientReport(report.id,action);actions.append(button);
    }
    row.append(actions);list.append(row);
  }
  const count=pending(client.id).length;
  if(count){const note=document.createElement('p');note.className='muted';note.textContent='Незавершені результати: '+count+'. Доступні в новому обстеженні клієнта.';list.append(note);}
}
function openClientReport(id,action) {
  const index=data.reports.findIndex(r=>r.id===id&&r.cid===activeClientId);
  if(index<0)return;
  if(action==='act'){openArchiveTemplates(index);return;}
  openArchived(index);
  if(action==='pdf')savePdf();
  if(action==='share')sharePdf();
}
function openClientEdit() {
  const client=data.clients.find(c=>c.id===activeClientId);
  if(!client)return;
  editingClientId=client.id;
  for(const [id,key] of [['ceName','name'],['cePhone','phone'],['ceAddress','address'],['ceType','type'],['ceNote','note']])$(id).value=client[key]||'';
  tab('clientEdit');
}
function saveClientEdit() {
  const client=data.clients.find(c=>c.id===editingClientId);
  if(!client)return alert('Клієнта не знайдено');
  const name=$('ceName').value.trim();
  if(!name)return alert('Вкажіть ім’я або назву клієнта');
  const edited={...client,name,phone:$('cePhone').value,address:$('ceAddress').value,type:$('ceType').value,note:$('ceNote').value};
  if(persist({...data,clients:data.clients.map(c=>c.id===edited.id?edited:c)})){
    editingClientId=null;document.activeElement?.blur();goBack();
  }
}
function newClientInspection() {
  if(!data.clients.some(c=>c.id===activeClientId))return;
  const fields=['iRoom','iAir','iSurface','iHumidity','iDefect','iRecommendation','iPhoto'];
  if($('iClient').value!==activeClientId && fields.some(id=>$(id).value)){
    if(!confirm('Перейти до іншого клієнта? Незбережені поля поточного обстеження буде очищено. Збережені результати залишаться в базі.'))return;
    fields.forEach(id=>$(id).value='');
    if(window.resetRecommendationState)window.resetRecommendationState();
  }
  $('iClient').value=activeClientId;
  renderFindings();tab('inspection');
}

function delClient(index) {
  if (confirm('Видалити клієнта? Пов’язані записи залишаться в історії.')) {
    persist({ ...data, clients: data.clients.filter((client, i) => i !== index) });
  }
}

function renderFindings() {
  const findings = pending($('iClient').value).reverse();
  $('findingList').innerHTML = findings.map(finding => `<div class="item">
    <b>${esc(clientName(finding.cid))} — ${esc(finding.room || finding.type)}</b>
    <div class="muted">${esc(finding.type)} · ${esc(finding.date)}</div>
    <p>${esc(finding.defect)}</p>${photoMarkup(finding.photo)}
  </div>`).join('') || 'Ще немає доданих результатів';
  syncInspectionConclusion();
}

function render() {
  $('countClients').textContent = data.clients.length;
  $('countOrders').textContent = data.orders.length;
  $('countReports').textContent = data.reports.length;
  $('sumPaid').textContent = data.orders.reduce((total, order) => total + (+order.paid || 0), 0)
    .toLocaleString('uk-UA') + ' ₴';

  const options = data.clients.map(client =>
    `<option value="${esc(client.id)}">${esc(client.name)}</option>`).join('');
  for (const id of ['oClient', 'iClient']) {
    const select = $(id);
    const previous = select.value;
    select.innerHTML = options || '<option value="">Спочатку створіть клієнта</option>';
    if (data.clients.some(client => client.id === previous)) select.value = previous;
  }

  $('archiveList').innerHTML = data.reports.map((report, index) => `<div class="item">
    <b>${esc(report.client?.name || clientName(report.cid))}</b>
    <p>${esc(report.date)} · ${esc(report.title || report.type)}</p>
    <div class="actions"><button class="secondary" onclick="openArchived(${index})">Перегляд звіту</button><button class="primary" onclick="openArchiveTemplates(${index})">Сформувати акт обстеження</button></div>
  </div>`).join('') || 'Архів порожній';

  $('clientList').innerHTML = data.clients.map((client, index) => `<div class="item">
    <b>${esc(client.name)}</b>
    <div class="muted">${esc(client.phone)} · ${esc(client.address)} · ${esc(client.type)}</div>
    <div class="actions"><button class="danger" onclick="delClient(${index})">Видалити</button></div>
  </div>`).join('') || 'Поки немає клієнтів';

  $('orderList').innerHTML = data.orders.map(order => `<div class="item">
    <b>${esc(clientName(order.cid))}</b><div>${esc(order.service)} · ${(+order.total).toFixed(2)} грн</div>
    <div class="muted">${esc(order.date)} · ${esc(order.status)} · оплачено ${esc(order.paid)} грн ·
      залишок ${(+order.total - (+order.paid || 0)).toFixed(2)} грн</div>
  </div>`).join('') || 'Замовлень ще немає';

  renderFindings();
  renderClientDirectory();
  renderClientHistory();
  $('priceList').innerHTML = data.prices.map(([name, value], index) => `
    <div class="item"><label for="price-${index}">${esc(name)}, грн</label>
    <input id="price-${index}" data-price type="number" min="0" step=".01" value="${esc(value)}"></div>
  `).join('');
}

$('iClient').addEventListener('change', renderFindings);
$('iConclusion').addEventListener('input',()=>{rememberConclusionDraft();syncInspectionConclusion();});
$('oService').addEventListener('change', updateOrderPrice);
load();
render();
updateOrderPrice();

 
// Immutable document templates: examples are never inserted into the database.
const templates = Object.freeze([
  ['Бланк тепловізійного обстеження','Будинок / тепловтрати','Ділянка, температура повітря й поверхні, вологість, спостереження та рекомендації.'],
  ['Акт обстеження приватного будинку','Будинок / тепловтрати','Стіни, кути, перекриття, умови всередині та зовні; порівняти температури ділянок.'],
  ['Акт діагностики електропроводки','Електропроводка','Щит, контакти, навантаження, струм, контрольна температура, ΔT. Не робити висновок про безпечність лише за термограмою.'],
  ['Акт діагностики теплої підлоги','Тепла підлога','Тип системи, режим, час стабілізації, ділянки нерівномірного нагріву.'],
  ['Акт обстеження вікон та дверей','Будинок / тепловтрати','Рами, укоси, стики, ущільнення, температурні умови та можливі причини аномалій.'],
  ['Акт виявлених дефектів','Інженерні системи','Місце дефекту, фактичні вимірювання, ознаки, ймовірна причина та спосіб усунення.'],
  ['Зразок заповненого звіту','Будинок / тепловтрати','Навчальний приклад із вигаданими даними. Не є фактичним висновком.'],
  ['Акт повторного обстеження','Будинок / тепловтрати','Дата первинного огляду, попередні та поточні показники, зміни після усунення дефектів.']
].map(Object.freeze));
let chosenTemplate = null;
let templateBusy = false;
let actSourceId = null;
let templateSource = null;

function archiveTemplateOptions(report, findings, all=false) {
  const types=new Set([report.type,...findings.map(f=>f.type)]);
  const recommended=[];
  if(types.has('Електропроводка'))recommended.push(2);
  if(types.has('Тепла підлога'))recommended.push(3);
  if(types.has('Будинок / тепловтрати'))recommended.push(1,4);
  if(types.has('Інженерні системи'))recommended.push(5);
  if(!recommended.length)recommended.push(0);
  const ids=[...new Set([...recommended,0,5,6,7,...(all?[0,1,2,3,4,5,6,7]:[])])];
  return ids.map(index=>({index,recommended:recommended.includes(index)}));
}
function reportFindings(report) {
  const byId=new Map(data.findings.map(f=>[f.id,f]));
  return report.findings.map(id=>byId.get(id)).filter(Boolean);
}
function openArchiveTemplates(index) {
  const report=data.reports[index];
  if(!report||templateBusy)return;
  actSourceId=report.id;
  renderArchiveTemplates(false);tab('archiveTemplatePicker');
}
function renderArchiveTemplates(all=false) {
  const report=data.reports.find(r=>r.id===actSourceId);
  const list=$('actTemplateList');list.replaceChildren();
  if(!report){$('actSourceSummary').textContent='Обстеження не знайдено';return;}
  const fs=reportFindings(report);
  $('actSourceSummary').textContent=[report.client?.name||clientName(report.cid),report.date,report.title||report.type].filter(Boolean).join(' · ');
  for(const item of archiveTemplateOptions(report,fs,all)){
    const row=document.createElement('div');row.className='item';
    const b=document.createElement('button');b.type='button';b.className=item.recommended?'primary':'secondary';
    b.textContent=item.index===6?'Звіт тепловізійного обстеження':templates[item.index][0];
    b.onclick=()=>startArchivedTemplate(item.index);
    row.append(b);
    if(item.recommended){const label=document.createElement('p');label.className='muted';label.textContent='Рекомендовано за типом обстеження';row.append(label);}
    list.append(row);
  }
  $('actShowAll').hidden=all||list.children.length===templates.length;
}
function inspectionDateInput(value) {
  const s=String(value||'').trim();
  const m=s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if(m)return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
  return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:'';
}
function startArchivedTemplate(index) {
  const report=data.reports.find(r=>r.id===actSourceId);
  if(!report||!templates[index]||templateBusy)return;
  const fs=reportFindings(report);
  if(!fs.length)return alert('В архівному обстеженні немає доступних результатів.');
  if(fs.length!==report.findings.length && !confirm('Частина результатів відсутня. Сформувати акт лише з доступних записів?'))return;
  const client=report.client||data.clients.find(c=>c.id===report.cid)||{};
  chosenTemplate=templates[index];
  templateSource={id:report.id,cid:report.cid,type:report.type,client:{...client},conclusion:String(report.conclusion||'')};
  $('teTitle').textContent=index===6?'Звіт тепловізійного обстеження':chosenTemplate[0];
  $('teSourceNotice').hidden=false;
  $('teSourceNotice').textContent='Дані перенесено з архівного обстеження '+String(report.date||'')+'. Редагується новий документ; оригінал не змінюється.';
  $('teGuide').textContent=index===6?'Перевірте фактичні дані перед збереженням.':chosenTemplate[2];
  $('teClient').replaceChildren(new Option(client.name||'Клієнт архівного обстеження',String(report.cid||'')));
  $('teClient').disabled=true;
  for(const [field,key] of [['teName','name'],['tePhone','phone'],['teAddress','address'],['teObject','type']])$(field).value=client[key]??'';
  $('teDate').value=inspectionDateInput(report.date);
  $('teExpert').value=report.expert??'';
  $('teConditions').value=report.conditions??'';
  $('teConclusion').value=report.conclusion??'';
  $('teRows').replaceChildren();
  fs.forEach(f=>addTemplateRow(f));
  tab('templateEdit');
}

function templateSample() {
  const filled = chosenTemplate === templates[6];
  return {
    client: {name: filled ? 'Умовний замовник (приклад)' : '________________', phone:'________________', address:filled ? 'Умовний об’єкт' : '________________', type:'________________'},
    findings: [{room:filled?'Внутрішній кут кімнати':'________________',type:chosenTemplate[1],air:filled?'21':'',surface:filled?'15':'',humidity:filled?'50':'',defect:filled?'На умовному прикладі температура кута нижча за сусідню поверхню.':'________________',recommendation:filled?'Перевірити умови вимірювання та конструкцію; причину підтвердити додатковим оглядом.':'________________'}],
    conclusion:filled?'Показники вигадані. Приклад оформлення, а не результат реального обстеження.':'________________'
  };
}
function openTemplate(index) {
  if (!templates[index] || templateBusy) return;
  chosenTemplate = templates[index];
  templateSource=null;
  $('templateTitle').textContent = chosenTemplate[0];
  $('templateGuide').textContent = chosenTemplate[2];
  const s=templateSample(), f=s.findings[0];
  $('templateExample').textContent = ['Замовник: '+s.client.name,'Адреса: '+s.client.address,'Ділянка: '+f.room,'Температури: '+(f.air||'___')+' / '+(f.surface||'___')+' °C','Спостереження: '+f.defect,'Рекомендації: '+f.recommendation,'Висновок: '+s.conclusion].join('\n');
  $('templateExample').style.whiteSpace='pre-wrap';
  tab('template');
}
function previewTemplate() {
  if (!chosenTemplate) return;
  const s=templateSample();
  showReport(s.client,s.findings,s.conclusion,'________________','________________','ЗРАЗОК — '+chosenTemplate[0],chosenTemplate[2]);
}
function fillTemplateClient() {
  const c=data.clients.find(x=>x.id===$('teClient').value)||{};
  for(const [id,key] of [['teName','name'],['tePhone','phone'],['teAddress','address'],['teObject','type']]) $(id).value=c[key]||'';
}
function startTemplate() {
  if (!chosenTemplate || templateBusy) return;
  templateSource=null;
  $('teSourceNotice').hidden=true;
  $('teGuide').textContent=chosenTemplate[2];
  $('teClient').disabled=false;
  $('teTitle').textContent=chosenTemplate[0];
  $('teClient').replaceChildren(new Option('Новий клієнт',''),...data.clients.map(c=>new Option(c.name,c.id)));
  fillTemplateClient();
  $('teExpert').value=$('iExpert').value;
  const now=new Date();
  $('teDate').value=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  $('teConditions').value=''; $('teConclusion').value=''; $('teRows').replaceChildren();
  addTemplateRow(); tab('templateEdit');
}
function addTemplateRow(source=null) {
  if(templateBusy) return;
  const card=document.createElement('div'); card.className='card template-finding';
  card.innerHTML='<h3>Результат обстеження</h3><label>Напрямок обстеження<input data-f="type"></label><label>Ділянка<input data-f="room"></label><label>Температура повітря / контрольна, °C<input data-f="air" type="number" step="any"></label><label>Температура поверхні, °C<input data-f="surface" type="number" step="any"></label><label>Вологість, %<input data-f="humidity" type="number" min="0" max="100" step="any"></label><label>Спостереження / дефект<textarea data-f="defect"></textarea></label><label>Рекомендації<textarea data-f="recommendation"></textarea></label><div class="template-photo"></div><label>Фото або термограма<input data-f="photo" type="file" accept="image/*"></label><button type="button" class="secondary template-remove-row">Видалити ділянку</button>';
  card.querySelector('.template-remove-row').onclick=()=>{if(!templateBusy && $('teRows').children.length>1)card.remove();};
  card.querySelector('[data-f="type"]').value=source?.type||templateSource?.type||chosenTemplate[1];
  for(const key of ['room','air','surface','humidity','defect','recommendation'])card.querySelector('[data-f="'+key+'"]').value=source?.[key]??'';
  card.retainedPhoto=source?.photo||'';
  const photo=card.querySelector('.template-photo');
  if(card.retainedPhoto && photoMarkup(card.retainedPhoto)){
    photo.innerHTML=photoMarkup(card.retainedPhoto);
    const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Видалити скопійоване фото';
    remove.onclick=()=>{card.retainedPhoto='';photo.replaceChildren();};photo.append(remove);
  }
  $('teRows').append(card);
}
async function templateDocument(save) {
  if(templateBusy||!chosenTemplate)return;
  const name=$('teName').value.trim(), date=$('teDate').value;
  if(!name||!date)return alert('Вкажіть замовника та дату обстеження.');
  const selected=data.clients.find(c=>c.id===$('teClient').value);
  const source=templateSource;
  const client={id:source?.cid||selected?.id||uid(),name,phone:$('tePhone').value,address:$('teAddress').value,type:$('teObject').value,note:source?.client?.note||selected?.note||''};
  const title=chosenTemplate===templates[6]?'Звіт тепловізійного обстеження':chosenTemplate[0];
  const type=source?.type||chosenTemplate[1], formattedDate=date.split('-').reverse().join('.');
  const expert=$('teExpert').value, conditions=$('teConditions').value;let conclusion=$('teConclusion').value;
  const rows=[...$('teRows').children];
  if(!rows.length||rows.some(r=>[...r.querySelectorAll('input')].some(i=>!i.checkValidity())))return alert('Перевірте поля вимірювань.');
  templateBusy=true;
  const controls=[...$('templateEdit').querySelectorAll('button,input,textarea,select')];
  controls.forEach(c=>c.disabled=true);
  try{
    const findings=[];
    for(const row of rows){
      const f={id:uid(),cid:client.id,type:row.querySelector('[data-f="type"]').value.trim()||type,date:formattedDate,photo:row.retainedPhoto||''};
      for(const key of ['room','air','surface','humidity','defect','recommendation'])f[key]=row.querySelector('[data-f="'+key+'"]').value;
      const file=row.querySelector('[data-f="photo"]').files[0];
      if(file){
        if(file.size>8000000)throw Error('Фото завелике. Виберіть файл до 8 МБ.');
        f.photo=await readFile(file,'readAsDataURL');
        if(!photoMarkup(f.photo))throw Error('Некоректне фото.');
      }
      if(f.room.trim()||f.defect.trim()||f.recommendation.trim()||f.photo||f.air!==''||f.surface!==''||f.humidity!=='')findings.push(f);
    }
    if(!findings.length)return alert('Внесіть хоча б один результат обстеження.');
    if(!conclusion.trim()){conclusion=buildInspectionConclusion(findings).text;$('teConclusion').value=conclusion;}
    if(!save){showReport(client,findings,conclusion,expert,formattedDate,title,conditions);return;}
    const report={id:uid(),cid:client.id,type,title,conditions,client,findings:findings.map(f=>f.id),conclusion,expert,date:formattedDate,...(source?{sourceReportId:source.id}:{})};
    if(persist({...data,clients:(source||selected)?data.clients:[...data.clients,client],findings:[...data.findings,...findings],reports:[report,...data.reports]})){
      $('teRows').replaceChildren();
      templateSource=null;$('teClient').disabled=false;
      tab('archive',true);
    }
  }catch(e){alert(e.message||'Не вдалося підготувати документ.');}
  finally{templateBusy=false;controls.forEach(c=>c.disabled=false);$('teClient').disabled=!!templateSource;}
}
templates.forEach((template,index)=>{
  const row=document.createElement('div');row.className='item';
  const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=template[0];b.onclick=()=>openTemplate(index);
  row.append(b);$('templateList').append(row);
});
