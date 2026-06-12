/* ============================================================
   Calorías — contador de calorías PWA
   Almacenamiento: localStorage. APIs: Open Food Facts + IA (Claude/Gemini)
   ============================================================ */

// ---------- Almacén ----------
const DB = {
  get(k, def) {
    try { const v = localStorage.getItem('cal_' + k); return v ? JSON.parse(v) : def; }
    catch { return def; }
  },
  set(k, v) { localStorage.setItem('cal_' + k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem('cal_' + k); }
};

// Estructuras:
// perfil: {sexo, edad, peso, altura, actividad, ajusteKcal}
// objetivos: {kcal, prot, carb, gras, agua}
// diario_YYYY-MM-DD: {comidas: {desayuno:[...], ...}, agua: n}
// pesos: [{fecha, kg}]
// recetas: [{id, nombre, raciones, ingredientes:[{nombre, kcal, prot, carb, gras}]}]
// frecuentes: [{nombre, kcal100, prot100, carb100, gras100, usos}]
// ia: {prov, key}

const COMIDAS = ['desayuno', 'almuerzo', 'comida', 'merienda', 'cena', 'snack'];
const COMIDAS_LABEL = { desayuno: '🌅 Desayuno', almuerzo: '🥐 Almuerzo', comida: '🍽️ Comida', merienda: '🥪 Merienda', cena: '🌙 Cena', snack: '🍿 Snack' };

let fechaActual = hoyISO();

function hoyISO(offsetDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

function $(id) { return document.getElementById(id); }

function toast(msg, ms = 2500) {
  const t = $('toast');
  t.innerHTML = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- Cálculo de objetivos (Mifflin-St Jeor) ----------
function calcularObjetivos(p) {
  const base = 10 * p.peso + 6.25 * p.altura - 5 * p.edad + (p.sexo === 'm' ? 5 : -161);
  const tdee = base * p.actividad;
  const kcal = Math.round(tdee + p.ajusteKcal);
  const prot = Math.round(p.peso * 1.8);              // 1,8 g/kg
  const gras = Math.round(kcal * 0.25 / 9);           // 25% de kcal
  const carb = Math.round((kcal - prot * 4 - gras * 9) / 4);
  return { kcal, prot, carb, gras, agua: 8 };
}

// ---------- Diario ----------
function getDiario(fecha) {
  return DB.get('diario_' + fecha, { comidas: {}, agua: 0 });
}
function setDiario(fecha, d) { DB.set('diario_' + fecha, d); }

function totalesDia(fecha) {
  const d = getDiario(fecha);
  let kcal = 0, prot = 0, carb = 0, gras = 0;
  for (const c of COMIDAS) {
    for (const a of (d.comidas[c] || [])) {
      kcal += a.kcal; prot += a.prot; carb += a.carb; gras += a.gras;
    }
  }
  return { kcal, prot, carb, gras };
}

function anadirAlimento(fecha, comida, alimento) {
  const d = getDiario(fecha);
  if (!d.comidas[comida]) d.comidas[comida] = [];
  d.comidas[comida].push(alimento);
  setDiario(fecha, d);
  registrarFrecuente(alimento);
  renderDiario();
}

function registrarFrecuente(a) {
  if (!a.por100) return;
  const lista = DB.get('frecuentes', []);
  const ex = lista.find(f => f.nombre.toLowerCase() === a.nombre.toLowerCase());
  if (ex) { ex.usos++; }
  else lista.push({ nombre: a.nombre, ...a.por100, usos: 1 });
  lista.sort((x, y) => y.usos - x.usos);
  DB.set('frecuentes', lista.slice(0, 30));
}

// ---------- Render: Diario ----------
function renderDiario() {
  const obj = DB.get('objetivos');
  const tot = totalesDia(fechaActual);
  const d = getDiario(fechaActual);

  // Título del día
  const hoy = hoyISO();
  const ayer = hoyISO(-1);
  let titulo;
  if (fechaActual === hoy) titulo = 'Hoy';
  else if (fechaActual === ayer) titulo = 'Ayer';
  else titulo = new Date(fechaActual + 'T12:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  $('dia-titulo').textContent = titulo;

  // Anillo kcal
  const pct = Math.min(100, (tot.kcal / obj.kcal) * 100);
  const pasado = tot.kcal > obj.kcal;
  $('kcal-ring').style.background =
    `conic-gradient(${pasado ? '#ef4444' : 'var(--green-l)'} ${pct}%, var(--card2) ${pct}%)`;
  $('kcal-restantes').textContent = Math.round(obj.kcal - tot.kcal);

  // Barras macros
  const setBar = (id, txt, val, max) => {
    $(id).style.width = Math.min(100, (val / max) * 100) + '%';
    $(txt).textContent = `${Math.round(val)}/${max} g`;
  };
  setBar('bar-prot', 'txt-prot', tot.prot, obj.prot);
  setBar('bar-carb', 'txt-carb', tot.carb, obj.carb);
  setBar('bar-gras', 'txt-gras', tot.gras, obj.gras);

  // Agua
  $('agua-vasos').textContent = `${d.agua || 0}/${obj.agua} vasos`;

  // Bloques de comidas
  const cont = $('comidas-lista');
  cont.innerHTML = '';
  for (const c of COMIDAS) {
    const items = d.comidas[c] || [];
    const kcalC = items.reduce((s, a) => s + a.kcal, 0);
    const bloque = document.createElement('div');
    bloque.className = 'comida-bloque';
    bloque.innerHTML = `
      <div class="comida-head">
        <h3>${COMIDAS_LABEL[c]}</h3>
        <div><span class="kcal">${Math.round(kcalC)} kcal</span>
        <button data-add="${c}">+</button></div>
      </div>`;
    items.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = 'alimento-item';
      el.innerHTML = `
        <div>
          <div class="nombre">${escapeHtml(a.nombre)}</div>
          <div class="detalle">${a.cantidad ? a.cantidad + ' · ' : ''}P ${Math.round(a.prot)} · C ${Math.round(a.carb)} · G ${Math.round(a.gras)}</div>
        </div>
        <span class="kcal">${Math.round(a.kcal)}</span>`;
      el.onclick = () => confirmarBorrado(c, i, a.nombre);
      bloque.appendChild(el);
    });
    cont.appendChild(bloque);
  }
  cont.querySelectorAll('[data-add]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); $('add-comida').value = b.dataset.add; cambiarTab('anadir'); };
  });
}

function confirmarBorrado(comida, idx, nombre) {
  modal(`
    <h3>¿Eliminar?</h3>
    <p class="muted">${escapeHtml(nombre)}</p>
    <div class="modal-acciones">
      <button class="cancel" onclick="cerrarModal()">Cancelar</button>
      <button class="ok" style="background:#7f1d1d" id="m-borrar">Eliminar</button>
    </div>`);
  $('m-borrar').onclick = () => {
    const d = getDiario(fechaActual);
    d.comidas[comida].splice(idx, 1);
    setDiario(fechaActual, d);
    cerrarModal();
    renderDiario();
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Modal ----------
function modal(html) {
  $('modal-box').innerHTML = html;
  $('modal').classList.remove('hidden');
}
function cerrarModal() { $('modal').classList.add('hidden'); }
$('modal') && ($('modal').onclick = (e) => { if (e.target.id === 'modal') cerrarModal(); });

// ---------- Open Food Facts ----------
async function buscarOFF(texto) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(texto)}&search_simple=1&action=process&json=1&page_size=20&lc=es&fields=product_name,product_name_es,brands,nutriments,code`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Error en la búsqueda');
  const data = await r.json();
  return (data.products || []).map(productoOFF).filter(Boolean);
}

async function buscarCodigoOFF(codigo) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${codigo}.json?fields=product_name,product_name_es,brands,nutriments,code`);
  if (!r.ok) return null;
  const data = await r.json();
  if (data.status !== 1) return null;
  return productoOFF(data.product);
}

function productoOFF(p) {
  const n = p.nutriments || {};
  const kcal100 = n['energy-kcal_100g'];
  if (kcal100 == null) return null;
  return {
    nombre: (p.product_name_es || p.product_name || 'Producto') + (p.brands ? ` (${p.brands.split(',')[0]})` : ''),
    kcal100: kcal100,
    prot100: n.proteins_100g || 0,
    carb100: n.carbohydrates_100g || 0,
    gras100: n.fat_100g || 0
  };
}

// ---------- Diálogo de cantidad ----------
function dialogoCantidad(prod, onOk) {
  modal(`
    <h3>${escapeHtml(prod.nombre)}</h3>
    <p class="muted">${Math.round(prod.kcal100)} kcal · P ${r1(prod.prot100)} · C ${r1(prod.carb100)} · G ${r1(prod.gras100)} (por 100 g)</p>
    <label>Cantidad (g/ml) <input type="number" id="m-cant" value="100" min="1"></label>
    <div class="modal-acciones">
      <button class="cancel" onclick="cerrarModal()">Cancelar</button>
      <button class="ok" id="m-ok">Añadir</button>
    </div>`);
  $('m-cant').focus();
  $('m-ok').onclick = () => {
    const g = parseFloat($('m-cant').value) || 100;
    const f = g / 100;
    onOk({
      nombre: prod.nombre,
      cantidad: g + ' g',
      kcal: prod.kcal100 * f,
      prot: prod.prot100 * f,
      carb: prod.carb100 * f,
      gras: prod.gras100 * f,
      por100: { kcal100: prod.kcal100, prot100: prod.prot100, carb100: prod.carb100, gras100: prod.gras100 }
    });
    cerrarModal();
  };
}

function r1(x) { return Math.round(x * 10) / 10; }

// ---------- Búsqueda UI ----------
function renderResultados(lista, cont) {
  cont.innerHTML = '';
  if (!lista.length) { cont.innerHTML = '<p class="muted" style="padding:10px">Sin resultados.</p>'; return; }
  for (const prod of lista) {
    const el = document.createElement('div');
    el.className = 'resultado-item';
    el.innerHTML = `
      <div class="info">
        <div class="nombre">${escapeHtml(prod.nombre)}</div>
        <div class="detalle">${Math.round(prod.kcal100)} kcal · P ${r1(prod.prot100)} · C ${r1(prod.carb100)} · G ${r1(prod.gras100)} /100g</div>
      </div>
      <button>+</button>`;
    el.querySelector('button').onclick = () =>
      dialogoCantidad(prod, a => { anadirAlimento(fechaActual, $('add-comida').value, a); toast('✅ Añadido a ' + $('add-comida').value); });
    cont.appendChild(el);
  }
}

function renderFrecuentes() {
  const lista = DB.get('frecuentes', []).slice(0, 8);
  const cont = $('busq-frecuentes');
  if (!lista.length) { cont.innerHTML = ''; return; }
  cont.innerHTML = '<h3>Frecuentes</h3>';
  renderResultadosEn(lista, cont);
}

function renderResultadosEn(lista, cont) {
  for (const prod of lista) {
    const el = document.createElement('div');
    el.className = 'resultado-item';
    el.innerHTML = `
      <div class="info">
        <div class="nombre">${escapeHtml(prod.nombre)}</div>
        <div class="detalle">${Math.round(prod.kcal100)} kcal /100g</div>
      </div>
      <button>+</button>`;
    el.querySelector('button').onclick = () =>
      dialogoCantidad(prod, a => { anadirAlimento(fechaActual, $('add-comida').value, a); toast('✅ Añadido'); });
    cont.appendChild(el);
  }
}

// ---------- Escáner de códigos ----------
let scanner = null;
async function abrirEscaner() {
  $('scanner-cont').classList.remove('hidden');
  $('busq-resultados').innerHTML = '';
  scanner = new Html5Qrcode('scanner');
  try {
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      async (codigo) => {
        await cerrarEscaner();
        toast('Buscando ' + codigo + '... <span class="spinner"></span>', 8000);
        const prod = await buscarCodigoOFF(codigo);
        if (prod) {
          toast('✅ Encontrado');
          dialogoCantidad(prod, a => { anadirAlimento(fechaActual, $('add-comida').value, a); toast('✅ Añadido'); });
        } else {
          toast('❌ Producto no encontrado en Open Food Facts');
        }
      },
      () => {}
    );
  } catch (e) {
    toast('❌ No se pudo abrir la cámara: ' + e);
    $('scanner-cont').classList.add('hidden');
  }
}
async function cerrarEscaner() {
  if (scanner) { try { await scanner.stop(); scanner.clear(); } catch {} scanner = null; }
  $('scanner-cont').classList.add('hidden');
}

// ---------- Entrada manual ----------
function entradaManual() {
  modal(`
    <h3>Alimento manual</h3>
    <label>Nombre <input type="text" id="m-nombre" placeholder="Ej: Tortilla de patatas"></label>
    <label>Calorías (kcal) <input type="number" id="m-kcal" min="0"></label>
    <label>Proteínas (g) <input type="number" id="m-prot" min="0" value="0"></label>
    <label>Carbohidratos (g) <input type="number" id="m-carb" min="0" value="0"></label>
    <label>Grasas (g) <input type="number" id="m-gras" min="0" value="0"></label>
    <div class="modal-acciones">
      <button class="cancel" onclick="cerrarModal()">Cancelar</button>
      <button class="ok" id="m-ok">Añadir</button>
    </div>`);
  $('m-ok').onclick = () => {
    const nombre = $('m-nombre').value.trim();
    const kcal = parseFloat($('m-kcal').value);
    if (!nombre || isNaN(kcal)) { toast('Pon al menos nombre y calorías'); return; }
    anadirAlimento(fechaActual, $('add-comida').value, {
      nombre, kcal,
      prot: parseFloat($('m-prot').value) || 0,
      carb: parseFloat($('m-carb').value) || 0,
      gras: parseFloat($('m-gras').value) || 0
    });
    cerrarModal();
    toast('✅ Añadido');
  };
}

// ---------- IA: foto del plato ----------
const PROMPT_IA = `Analiza esta foto de comida. Identifica cada alimento visible y estima su cantidad en gramos y sus valores nutricionales. Sé realista con las raciones típicas en España. Responde SOLO con JSON válido con esta estructura exacta:
{"alimentos":[{"nombre":"...","cantidad_g":0,"kcal":0,"proteinas_g":0,"carbohidratos_g":0,"grasas_g":0}]}`;

async function analizarFoto(file) {
  const ia = DB.get('ia', {});
  if (!ia.key) { toast('⚙️ Configura la API key de IA en Ajustes'); cambiarTab('ajustes'); return; }

  toast('✨ Analizando foto... <span class="spinner"></span>', 30000);
  try {
    const { b64, mime } = await redimensionarImagen(file, 1024);
    const alimentos = ia.prov === 'gemini'
      ? await llamarGemini(ia.key, b64, mime)
      : await llamarClaude(ia.key, b64, mime);
    if (!alimentos || !alimentos.length) { toast('❌ La IA no detectó alimentos'); return; }
    mostrarResultadoIA(alimentos);
  } catch (e) {
    console.error(e);
    toast('❌ Error de IA: ' + (e.message || e), 5000);
  }
}

function redimensionarImagen(file, maxLado) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const esc = Math.min(1, maxLado / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * esc);
      c.height = Math.round(img.height * esc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.85);
      resolve({ b64: dataUrl.split(',')[1], mime: 'image/jpeg' });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function llamarClaude(key, b64, mime) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              alimentos: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    nombre: { type: 'string' },
                    cantidad_g: { type: 'number' },
                    kcal: { type: 'number' },
                    proteinas_g: { type: 'number' },
                    carbohidratos_g: { type: 'number' },
                    grasas_g: { type: 'number' }
                  },
                  required: ['nombre', 'cantidad_g', 'kcal', 'proteinas_g', 'carbohidratos_g', 'grasas_g'],
                  additionalProperties: false
                }
              }
            },
            required: ['alimentos'],
            additionalProperties: false
          }
        }
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          { type: 'text', text: PROMPT_IA }
        ]
      }]
    })
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error?.message || 'HTTP ' + r.status);
  }
  const data = await r.json();
  if (data.stop_reason === 'refusal') throw new Error('La IA rechazó la petición');
  const texto = (data.content || []).find(b => b.type === 'text')?.text || '';
  return JSON.parse(texto).alimentos;
}

async function llamarGemini(key, b64, mime) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mime, data: b64 } },
          { text: PROMPT_IA }
        ]
      }],
      generationConfig: { response_mime_type: 'application/json' }
    })
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error?.message || 'HTTP ' + r.status);
  }
  const data = await r.json();
  const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return JSON.parse(texto).alimentos;
}

function mostrarResultadoIA(alimentos) {
  let html = '<h3>✨ Detectado por IA</h3><p class="muted">Desmarca lo que no quieras añadir:</p>';
  alimentos.forEach((a, i) => {
    html += `
      <div class="ia-resultado-item">
        <label style="display:flex;align-items:center;margin:0;flex:1">
          <input type="checkbox" checked data-ia="${i}">
          <span style="color:var(--text)">${escapeHtml(a.nombre)} <small class="muted">(${Math.round(a.cantidad_g)} g)</small></span>
        </label>
        <span>${Math.round(a.kcal)} kcal</span>
      </div>`;
  });
  html += `
    <div class="modal-acciones">
      <button class="cancel" onclick="cerrarModal()">Cancelar</button>
      <button class="ok" id="m-ia-ok">Añadir seleccionados</button>
    </div>`;
  modal(html);
  $('m-ia-ok').onclick = () => {
    document.querySelectorAll('[data-ia]:checked').forEach(cb => {
      const a = alimentos[parseInt(cb.dataset.ia)];
      anadirAlimento(fechaActual, $('add-comida').value, {
        nombre: a.nombre,
        cantidad: Math.round(a.cantidad_g) + ' g',
        kcal: a.kcal, prot: a.proteinas_g, carb: a.carbohidratos_g, gras: a.grasas_g
      });
    });
    cerrarModal();
    toast('✅ Añadido al diario');
    cambiarTab('diario');
  };
}

// ---------- Progreso: peso ----------
function guardarPeso() {
  const kg = parseFloat($('peso-input').value);
  if (isNaN(kg)) { toast('Introduce un peso válido'); return; }
  const pesos = DB.get('pesos', []);
  const i = pesos.findIndex(p => p.fecha === hoyISO());
  if (i >= 0) pesos[i].kg = kg; else pesos.push({ fecha: hoyISO(), kg });
  pesos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  DB.set('pesos', pesos);
  const perfil = DB.get('perfil');
  if (perfil) { perfil.peso = kg; DB.set('perfil', perfil); }
  toast('✅ Peso guardado');
  renderProgreso();
}

function renderProgreso() {
  const pesos = DB.get('pesos', []);
  dibujarLineas($('peso-chart'), pesos.slice(-30).map(p => ({ x: p.fecha.slice(5), y: p.kg })), 'kg');

  const hist = $('peso-historial');
  hist.innerHTML = '';
  [...pesos].reverse().slice(0, 10).forEach(p => {
    const el = document.createElement('div');
    el.className = 'peso-hist-item';
    el.innerHTML = `<span>${new Date(p.fecha + 'T12:00').toLocaleDateString('es-ES')}</span><strong>${p.kg} kg</strong>`;
    hist.appendChild(el);
  });

  // kcal últimos 7 días
  const obj = DB.get('objetivos');
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const f = hoyISO(-i);
    dias.push({ x: new Date(f + 'T12:00').toLocaleDateString('es-ES', { weekday: 'short' }), y: Math.round(totalesDia(f).kcal) });
  }
  dibujarBarras($('kcal-chart'), dias, obj.kcal);
}

function dibujarLineas(canvas, datos, unidad) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, P = 40;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '20px sans-serif';
  if (datos.length < 2) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Registra tu peso varios días para ver la gráfica', 30, H / 2);
    return;
  }
  const ys = datos.map(d => d.y);
  const min = Math.min(...ys) - 0.5, max = Math.max(...ys) + 0.5;
  const X = i => P + (i / (datos.length - 1)) * (W - 2 * P);
  const Y = v => H - P - ((v - min) / (max - min)) * (H - 2 * P);
  ctx.strokeStyle = '#334155'; ctx.beginPath();
  ctx.moveTo(P, H - P); ctx.lineTo(W - P, H - P); ctx.stroke();
  ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3; ctx.beginPath();
  datos.forEach((d, i) => i ? ctx.lineTo(X(i), Y(d.y)) : ctx.moveTo(X(i), Y(d.y)));
  ctx.stroke();
  ctx.fillStyle = '#22c55e';
  datos.forEach((d, i) => { ctx.beginPath(); ctx.arc(X(i), Y(d.y), 5, 0, 7); ctx.fill(); });
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`${ys[ys.length - 1]} ${unidad}`, W - P - 60, Y(ys[ys.length - 1]) - 12);
}

function dibujarBarras(canvas, datos, objetivo) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, P = 36;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(objetivo * 1.2, ...datos.map(d => d.y), 1);
  const bw = (W - 2 * P) / datos.length * 0.6;
  const step = (W - 2 * P) / datos.length;
  // línea objetivo
  const yObj = H - P - (objetivo / max) * (H - 2 * P);
  ctx.strokeStyle = '#64748b'; ctx.setLineDash([6, 6]); ctx.beginPath();
  ctx.moveTo(P, yObj); ctx.lineTo(W - P, yObj); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '18px sans-serif';
  datos.forEach((d, i) => {
    const h = (d.y / max) * (H - 2 * P);
    const x = P + i * step + (step - bw) / 2;
    ctx.fillStyle = d.y > objetivo ? '#ef4444' : '#22c55e';
    ctx.fillRect(x, H - P - h, bw, h);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(d.x, x, H - P + 22);
  });
}

// ---------- Recetas ----------
function renderRecetas() {
  const recetas = DB.get('recetas', []);
  const cont = $('recetas-lista');
  cont.innerHTML = '';
  if (!recetas.length) { cont.innerHTML = '<p class="muted" style="padding:14px">Aún no tienes recetas. Crea una con sus ingredientes y calcularé las calorías por ración.</p>'; return; }
  for (const rec of recetas) {
    const tot = rec.ingredientes.reduce((s, x) => ({ kcal: s.kcal + x.kcal, prot: s.prot + x.prot, carb: s.carb + x.carb, gras: s.gras + x.gras }), { kcal: 0, prot: 0, carb: 0, gras: 0 });
    const porRacion = { kcal: tot.kcal / rec.raciones, prot: tot.prot / rec.raciones, carb: tot.carb / rec.raciones, gras: tot.gras / rec.raciones };
    const el = document.createElement('div');
    el.className = 'receta-item';
    el.innerHTML = `
      <div class="head">
        <strong>${escapeHtml(rec.nombre)}</strong>
        <span class="muted">${Math.round(porRacion.kcal)} kcal/ración</span>
      </div>
      <div class="muted" style="font-size:0.8rem">${rec.ingredientes.length} ingredientes · ${rec.raciones} raciones · P ${Math.round(porRacion.prot)} · C ${Math.round(porRacion.carb)} · G ${Math.round(porRacion.gras)}</div>
      <div class="acciones">
        <button data-act="comer">🍽️ Añadir ración</button>
        <button data-act="editar">✏️ Editar</button>
        <button data-act="borrar">🗑️</button>
      </div>`;
    el.querySelector('[data-act="comer"]').onclick = () => {
      anadirAlimento(fechaActual, 'comida', {
        nombre: rec.nombre + ' (1 ración)',
        kcal: porRacion.kcal, prot: porRacion.prot, carb: porRacion.carb, gras: porRacion.gras
      });
      toast('✅ Ración añadida al diario');
    };
    el.querySelector('[data-act="editar"]').onclick = () => editorReceta(rec);
    el.querySelector('[data-act="borrar"]').onclick = () => {
      DB.set('recetas', DB.get('recetas', []).filter(x => x.id !== rec.id));
      renderRecetas();
    };
    cont.appendChild(el);
  }
}

function editorReceta(rec) {
  rec = rec || { id: Date.now(), nombre: '', raciones: 2, ingredientes: [] };
  const ingHtml = () => rec.ingredientes.map((x, i) => `
    <div class="ia-resultado-item">
      <span style="flex:1">${escapeHtml(x.nombre)} <small class="muted">${Math.round(x.kcal)} kcal</small></span>
      <button style="background:var(--card2);padding:4px 10px;border-radius:8px" data-del-ing="${i}">✕</button>
    </div>`).join('');

  modal(`
    <h3>${rec.nombre ? 'Editar' : 'Nueva'} receta</h3>
    <label>Nombre <input type="text" id="m-rec-nombre" value="${escapeHtml(rec.nombre)}"></label>
    <label>Raciones <input type="number" id="m-rec-raciones" value="${rec.raciones}" min="1"></label>
    <h3 style="margin-top:10px">Ingredientes</h3>
    <div id="m-rec-ings">${ingHtml()}</div>
    <label style="margin-top:8px">Añadir ingrediente (busca en Open Food Facts)
      <div style="display:flex;gap:6px;margin-top:4px">
        <input type="text" id="m-rec-busq" placeholder="Ej: arroz" style="margin-top:0">
        <button id="m-rec-busq-btn" style="background:var(--green);padding:0 14px;border-radius:10px">🔍</button>
      </div>
    </label>
    <div id="m-rec-resultados"></div>
    <div class="modal-acciones">
      <button class="cancel" onclick="cerrarModal()">Cancelar</button>
      <button class="ok" id="m-rec-ok">Guardar receta</button>
    </div>`);

  const refrescarIngs = () => {
    $('m-rec-ings').innerHTML = ingHtml();
    bindDels();
  };
  const bindDels = () => {
    document.querySelectorAll('[data-del-ing]').forEach(b => {
      b.onclick = () => { rec.ingredientes.splice(parseInt(b.dataset.delIng), 1); refrescarIngs(); };
    });
  };
  bindDels();

  $('m-rec-busq-btn').onclick = async () => {
    const q = $('m-rec-busq').value.trim();
    if (!q) return;
    $('m-rec-resultados').innerHTML = '<p class="muted">Buscando... <span class="spinner"></span></p>';
    try {
      const res = (await buscarOFF(q)).slice(0, 5);
      const cont = $('m-rec-resultados');
      cont.innerHTML = '';
      res.forEach(prod => {
        const el = document.createElement('div');
        el.className = 'resultado-item';
        el.innerHTML = `<div class="info"><div class="nombre">${escapeHtml(prod.nombre)}</div>
          <div class="detalle">${Math.round(prod.kcal100)} kcal/100g</div></div><button>+</button>`;
        el.querySelector('button').onclick = () => {
          const g = parseFloat(prompt('¿Cuántos gramos?', '100')) || 0;
          if (!g) return;
          const f = g / 100;
          rec.ingredientes.push({
            nombre: `${prod.nombre} (${g}g)`,
            kcal: prod.kcal100 * f, prot: prod.prot100 * f, carb: prod.carb100 * f, gras: prod.gras100 * f
          });
          cont.innerHTML = '';
          refrescarIngs();
        };
        cont.appendChild(el);
      });
    } catch { $('m-rec-resultados').innerHTML = '<p class="muted">Error al buscar.</p>'; }
  };

  $('m-rec-ok').onclick = () => {
    rec.nombre = $('m-rec-nombre').value.trim() || 'Receta';
    rec.raciones = parseInt($('m-rec-raciones').value) || 1;
    const recetas = DB.get('recetas', []);
    const i = recetas.findIndex(x => x.id === rec.id);
    if (i >= 0) recetas[i] = rec; else recetas.push(rec);
    DB.set('recetas', recetas);
    cerrarModal();
    renderRecetas();
  };
}

// ---------- Ajustes ----------
function cargarAjustes() {
  const obj = DB.get('objetivos');
  const ia = DB.get('ia', { prov: 'claude', key: '' });
  $('aj-kcal').value = obj.kcal;
  $('aj-prot').value = obj.prot;
  $('aj-carb').value = obj.carb;
  $('aj-gras').value = obj.gras;
  $('aj-agua').value = obj.agua;
  $('aj-ia-prov').value = ia.prov || 'claude';
  $('aj-ia-key').value = ia.key || '';
}

function guardarAjustes() {
  DB.set('objetivos', {
    kcal: parseInt($('aj-kcal').value) || 2000,
    prot: parseInt($('aj-prot').value) || 100,
    carb: parseInt($('aj-carb').value) || 200,
    gras: parseInt($('aj-gras').value) || 60,
    agua: parseInt($('aj-agua').value) || 8
  });
  DB.set('ia', { prov: $('aj-ia-prov').value, key: $('aj-ia-key').value.trim() });
  toast('✅ Ajustes guardados');
  renderDiario();
}

function exportarDatos() {
  const datos = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('cal_')) datos[k] = JSON.parse(localStorage.getItem(k));
  }
  const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calorias-backup-${hoyISO()}.json`;
  a.click();
}

function importarDatos(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const datos = JSON.parse(reader.result);
      for (const [k, v] of Object.entries(datos)) {
        if (k.startsWith('cal_')) localStorage.setItem(k, JSON.stringify(v));
      }
      toast('✅ Datos importados');
      location.reload();
    } catch { toast('❌ Archivo no válido'); }
  };
  reader.readAsText(file);
}

// ---------- Navegación ----------
function cambiarTab(nombre) {
  document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
  $('tab-' + nombre).classList.remove('hidden');
  document.querySelectorAll('.bottom-nav button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === nombre));
  if (nombre === 'diario') renderDiario();
  if (nombre === 'anadir') renderFrecuentes();
  if (nombre === 'progreso') renderProgreso();
  if (nombre === 'recetas') renderRecetas();
  if (nombre === 'ajustes') cargarAjustes();
  if (nombre !== 'anadir') cerrarEscaner();
  window.scrollTo(0, 0);
}

// ---------- Init ----------
function init() {
  const perfil = DB.get('perfil');
  if (!perfil) {
    $('screen-onboarding').classList.remove('hidden');
    $('ob-guardar').onclick = () => {
      const p = {
        sexo: $('ob-sexo').value,
        edad: parseInt($('ob-edad').value) || 30,
        peso: parseFloat($('ob-peso').value) || 75,
        altura: parseInt($('ob-altura').value) || 175,
        actividad: parseFloat($('ob-actividad').value),
        ajusteKcal: parseInt($('ob-objetivo').value)
      };
      DB.set('perfil', p);
      DB.set('objetivos', calcularObjetivos(p));
      DB.set('pesos', [{ fecha: hoyISO(), kg: p.peso }]);
      $('screen-onboarding').classList.add('hidden');
      arrancarApp();
    };
    return;
  }
  arrancarApp();
}

function arrancarApp() {
  $('app').classList.remove('hidden');

  // Nav
  document.querySelectorAll('.bottom-nav button').forEach(b =>
    b.onclick = () => cambiarTab(b.dataset.tab));

  // Día
  $('dia-prev').onclick = () => { fechaActual = sumarDias(fechaActual, -1); renderDiario(); };
  $('dia-next').onclick = () => { fechaActual = sumarDias(fechaActual, 1); renderDiario(); };

  // Agua
  $('agua-mas').onclick = () => { const d = getDiario(fechaActual); d.agua = (d.agua || 0) + 1; setDiario(fechaActual, d); renderDiario(); };
  $('agua-menos').onclick = () => { const d = getDiario(fechaActual); d.agua = Math.max(0, (d.agua || 0) - 1); setDiario(fechaActual, d); renderDiario(); };

  // Añadir
  $('busq-btn').onclick = buscar;
  $('busq-input').onkeydown = e => { if (e.key === 'Enter') buscar(); };
  $('btn-escanear').onclick = abrirEscaner;
  $('scanner-cerrar').onclick = cerrarEscaner;
  $('btn-manual').onclick = entradaManual;
  $('btn-foto-ia').onclick = () => $('foto-input').click();
  $('foto-input').onchange = e => { if (e.target.files[0]) { analizarFoto(e.target.files[0]); e.target.value = ''; } };

  // Progreso
  $('peso-guardar').onclick = guardarPeso;

  // Recetas
  $('receta-nueva').onclick = () => editorReceta(null);

  // Ajustes
  $('aj-guardar').onclick = guardarAjustes;
  $('aj-recalcular').onclick = () => {
    const p = DB.get('perfil');
    const o = calcularObjetivos(p);
    DB.set('objetivos', o);
    cargarAjustes();
    toast('✅ Recalculado: ' + o.kcal + ' kcal');
  };
  $('aj-exportar').onclick = exportarDatos;
  $('aj-importar').onclick = () => $('aj-importar-file').click();
  $('aj-importar-file').onchange = e => { if (e.target.files[0]) importarDatos(e.target.files[0]); };
  $('aj-borrar').onclick = () => {
    modal(`<h3>⚠️ ¿Borrar TODOS los datos?</h3><p class="muted">Esta acción no se puede deshacer.</p>
      <div class="modal-acciones">
        <button class="cancel" onclick="cerrarModal()">Cancelar</button>
        <button class="ok" style="background:#7f1d1d" id="m-borrar-todo">Borrar todo</button>
      </div>`);
    $('m-borrar-todo').onclick = () => {
      Object.keys(localStorage).filter(k => k.startsWith('cal_')).forEach(k => localStorage.removeItem(k));
      location.reload();
    };
  };

  renderDiario();
}

async function buscar() {
  const q = $('busq-input').value.trim();
  if (!q) return;
  $('busq-resultados').innerHTML = '<p class="muted" style="padding:10px">Buscando... <span class="spinner"></span></p>';
  try {
    renderResultados(await buscarOFF(q), $('busq-resultados'));
  } catch {
    $('busq-resultados').innerHTML = '<p class="muted" style="padding:10px">❌ Error de red al buscar.</p>';
  }
}

function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
