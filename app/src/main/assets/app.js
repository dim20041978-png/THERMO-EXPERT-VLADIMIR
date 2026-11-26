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
      ['iRoom', 'iAir', 'iSurface', 'iHumidity', 'iDefect', 'iRecommendation', 'iPhoto']
        .forEach(id => $(id).value = '');
      if (window.resetRecommendationState) window.resetRecommendationState();
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

function saveReport() {
  const cid = $('iClient').value;
  if (!cid) return alert('Оберіть клієнта');
  const findings = pending(cid);
  if (!findings.length) return alert('Додайте хоча б один результат обстеження');
  const report = {
    id: uid(), cid, type: findings[findings.length - 1].type,
    findings: findings.map(finding => finding.id), conclusion: $('iConclusion').value,
    expert: $('iExpert').value, date: new Date().toLocaleDateString('uk-UA'),
    client: { ...data.clients.find(client => client.id === cid) }
  };
  if (persist({ ...data, reports: [report, ...data.reports] })) {
    $('iConclusion').value = '';
    tab('archive', true);
  }
}

function makeReport() {
  const cid = $('iClient').value;
  if (!cid) return alert('Оберіть клієнта');
  const findings = pending(cid);
  if (!findings.length) return alert('Немає результатів для звіту');
  showReport(data.clients.find(client => client.id === cid), findings, $('iConclusion').value,
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
      <p>${esc(conclusion || 'Висновок не внесено').replace(/\n/g, '<br>')}</p>
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
    <button class="secondary" onclick="openArchived(${index})">Перегляд звіту</button>
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
  $('priceList').innerHTML = data.prices.map(([name, value], index) => `
    <div class="item"><label for="price-${index}">${esc(name)}, грн</label>
    <input id="price-${index}" data-price type="number" min="0" step=".01" value="${esc(value)}"></div>
  `).join('');
}

$('iClient').addEventListener('change', renderFindings);
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
  $('teTitle').textContent=chosenTemplate[0];
  $('teClient').replaceChildren(new Option('Новий клієнт',''),...data.clients.map(c=>new Option(c.name,c.id)));
  fillTemplateClient();
  $('teExpert').value=$('iExpert').value;
  const now=new Date();
  $('teDate').value=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
  $('teConditions').value=''; $('teConclusion').value=''; $('teRows').replaceChildren();
  addTemplateRow(); tab('templateEdit');
}
function addTemplateRow() {
  if(templateBusy) return;
  const card=document.createElement('div'); card.className='card template-finding';
  card.innerHTML='<h3>Результат обстеження</h3><label>Ділянка<input data-f="room"></label><label>Температура повітря / контрольна, °C<input data-f="air" type="number" step="any"></label><label>Температура поверхні, °C<input data-f="surface" type="number" step="any"></label><label>Вологість, %<input data-f="humidity" type="number" min="0" max="100" step="any"></label><label>Спостереження / дефект<textarea data-f="defect"></textarea></label><label>Рекомендації<textarea data-f="recommendation"></textarea></label><label>Фото або термограма<input data-f="photo" type="file" accept="image/*"></label><button type="button" class="secondary">Видалити ділянку</button>';
  card.querySelector('button').onclick=()=>{if(!templateBusy && $('teRows').children.length>1)card.remove();};
  $('teRows').append(card);
}
async function templateDocument(save) {
  if(templateBusy||!chosenTemplate)return;
  const name=$('teName').value.trim(), date=$('teDate').value;
  if(!name||!date)return alert('Вкажіть замовника та дату обстеження.');
  const selected=data.clients.find(c=>c.id===$('teClient').value);
  const client={id:selected?.id||uid(),name,phone:$('tePhone').value,address:$('teAddress').value,type:$('teObject').value,note:selected?.note||''};
  const title=chosenTemplate===templates[6]?'Звіт тепловізійного обстеження':chosenTemplate[0];
  const type=chosenTemplate[1], formattedDate=date.split('-').reverse().join('.');
  const expert=$('teExpert').value, conditions=$('teConditions').value, conclusion=$('teConclusion').value;
  const rows=[...$('teRows').children];
  if(!rows.length||rows.some(r=>[...r.querySelectorAll('input')].some(i=>!i.checkValidity())))return alert('Перевірте поля вимірювань.');
  templateBusy=true;
  const controls=[...$('templateEdit').querySelectorAll('button,input,textarea,select')];
  controls.forEach(c=>c.disabled=true);
  try{
    const findings=[];
    for(const row of rows){
      const f={id:uid(),cid:client.id,type,date:formattedDate,photo:''};
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
    if(!save){showReport(client,findings,conclusion,expert,formattedDate,title,conditions);return;}
    const report={id:uid(),cid:client.id,type,title,conditions,client,findings:findings.map(f=>f.id),conclusion,expert,date:formattedDate};
    if(persist({...data,clients:selected?data.clients:[...data.clients,client],findings:[...data.findings,...findings],reports:[report,...data.reports]})){
      $('teRows').replaceChildren();
      tab('archive',true);
    }
  }catch(e){alert(e.message||'Не вдалося підготувати документ.');}
  finally{templateBusy=false;controls.forEach(c=>c.disabled=false);}
}
templates.forEach((template,index)=>{
  const row=document.createElement('div');row.className='item';
  const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=template[0];b.onclick=()=>openTemplate(index);
  row.append(b);$('templateList').append(row);
});
