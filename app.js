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

  renderConsejos(tot, obj, d);

  // Bloques de comidas
  const cont = $('comidas-lista');
  cont.innerHTML = '';
  const diarioAyer = getDiario(sumarDias(fechaActual, -1));
  for (const c of COMIDAS) {
    const items = d.comidas[c] || [];
    const itemsAyer = diarioAyer.comidas[c] || [];
    const kcalC = items.reduce((s, a) => s + a.kcal, 0);
    const bloque = document.createElement('div');
    bloque.className = 'comida-bloque';
    bloque.innerHTML = `
      <div class="comida-head">
        <h3>${COMIDAS_LABEL[c]}</h3>
        <div><span class="kcal">${Math.round(kcalC)} kcal</span>
        ${!items.length && itemsAyer.length ? `<button data-ayer="${c}" title="Repetir lo de ayer">⟳</button>` : ''}
        ${items.length ? `<button data-save="${c}" title="Guardar como plantilla">💾</button>` : ''}
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
      el.onclick = () => opcionesAlimento(c, i, a);
      bloque.appendChild(el);
    });
    cont.appendChild(bloque);
  }
  cont.querySelectorAll('[data-add]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); $('add-comida').value = b.dataset.add; cambiarTab('anadir'); };
  });
  cont.querySelectorAll('[data-save]').forEach(b => {
    b.onclick = (e) => { e.stopPropagation(); guardarPlantilla(b.dataset.save); };
  });
  cont.querySelectorAll('[data-ayer]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const c = b.dataset.ayer;
      const itemsAyer = getDiario(sumarDias(fechaActual, -1)).comidas[c] || [];
      const dd = getDiario(fechaActual);
      dd.comidas[c] = JSON.parse(JSON.stringify(itemsAyer));
      setDiario(fechaActual, dd);
      renderDiario();
      toast(`✅ ${COMIDAS_LABEL[c].slice(3)} de ayer copiada`);
    };
  });
}

function opcionesAlimento(comida, idx, a) {
  const conPor100 = !!a.por100;
  const gramos = parseFloat(a.cantidad) || 100;
  modal(`
    <h3>${escapeHtml(a.nombre)}</h3>
    ${conPor100
      ? `<label>Cantidad (g/ml) <input type="number" id="m-ed-cant" value="${gramos}" min="1"></label>`
      : `<label>Calorías (kcal) <input type="number" id="m-ed-kcal" value="${Math.round(a.kcal)}" min="0"></label>
         <label>Proteínas (g) <input type="number" id="m-ed-prot" value="${r1(a.prot)}" min="0"></label>
         <label>Carbohidratos (g) <input type="number" id="m-ed-carb" value="${r1(a.carb)}" min="0"></label>
         <label>Grasas (g) <input type="number" id="m-ed-gras" value="${r1(a.gras)}" min="0"></label>`}
    <div class="modal-acciones">
      <button class="cancel" onclick="cerrarModal()">Cancelar</button>
      <button style="background:#7f1d1d" id="m-ed-del">Eliminar</button>
      <button class="ok" id="m-ed-ok">Guardar</button>
    </div>`);
  $('m-ed-del').onclick = () => {
    const d = getDiario(fechaActual);
    d.comidas[comida].splice(idx, 1);
    setDiario(fechaActual, d);
    cerrarModal();
    renderDiario();
  };
  $('m-ed-ok').onclick = () => {
    const d = getDiario(fechaActual);
    const item = d.comidas[comida][idx];
    if (conPor100) {
      const g = parseFloat($('m-ed-cant').value) || gramos;
      const f = g / 100;
      item.cantidad = g + ' g';
      item.kcal = a.por100.kcal100 * f;
      item.prot = a.por100.prot100 * f;
      item.carb = a.por100.carb100 * f;
      item.gras = a.por100.gras100 * f;
      const porciones = DB.get('porciones', {});
      porciones[a.nombre.toLowerCase()] = g;
      DB.set('porciones', porciones);
    } else {
      item.kcal = parseFloat($('m-ed-kcal').value) || 0;
      item.prot = parseFloat($('m-ed-prot').value) || 0;
      item.carb = parseFloat($('m-ed-carb').value) || 0;
      item.gras = parseFloat($('m-ed-gras').value) || 0;
    }
    setDiario(fechaActual, d);
    cerrarModal();
    renderDiario();
    toast('✅ Actualizado');
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Plantillas de comidas ----------
function guardarPlantilla(comida) {
  const d = getDiario(fechaActual);
  const items = d.comidas[comida] || [];
  if (!items.length) return;
  const kcal = Math.round(items.reduce((s, a) => s + a.kcal, 0));
  modal(`
    <h3>💾 Guardar comida</h3>
    <p class="muted">${items.length} alimentos · ${kcal} kcal. La podrás añadir entera con un toque desde la pestaña Añadir.</p>
    <label>Nombre <input type="text" id="m-pl-nombre" value="${escapeHtml(COMIDAS_LABEL[comida].slice(3))} habitual"></label>
    <div class="modal-acciones">
      <button class="cancel" onclick="cerrarModal()">Cancelar</button>
      <button class="ok" id="m-pl-ok">Guardar</button>
    </div>`);
  $('m-pl-ok').onclick = () => {
    const plantillas = DB.get('plantillas', []);
    plantillas.push({
      id: Date.now(),
      nombre: $('m-pl-nombre').value.trim() || 'Comida guardada',
      items: JSON.parse(JSON.stringify(items))
    });
    DB.set('plantillas', plantillas);
    cerrarModal();
    toast('✅ Guardada en "Mis comidas"');
  };
}

function renderPlantillas() {
  const plantillas = DB.get('plantillas', []);
  const cont = $('busq-plantillas');
  if (!plantillas.length) { cont.innerHTML = ''; return; }
  cont.innerHTML = '<h3>💾 Mis comidas</h3>';
  for (const pl of plantillas) {
    const kcal = Math.round(pl.items.reduce((s, a) => s + a.kcal, 0));
    const el = document.createElement('div');
    el.className = 'resultado-item';
    el.innerHTML = `
      <div class="info">
        <div class="nombre">${escapeHtml(pl.nombre)}</div>
        <div class="detalle">${pl.items.map(i => escapeHtml(i.nombre)).join(', ').slice(0, 60)} · ${kcal} kcal</div>
      </div>
      <button class="pl-del" style="background:var(--card2);width:32px;height:32px;font-size:0.9rem">✕</button>
      <button class="pl-add">+</button>`;
    el.querySelector('.pl-add').onclick = () => {
      const comida = $('add-comida').value;
      for (const item of pl.items) anadirAlimento(fechaActual, comida, JSON.parse(JSON.stringify(item)));
      toast(`✅ "${pl.nombre}" añadida (${pl.items.length} alimentos)`);
      cambiarTab('diario');
    };
    el.querySelector('.pl-del').onclick = () => {
      modal(`<h3>¿Eliminar plantilla?</h3><p class="muted">${escapeHtml(pl.nombre)}</p>
        <div class="modal-acciones">
          <button class="cancel" onclick="cerrarModal()">Cancelar</button>
          <button class="ok" style="background:#7f1d1d" id="m-pl-del">Eliminar</button>
        </div>`);
      $('m-pl-del').onclick = () => {
        DB.set('plantillas', DB.get('plantillas', []).filter(x => x.id !== pl.id));
        cerrarModal();
        renderPlantillas();
      };
    };
    cont.appendChild(el);
  }
}

// ---------- Consejos ----------
function renderConsejos(tot, obj, d) {
  const cont = $('consejos-card');
  const consejos = [];
  const esHoy = fechaActual === hoyISO();
  const hora = new Date().getHours();
  // Fracción del día "comestible" transcurrida (de 7h a 22h)
  const avance = esHoy ? Math.min(1, Math.max(0, (hora - 7) / 15)) : 1;
  const exceso = tot.kcal - obj.kcal;

  if (exceso > 0) {
    consejos.push({ ico: '🔴', cls: 'alerta', txt: `Te has pasado ${Math.round(exceso)} kcal del objetivo. ${hora < 20 && esHoy ? 'Intenta una cena ligera (verdura, proteína) y, si puedes, sal a caminar 30 min.' : 'No pasa nada por un día: mañana vuelve a tu pauta, no compenses saltándote comidas.'}` });
  } else if (avance > 0.9 && tot.kcal < obj.kcal * 0.7) {
    consejos.push({ ico: '🟡', cls: 'alerta', txt: `Llevas solo ${Math.round(tot.kcal)} kcal — te faltan ${Math.round(obj.kcal - tot.kcal)} para tu objetivo. Comer demasiado poco también frena el progreso; añade algo nutritivo antes de dormir (yogur, frutos secos, fruta).` });
  } else if (esHoy && tot.kcal > obj.kcal * (avance + 0.2)) {
    consejos.push({ ico: '🟠', cls: '', txt: `Vas algo rápido: ya llevas el ${Math.round((tot.kcal / obj.kcal) * 100)}% de tus calorías. Resérvate ${Math.round(obj.kcal - tot.kcal)} kcal para lo que queda de día.` });
  }

  if (avance > 0.5 && tot.prot < obj.prot * avance * 0.6) {
    consejos.push({ ico: '🥩', cls: '', txt: `Vas corto de proteína (${Math.round(tot.prot)} de ${obj.prot} g). Buenas opciones: pollo, huevos, atún, yogur griego o legumbres.` });
  }

  if (esHoy && avance > 0.5 && (d.agua || 0) < obj.agua * avance * 0.5) {
    consejos.push({ ico: '💧', cls: '', txt: `Solo ${d.agua || 0} vasos de agua. ¡Hidrátate!` });
  }

  if (!consejos.length && tot.kcal > 0) {
    consejos.push({ ico: '✅', cls: 'ok', txt: avance >= 1 ? '¡Buen día! Has cumplido tu objetivo sin pasarte.' : 'Todo en orden: vas bien encaminado con tus objetivos de hoy.' });
  }

  cont.innerHTML = consejos.map(c =>
    `<div class="consejo ${c.cls}"><span class="ico">${c.ico}</span><span>${c.txt}</span></div>`).join('');

  if (tot.kcal > 0) {
    const btn = document.createElement('button');
    btn.className = 'btn-consejo-ia';
    btn.textContent = '🤖 Pedir consejo a la IA';
    btn.onclick = consejoIA;
    cont.appendChild(btn);
  }
  if (!consejos.length && tot.kcal === 0) {
    cont.innerHTML = '<div class="consejo"><span class="ico">📝</span><span>Registra lo que comas y aquí te iré aconsejando.</span></div>';
  }
}

async function consejoIA() {
  const ia = DB.get('ia', {});
  if (!ia.key) { toast('⚙️ Configura la API key de IA en Ajustes'); cambiarTab('ajustes'); return; }

  const obj = DB.get('objetivos');
  const tot = totalesDia(fechaActual);
  const perfil = DB.get('perfil', {});
  const d = getDiario(fechaActual);
  const lista = [];
  for (const c of COMIDAS) {
    for (const a of (d.comidas[c] || [])) lista.push(`${COMIDAS_LABEL[c].slice(3)}: ${a.nombre} (${Math.round(a.kcal)} kcal)`);
  }
  const objetivo = perfil.ajusteKcal < 0 ? 'perder peso' : perfil.ajusteKcal > 0 ? 'ganar peso' : 'mantener peso';

  const prompt = `Eres un nutricionista práctico y cercano. Mi objetivo es ${objetivo}.
Objetivos de hoy: ${obj.kcal} kcal, ${obj.prot} g proteína, ${obj.carb} g carbohidratos, ${obj.gras} g grasas.
Llevo consumido: ${Math.round(tot.kcal)} kcal, ${Math.round(tot.prot)} g proteína, ${Math.round(tot.carb)} g carbohidratos, ${Math.round(tot.gras)} g grasas.
Son las ${new Date().getHours()}:00. Lo que he comido hoy:
${lista.join('\n') || '(nada registrado)'}

Dame 2-3 consejos breves y concretos para lo que queda de día (qué cenar, qué evitar, qué mejorar). Máximo 80 palabras, sin saludos ni despedidas.`;

  toast('🤖 Pensando... <span class="spinner"></span>', 20000);
  try {
    const texto = await iaTexto(ia, prompt);
    modal(`<h3>🤖 Consejo de la IA</h3>
      <p class="ia-consejo-texto">${escapeHtml(texto)}</p>
      <div class="modal-acciones"><button class="ok" onclick="cerrarModal()">Entendido</button></div>`);
    $('toast').classList.add('hidden');
  } catch (e) {
    toast('❌ Error de IA: ' + (e.message || e), 5000);
  }
}

async function iaTexto(ia, prompt) {
  if (ia.prov === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${ia.key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'HTTP ' + r.status); }
    const data = await r.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sin respuesta';
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ia.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || 'HTTP ' + r.status); }
  const data = await r.json();
  if (data.stop_reason === 'refusal') throw new Error('La IA rechazó la petición');
  return (data.content || []).find(b => b.type === 'text')?.text || 'Sin respuesta';
}

// ---------- Modal ----------
function modal(html) {
  $('modal-box').innerHTML = html;
  $('modal').classList.remove('hidden');
}
function cerrarModal() { $('modal').classList.add('hidden'); }
$('modal') && ($('modal').onclick = (e) => { if (e.target.id === 'modal') cerrarModal(); });

// ---------- Base local de alimentos frescos (kcal, prot, carb, gras por 100 g) ----------
const ALIMENTOS_BASE = [
  // Frutas
  ['Manzana', 52, 0.3, 14, 0.2], ['Plátano', 89, 1.1, 23, 0.3], ['Naranja', 47, 0.9, 12, 0.1],
  ['Pera', 57, 0.4, 15, 0.1], ['Uvas', 69, 0.7, 18, 0.2], ['Fresas', 32, 0.7, 8, 0.3],
  ['Sandía', 30, 0.6, 8, 0.2], ['Melón', 34, 0.8, 8, 0.2], ['Piña', 50, 0.5, 13, 0.1],
  ['Kiwi', 61, 1.1, 15, 0.5], ['Mango', 60, 0.8, 15, 0.4], ['Melocotón', 39, 0.9, 10, 0.3],
  ['Cerezas', 63, 1.1, 16, 0.2], ['Ciruela', 46, 0.7, 11, 0.3], ['Mandarina', 53, 0.8, 13, 0.3],
  ['Limón', 29, 1.1, 9, 0.3], ['Aguacate', 160, 2, 9, 15], ['Granada', 83, 1.7, 19, 1.2],
  ['Higos', 74, 0.8, 19, 0.3], ['Arándanos', 57, 0.7, 14, 0.3],
  // Verduras y hortalizas
  ['Tomate', 18, 0.9, 3.9, 0.2], ['Lechuga', 15, 1.4, 2.9, 0.2], ['Cebolla', 40, 1.1, 9, 0.1],
  ['Zanahoria', 41, 0.9, 10, 0.2], ['Pimiento', 31, 1, 6, 0.3], ['Pepino', 15, 0.7, 3.6, 0.1],
  ['Calabacín', 17, 1.2, 3.1, 0.3], ['Berenjena', 25, 1, 6, 0.2], ['Brócoli', 34, 2.8, 7, 0.4],
  ['Coliflor', 25, 1.9, 5, 0.3], ['Espinacas', 23, 2.9, 3.6, 0.4], ['Judías verdes', 31, 1.8, 7, 0.2],
  ['Espárragos', 20, 2.2, 3.9, 0.1], ['Champiñones', 22, 3.1, 3.3, 0.3], ['Calabaza', 26, 1, 7, 0.1],
  ['Alcachofa', 47, 3.3, 11, 0.2], ['Puerro', 61, 1.5, 14, 0.3], ['Ajo', 149, 6.4, 33, 0.5],
  ['Remolacha', 43, 1.6, 10, 0.2], ['Col / repollo', 25, 1.3, 6, 0.1],
  ['Patata cocida', 87, 1.9, 20, 0.1], ['Patatas fritas caseras', 190, 2.8, 25, 9],
  ['Boniato', 86, 1.6, 20, 0.1], ['Maíz dulce', 86, 3.3, 19, 1.4], ['Aceitunas', 115, 0.8, 6, 11],
  // Carnes y embutidos
  ['Pechuga de pollo (plancha)', 165, 31, 0, 3.6], ['Muslo de pollo', 209, 26, 0, 11],
  ['Pechuga de pavo', 135, 29, 0, 1.7], ['Ternera magra', 150, 26, 0, 5],
  ['Lomo de cerdo', 143, 26, 0, 4], ['Cordero', 294, 25, 0, 21], ['Conejo', 173, 33, 0, 3.5],
  ['Hamburguesa de ternera', 250, 17, 0, 20], ['Salchicha fresca', 300, 14, 2, 27],
  ['Jamón serrano', 241, 31, 0, 13], ['Jamón cocido (york)', 110, 18, 1.5, 3.5],
  ['Lomo embuchado', 380, 38, 0.5, 25], ['Chorizo', 455, 24, 2, 39], ['Salchichón', 430, 25, 2, 36],
  ['Fuet', 470, 25, 2, 41], ['Bacon', 540, 37, 1, 42],
  // Pescados y mariscos
  ['Merluza', 86, 17, 0, 2], ['Atún fresco', 144, 23, 0, 5],
  ['Atún en lata (aceite, escurrido)', 198, 29, 0, 8], ['Atún en lata (al natural)', 116, 26, 0, 1],
  ['Salmón', 208, 20, 0, 13], ['Sardinas', 208, 25, 0, 11], ['Boquerones', 131, 20, 0, 5],
  ['Dorada', 96, 19, 0, 2], ['Lubina', 97, 18, 0, 2.5], ['Bacalao', 82, 18, 0, 0.7],
  ['Gambas', 85, 20, 0, 0.5], ['Calamares', 92, 16, 3, 1.4], ['Mejillones', 86, 12, 3.7, 2.2],
  ['Pulpo', 82, 15, 2.2, 1], ['Almejas', 74, 12, 2.6, 1], ['Surimi (palitos)', 95, 8, 9, 0.5],
  // Huevos y lácteos
  ['Huevo', 143, 13, 1.1, 9.5], ['Clara de huevo', 52, 11, 0.7, 0.2],
  ['Leche entera', 61, 3.2, 4.8, 3.3], ['Leche semidesnatada', 46, 3.2, 4.8, 1.6],
  ['Leche desnatada', 34, 3.4, 5, 0.1], ['Yogur natural', 61, 3.5, 4.7, 3.3],
  ['Yogur griego', 120, 4.8, 4.5, 10], ['Kéfir', 55, 3.3, 4, 3],
  ['Queso fresco (Burgos)', 174, 12, 3, 13], ['Queso curado', 410, 29, 0.5, 33],
  ['Queso semicurado', 380, 26, 1, 31], ['Mozzarella', 280, 22, 2, 22],
  ['Requesón', 96, 11, 3, 4], ['Mantequilla', 717, 0.9, 0.1, 81], ['Nata', 337, 2, 3, 35],
  // Cereales, legumbres y pan
  ['Arroz blanco cocido', 130, 2.7, 28, 0.3], ['Arroz crudo', 365, 7, 80, 0.6],
  ['Pasta cocida', 158, 5.8, 31, 0.9], ['Pasta cruda', 371, 13, 75, 1.5],
  ['Pan blanco', 265, 9, 49, 3.2], ['Pan integral', 247, 13, 41, 3.4],
  ['Pan de molde', 250, 8, 45, 3.5], ['Biscotes / tostadas', 408, 11, 75, 6],
  ['Avena (copos)', 389, 17, 66, 7], ['Quinoa cocida', 120, 4.4, 21, 1.9],
  ['Cuscús cocido', 112, 3.8, 23, 0.2], ['Lentejas cocidas', 116, 9, 20, 0.4],
  ['Garbanzos cocidos', 164, 8.9, 27, 2.6], ['Alubias cocidas', 127, 8.7, 23, 0.5],
  ['Guisantes', 81, 5.4, 14, 0.4], ['Harina de trigo', 364, 10, 76, 1],
  ['Tortilla de trigo (wrap)', 310, 8, 52, 8], ['Cereales de desayuno', 380, 7, 84, 0.9],
  ['Galletas maría', 436, 7, 75, 12], ['Tofu', 76, 8, 1.9, 4.8], ['Seitán', 121, 21, 4, 2],
  // Frutos secos y semillas
  ['Almendras', 579, 21, 22, 50], ['Nueces', 654, 15, 14, 65], ['Cacahuetes', 567, 26, 16, 49],
  ['Pistachos', 560, 20, 28, 45], ['Anacardos', 553, 18, 30, 44], ['Avellanas', 628, 15, 17, 61],
  ['Pipas de girasol', 584, 21, 20, 51], ['Dátiles', 282, 2.5, 75, 0.4], ['Pasas', 299, 3, 79, 0.5],
  ['Crema de cacahuete', 588, 25, 20, 50],
  // Aceites, salsas y dulces
  ['Aceite de oliva', 884, 0, 0, 100], ['Aceite de girasol', 884, 0, 0, 100],
  ['Mayonesa', 680, 1, 2.6, 75], ['Ketchup', 112, 1.2, 26, 0.1], ['Tomate frito', 80, 1.5, 8, 4.5],
  ['Azúcar', 387, 0, 100, 0], ['Miel', 304, 0.3, 82, 0],
  ['Chocolate negro 70%', 546, 7.8, 46, 31], ['Chocolate con leche', 535, 7.6, 59, 30],
  ['Cacao en polvo (tipo ColaCao)', 380, 5, 80, 3.5], ['Mermelada', 250, 0.3, 60, 0.1],
  ['Helado', 207, 3.5, 24, 11], ['Magdalena', 430, 6, 52, 22], ['Churros', 380, 4.5, 40, 22],
  // Bebidas
  ['Cerveza', 43, 0.5, 3.6, 0], ['Cerveza sin alcohol', 24, 0.3, 5, 0],
  ['Vino tinto', 85, 0.1, 2.6, 0], ['Refresco de cola', 42, 0, 10.6, 0],
  ['Zumo de naranja', 45, 0.7, 10, 0.2], ['Café solo', 2, 0.1, 0, 0],
  // Platos típicos
  ['Tortilla de patatas', 190, 6, 14, 12], ['Paella', 156, 8, 19, 5],
  ['Gazpacho', 45, 1, 4.5, 2.5], ['Croquetas', 230, 7, 20, 13], ['Pizza', 266, 11, 33, 10],
  ['Lasaña', 135, 8, 12, 6], ['Hummus', 166, 8, 14, 10], ['Ensaladilla rusa', 130, 3, 10, 9],
  ['Empanada', 280, 8, 30, 14], ['Proteína whey (polvo)', 400, 80, 8, 6]
];

function normalizar(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buscarLocal(q) {
  const nq = normalizar(q);
  return ALIMENTOS_BASE
    .filter(a => normalizar(a[0]).includes(nq))
    .map(a => ({ nombre: a[0], kcal100: a[1], prot100: a[2], carb100: a[3], gras100: a[4], local: true }));
}

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
  const porciones = DB.get('porciones', {});
  const habitual = porciones[prod.nombre.toLowerCase()];
  modal(`
    <h3>${escapeHtml(prod.nombre)}</h3>
    <p class="muted">${Math.round(prod.kcal100)} kcal · P ${r1(prod.prot100)} · C ${r1(prod.carb100)} · G ${r1(prod.gras100)} (por 100 g)</p>
    <label>Cantidad (g/ml)${habitual ? ' <small>— tu ración habitual</small>' : ''} <input type="number" id="m-cant" value="${habitual || 100}" min="1"></label>
    <div class="modal-acciones">
      <button class="cancel" onclick="cerrarModal()">Cancelar</button>
      <button class="ok" id="m-ok">Añadir</button>
    </div>`);
  $('m-cant').focus();
  $('m-ok').onclick = () => {
    const g = parseFloat($('m-cant').value) || 100;
    porciones[prod.nombre.toLowerCase()] = g;
    DB.set('porciones', porciones);
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
function crearItemProducto(prod) {
  const el = document.createElement('div');
  el.className = 'resultado-item';
  el.innerHTML = `
    <div class="info">
      <div class="nombre">${escapeHtml(prod.nombre)}</div>
      <div class="detalle">${Math.round(prod.kcal100)} kcal · P ${r1(prod.prot100)} · C ${r1(prod.carb100)} · G ${r1(prod.gras100)} /100g</div>
    </div>
    <button>+</button>`;
  el.querySelector('button').onclick = () =>
    dialogoCantidad(prod, a => { anadirAlimento(fechaActual, $('add-comida').value, a); toast('✅ Añadido'); });
  return el;
}

function renderFrecuentes() {
  const lista = DB.get('frecuentes', []).slice(0, 8);
  const cont = $('busq-frecuentes');
  if (!lista.length) { cont.innerHTML = ''; return; }
  cont.innerHTML = '<h3>⭐ Frecuentes</h3>';
  lista.forEach(p => cont.appendChild(crearItemProducto(p)));
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

function renderRachaCalendario() {
  // Racha: días seguidos con algo registrado (hoy sin registrar aún no la rompe)
  let racha = 0;
  let f = hoyISO();
  if (totalesDia(f).kcal === 0) f = sumarDias(f, -1);
  while (totalesDia(f).kcal > 0) { racha++; f = sumarDias(f, -1); }
  $('racha-card').innerHTML = `<span style="font-size:1.6rem">🔥</span>
    <div><span class="num">${racha}</span> día${racha === 1 ? '' : 's'} seguidos registrando</div>`;

  // Calendario del mes
  const obj = DB.get('objetivos');
  const ahora = new Date();
  const año = ahora.getFullYear(), mes = ahora.getMonth();
  const diasMes = new Date(año, mes + 1, 0).getDate();
  const primerDia = (new Date(año, mes, 1).getDay() + 6) % 7; // lunes = 0
  let html = `<h3>${ahora.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</h3><div class="cal-grid">`;
  for (const dow of ['L', 'M', 'X', 'J', 'V', 'S', 'D']) html += `<span class="cal-dow">${dow}</span>`;
  for (let i = 0; i < primerDia; i++) html += '<span></span>';
  for (let dia = 1; dia <= diasMes; dia++) {
    const fecha = `${año}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    let cls = 'cal-dia';
    if (fecha <= hoyISO()) {
      const t = totalesDia(fecha);
      if (t.kcal > 0) cls += t.kcal <= obj.kcal * 1.05 ? ' ok' : ' pasado';
    }
    if (fecha === hoyISO()) cls += ' hoy';
    html += `<span class="${cls}">${dia}</span>`;
  }
  html += `</div>
    <div class="cal-leyenda">
      <span><i style="background:#14532d"></i>Dentro de objetivo</span>
      <span><i style="background:#7f1d1d"></i>Pasado</span>
      <span><i style="background:var(--card2)"></i>Sin registro</span>
    </div>`;
  $('calendario').innerHTML = html;
}

function renderProgreso() {
  renderRachaCalendario();
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
  if (nombre === 'anadir') { renderPlantillas(); renderFrecuentes(); }
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
  const cont = $('busq-resultados');
  cont.innerHTML = '';

  // 1) Base local (instantánea, funciona sin internet)
  const locales = buscarLocal(q);
  if (locales.length) {
    const h = document.createElement('h3');
    h.textContent = '🥦 Alimentos básicos';
    cont.appendChild(h);
    locales.slice(0, 8).forEach(p => cont.appendChild(crearItemProducto(p)));
  }

  // 2) Open Food Facts (productos envasados)
  const estado = document.createElement('p');
  estado.className = 'muted';
  estado.style.padding = '10px';
  estado.innerHTML = 'Buscando productos... <span class="spinner"></span>';
  cont.appendChild(estado);
  try {
    const off = await buscarOFF(q);
    estado.remove();
    if (off.length) {
      const h = document.createElement('h3');
      h.textContent = '📦 Productos';
      cont.appendChild(h);
      off.forEach(p => cont.appendChild(crearItemProducto(p)));
    } else if (!locales.length) {
      cont.innerHTML = '<p class="muted" style="padding:10px">Sin resultados.</p>';
    }
  } catch {
    estado.textContent = locales.length
      ? 'Sin conexión: mostrando solo alimentos básicos.'
      : '❌ Sin conexión y ningún alimento básico coincide.';
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
