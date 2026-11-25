"use strict";
// Same-origin by default: this works on localhost, HTTPS deployments, and custom ports.
const API = window.API_BASE ?? "";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = (n, d = 2) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: d });
const nice = s => String(s).replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
let OPTS = null;

async function api(path, opt = {}) {
  let r;
  const headers = { ...(opt.headers || {}) };
  if (!(opt.body instanceof FormData)) headers["Content-Type"] = "application/json";
  try { r = await fetch(API + path, { credentials: "include", ...opt, headers }); }
  catch { throw { offline: true, message: "Cannot reach the server at " + API }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw { message: j.error || "Request failed", details: j.details || {}, status: r.status };
  return j.data;
}
function weatherDescription(code) {
  if (code === 0) return "Clear sky";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain/showers";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Current conditions";
}
function weatherIcon(code) {
  if (code === 0) return "☀️";
  if ([1, 2].includes(code)) return "🌤️";
  if ([3, 45, 48].includes(code)) return "☁️";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "🌨️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "🌦️";
}
function priceTrendSVG(points) {
  if (!points.length) return `<div class="chart-empty">Price history will appear after this app records reports on multiple dates.</div>`;
  const W = 720, H = 250, L = 48, R = 18, T = 18, B = 35;
  const vals = points.map(p => Number(p.modal_price)), lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || Math.max(1, hi * .06);
  const dates = points.map(p => new Date(`${p.price_date}T00:00:00`).getTime()), t0 = dates[0], tr = dates[dates.length - 1] - t0 || 1;
  const x = i => L + ((dates[i] - t0) / tr) * (W - L - R), y = v => H - B - ((v - (lo - span * .12)) / (span * 1.24)) * (H - T - B);
  const poly = points.map((p, i) => `${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(" ");
  const area = `${L},${H - B} ${poly} ${W - R},${H - B}`;
  const ticks = [lo, (lo + hi) / 2, hi].map(v => `<text x="4" y="${y(v) + 4}">₹${fmt(v, 0)}</text>`).join("");
  const labels = [0, points.length - 1].map(i => `<text x="${x(i)}" y="${H - 8}" text-anchor="${i ? "end" : "start"}">${new Date(`${points[i].price_date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</text>`).join("");
  return `<div class="price-chart-scroll"><svg class="price-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Historical modal mandi price chart"><defs><linearGradient id="price-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6ca878" stop-opacity=".28"/><stop offset="1" stop-color="#6ca878" stop-opacity="0"/></linearGradient></defs><line x1="${L}" y1="${y(hi)}" x2="${W-R}" y2="${y(hi)}" stroke="#e4eadd"/><line x1="${L}" y1="${y(lo)}" x2="${W-R}" y2="${y(lo)}" stroke="#e4eadd"/><polygon points="${area}" fill="url(#price-fill)"/><polyline points="${poly}" fill="none" stroke="#2f7a57" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(vals[i])}" r="3.5" fill="#fff" stroke="#2f7a57" stroke-width="2"><title>${esc(p.price_date)}: ₹${fmt(vals[i],0)}/quintal</title></circle>`).join("")}${ticks}${labels}</svg></div>`;
}
function priceOutlook(points) {
  if (points.length < 7) return `<div class="outlook-empty"><span>↗</span><b>Trend estimate unlocks after 7 reported dates</b><small>Use the market page on different days to build a history. No prices are filled in for missing days.</small></div>`;
  const sample = points.slice(-14), times = sample.map(p => new Date(`${p.price_date}T00:00:00`).getTime() / 86400000), prices = sample.map(p => Number(p.modal_price));
  const mx = times.reduce((a,b)=>a+b,0)/times.length, my = prices.reduce((a,b)=>a+b,0)/prices.length;
  const denom = times.reduce((a,x)=>a+(x-mx)**2,0) || 1, slope = times.reduce((a,x,i)=>a+(x-mx)*(prices[i]-my),0)/denom;
  const estimate = Math.max(0, prices[prices.length-1] + slope*7), change = prices[prices.length-1] ? (estimate/prices[prices.length-1]-1)*100 : 0;
  return `<div class="outlook-value"><span>Simple 7-day trend estimate</span><b>₹${fmt(estimate,0)}<small>/quintal</small></b><i class="${change >= 0 ? "trend-up" : "trend-down"}">${change >= 0 ? "↗" : "↘"} ${change >= 0 ? "+" : ""}${fmt(change,1)}% from latest reported modal</i><small>Linear trend from ${sample.length} reported dates. This is a rough indicator, not a reliable forecast or guaranteed sale price.</small></div>`;
}

/* ---------- small UI helpers ---------- */
const bars = (rows, l, v, unit = "", cls = "") => {
  const max = Math.max(...rows.map(r => r[v]), 1e-9);
  return `<div class="bars ${cls}">` + rows.map(r =>
    `<div class="bar"><span class="bl" title="${esc(r[l])}">${esc(r[l])}</span><span class="bt"><i style="width:${(r[v] / max * 100).toFixed(1)}%"></i></span><b>${fmt(r[v])}${unit}</b></div>`).join("") + `</div>`;
};
const COLORS = ["#1f4d3a", "#d9a441", "#b3402a", "#3d7ea6", "#7a8f3a", "#8a5a9e", "#5b5b5b", "#c2185b"];
const MARKET_CROPS = ["Cotton", "Groundnut", "Maize", "Potato", "Rice", "Soybean", "Sugarcane", "Wheat"];
const CROP_MARKS = {Cotton:"✿",Groundnut:"◉",Maize:"🌽",Potato:"◌",Rice:"〰",Soybean:"✳",Sugarcane:"♧",Wheat:"🌾"};
function cropSphereHTML(rows = []) {
  const crops = (rows.length ? rows : MARKET_CROPS.map(crop=>({crop}))).slice(0, 12);
  const cards = crops.map((row,i)=>`<article class="sphere-crop" data-sphere-card data-index="${i}"><span>${CROP_MARKS[row.crop]||"✳"}</span><b>${esc(row.crop)}</b>${Number.isFinite(Number(row.avg_yield))?`<small>${fmt(row.avg_yield,1)} t/ha</small>`:""}</article>`).join("");
  return `<section class="crop-sphere-panel"><div class="sphere-copy"><span class="eyebrow">Kisan Saathi · 3D farm view</span><h2>Explore your crops from a new angle.</h2><p>Drag the crop sphere to explore. Yield figures come from the training dataset.</p><a class="btn btn-secondary" href="#predict">Plan a crop <span>↗</span></a><small class="sphere-hint">Drag to rotate · reduced motion is respected</small></div><div class="sphere-stage" data-crop-sphere aria-label="Interactive 3D crop sphere"><div class="sphere-grid-glow"></div><div class="sphere-ring sphere-ring-a"></div><div class="sphere-ring sphere-ring-b"></div><div class="sphere-world" data-sphere-world>${cards}<h3 class="sphere-headline" data-sphere-headline><span><i>GROW</i><br>WITH<br>THE SEASONS</span></h3></div><div class="sphere-caption"><span>FARM ORBIT</span><b>Drag to explore</b></div></div></section>`;
}
function bindCropSphere(root = document) {
  root.querySelectorAll("[data-crop-sphere]").forEach(stage=>{
    if(stage.dataset.bound)return;stage.dataset.bound="1";
    const world=stage.querySelector("[data-sphere-world]"), headline=stage.querySelector("[data-sphere-headline]"), cards=[...stage.querySelectorAll("[data-sphere-card]")];
    const state={yaw:0,pitch:-7,vyaw:0,vpitch:0,drag:false,pending:false,startX:0,startY:0,lastX:0,lastY:0,pointer:null,radius:120,frame:null};
    const layout=()=>{const rect=stage.getBoundingClientRect();state.radius=Math.max(82,Math.min(rect.width*.37,rect.height*.39,175));const n=cards.length,golden=Math.PI*(3-Math.sqrt(5));cards.forEach((card,i)=>{const y=1-2*(i+.5)/n,r=Math.sqrt(1-y*y),theta=i*golden,x=Math.cos(theta)*r,z=Math.sin(theta)*r,yaw=Math.atan2(x,z)*180/Math.PI,pitch=-Math.asin(y)*180/Math.PI;card.style.transform=`rotateY(${yaw}deg) rotateX(${pitch}deg) translateZ(${state.radius}px)`;});};
    const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const schedule=()=>{if(state.frame===null)state.frame=requestAnimationFrame(render);};
    const render=()=>{state.frame=null;if(!stage.isConnected)return;state.yaw+=state.vyaw;state.pitch+=state.vpitch;state.vyaw*=.93;state.vpitch*=.93;if(Math.abs(state.vyaw)<.002)state.vyaw=0;if(Math.abs(state.vpitch)<.002)state.vpitch=0;state.pitch=Math.max(-34,Math.min(34,state.pitch));world.style.transform=`rotateX(${state.pitch}deg) rotateY(${state.yaw}deg)`;headline.style.transform=`rotateY(${-state.yaw}deg) rotateX(${-state.pitch}deg) translateZ(${state.radius*.61}px)`;if(state.drag||state.vyaw||state.vpitch)schedule();};
    const start=e=>{if(e.button!==undefined&&e.button!==0)return;state.pointer=e.pointerId;state.startX=state.lastX=e.clientX;state.startY=state.lastY=e.clientY;state.drag=e.pointerType!=="touch";state.pending=e.pointerType==="touch";state.vyaw=state.vpitch=0;stage.classList.add("is-grabbing");if(state.drag)stage.setPointerCapture?.(e.pointerId);};
    const move=e=>{if(state.pointer!==e.pointerId)return;const dx=e.clientX-state.lastX,dy=e.clientY-state.lastY;if(state.pending){const totalX=e.clientX-state.startX,totalY=e.clientY-state.startY;if(Math.abs(totalX)<9&&Math.abs(totalY)<9)return;if(Math.abs(totalY)>Math.abs(totalX)*1.15){state.pointer=null;state.pending=false;stage.classList.remove("is-grabbing");return;}state.pending=false;state.drag=true;stage.setPointerCapture?.(e.pointerId);}if(!state.drag)return;state.yaw+=dx*.34;state.pitch=Math.max(-34,Math.min(34,state.pitch-dy*.28));state.vyaw=reduced?0:dx*.11;state.vpitch=reduced?0:-dy*.08;state.lastX=e.clientX;state.lastY=e.clientY;schedule();};
    const end=e=>{if(state.pointer!==e.pointerId)return;state.pointer=null;state.drag=state.pending=false;stage.classList.remove("is-grabbing");if(reduced)state.vyaw=state.vpitch=0;schedule();};
    stage.addEventListener("pointerdown",start);stage.addEventListener("pointermove",move);stage.addEventListener("pointerup",end);stage.addEventListener("pointercancel",end);window.addEventListener("resize",layout,{passive:true});
    if("ResizeObserver" in window)new ResizeObserver(layout).observe(stage);layout();schedule();
  });
}
function lines(rows) {
  if (!rows.length) return `<p class="empty">No trend data.</p>`;
  const crops = [...new Set(rows.map(r => r.crop))], yrs = rows.map(r => r.year);
  const y0 = Math.min(...yrs), y1 = Math.max(...yrs), ym = Math.max(...rows.map(r => r.avg_yield));
  const W = 640, H = 250, P = 40, X = y => P + (y - y0) / ((y1 - y0) || 1) * (W - P - 12), Y = v => H - 28 - v / ym * (H - 44);
  const paths = crops.map((c, i) => {
    const pts = rows.filter(r => r.crop === c).sort((a, b) => a.year - b.year);
    return `<polyline fill="none" stroke="${COLORS[i % 8]}" stroke-width="2" points="${pts.map(p => X(p.year) + "," + Y(p.avg_yield)).join(" ")}"/>`;
  }).join("");
  return `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Average yield by year for the most common crops">
    <line x1="${P}" y1="${Y(0)}" x2="${W - 8}" y2="${Y(0)}" stroke="#c5cdb9"/><line x1="${P}" y1="${Y(ym)}" x2="${W - 8}" y2="${Y(ym)}" stroke="#e9eee0"/>
    <text x="4" y="${Y(ym) + 4}">${fmt(ym, 1)}</text><text x="4" y="${Y(0)}">0</text>
    <text x="${P}" y="${H - 8}">${y0}</text><text x="${W - 36}" y="${H - 8}">${y1}</text>${paths}</svg></div>
    <div class="legend">${crops.map((c, i) => `<span><i style="background:${COLORS[i % 8]}"></i>${esc(c)}</span>`).join("")}</div>`;
};
const field = (n, label, inner) => `<label class="f" data-f="${n}"><span>${label}</span>${inner}<small class="err"></small></label>`;
const num = (n, label, v, extra = "") => field(n, label, `<input name="${n}" type="number" step="any" value="${v}" ${extra}>`);
const sel = (n, label, list) => field(n, label, `<select name="${n}">${list.map(x => `<option>${esc(x)}</option>`).join("")}</select>`);

function formHTML(withCrop, btn) {
  const c = OPTS.categories;
  return `<form id="f" novalidate>
    ${withCrop ? sel("crop", "Crop", c.Crop) : ""}
    <div class="row2">${sel("season", "Season", c.Season)}${sel("state", "State", c.State)}</div>
    <div class="row2">${num("area", "Farm area", 5, 'min="0.01"')}${field("area_unit", "Unit", `<select name="area_unit"><option value="hectare">Hectare</option><option value="acre">Acre</option></select>`)}</div>
    ${num("rainfall", "Annual rainfall (mm)", 1000, 'min="0"')}
    <div class="row2">${num("fertilizer", "Fertilizer (kg/ha)", 120, 'min="0"')}${num("pesticide", "Pesticide (kg/ha)", 1, 'min="0"')}</div>
    ${num("soil_ph", "Soil pH (optional)", "", 'min="3" max="10" placeholder="e.g. 6.5"')}
    <button type="submit">${btn}</button></form>`;
}
function bindForm(onData, call) {
  const form = $("#f");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    form.querySelectorAll(".has-err").forEach(x => { x.classList.remove("has-err"); x.querySelector(".err").textContent = ""; });
    const body = Object.fromEntries(new FormData(form));
    const b = form.querySelector("button"), t = b.textContent; b.disabled = true; b.textContent = "Working…";
    try { onData(await call(body)); }
    catch (er) {
      if (er.details) for (const [k, m] of Object.entries(er.details)) {
        const f = form.querySelector(`[data-f="${k}"]`); if (f) { f.classList.add("has-err"); f.querySelector(".err").textContent = m; }
      }
      $("#out").innerHTML = `<div class="banner">${esc(er.message)}</div>`;
    } finally { b.disabled = false; b.textContent = t; }
  });
}
const layout = (title, lead, form) => `<h1>${title}</h1><p class="lead">${lead}</p>
  <div class="grid"><div class="card">${form}</div><div id="out"><div class="card empty">Fill in your farm details and run the prediction.</div></div></div>`;

/* ---------- views ---------- */
const views = {
  async dashboard() {
    const farmer = currentFarmer();
    $("#view").innerHTML = `<div class="top dashboard-welcome"><div><span class="eyebrow">Kisan Saathi · Farmer dashboard</span><h1>Welcome, ${esc(farmer?.name || "Farmer")}</h1><p class="lead">Your farm dashboard, crop insights and latest predictions.</p></div><span class="pill Low">${esc(farmer?.id || "Farmer")}</span></div><div id="out">Loading…</div>`;
    const [an, hist] = await Promise.all([api("/api/analytics"), api("/api/history")]), m = OPTS.metrics;
    $("#out").innerHTML = `${cropSphereHTML(an.crop_comparison.slice(0, 10))}<div class="cards3">
      <div class="card stat"><b>${hist.length}</b><span>Saved predictions</span></div>
      <div class="card stat"><b>${an.crop_comparison.length}</b><span>Crops in the dataset</span></div>
      <div class="card stat"><b>${fmt(OPTS.data_report.rows_clean, 0)}</b><span>Training records</span></div>
      <div class="card stat"><b>${fmt(m.R2, 2)}</b><span>Model accuracy (R²)</span></div></div>
      <p class="dashboard-actions"><a class="btn" href="#predict">Predict a yield&nbsp; →</a><a class="btn btn-secondary" href="#market">Check mandi prices&nbsp; ↗</a><a class="btn btn-secondary" href="#weather">Check weather</a></p>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="card"><h2>Highest-yielding crops</h2>${bars(an.crop_comparison.slice(0, 8), "crop", "avg_yield", " t/ha")}</div>
      <div class="card"><h2>Latest predictions</h2>${hist.length ? `<div class="scroll"><table><tbody>${hist.slice(0, 5).map(r => `<tr><td>${esc(r.crop)}</td><td>${fmt(r.yield_t_ha)} t/ha</td><td><span class="pill ${esc(r.risk)}">${esc(r.risk)}</span></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">Nothing yet. <a href="#predict">Run your first prediction</a>.</p>`}</div></div>`;
    bindCropSphere($("#out"));
  },
  predict() {
    $("#view").innerHTML = layout("Predict your yield", "Enter your farm details to get an expected yield, a risk level and plain-language advice.", formHTML(true, "Predict yield"));
    bindForm(d => {
      $("#out").innerHTML = `<div class="result">
        <div class="hero"><div class="big">${fmt(d.predicted_yield)}<small>${d.yield_unit}</small></div>
          <p>Estimated production: <b>${fmt(d.estimated_production)} ${d.production_unit}</b> on ${fmt(d.area_ha)} ha &nbsp;<span class="pill ${d.risk}">${d.risk} risk</span></p></div>
        <div class="card"><h2>Compared with typical yield</h2>
          ${bars([{ l: "Your prediction", v: d.predicted_yield }, { l: "Typical (median)", v: d.reference_yield_median }], "l", "v", " t/ha", "wheat")}
          <p class="note">${esc(d.risk_explanation)}</p></div>
        <div class="card"><h2>Advice for your farm</h2>${d.recommendations.map(r => `<div class="rec ${esc(r.level)}"><b>${esc(r.title)}</b><span>${esc(r.why)}</span> <em>(${esc(r.category)}, ${esc(r.source)})</em></div>`).join("")}</div>
        <div class="card"><h2>What the model pays most attention to</h2>
          ${bars(d.top_factors.map(f => ({ n: nice(f.feature), v: +(f.importance * 100).toFixed(1) })), "n", "v", "%")}
          <p class="note">${esc(d.top_factors_note)}</p></div></div>`;
    }, b => api("/api/predict", { method: "POST", body: JSON.stringify(b) }));
  },
  async fields() {
    const rows = await api("/api/fields");
    $("#view").innerHTML = `<div class="page-heading"><div><span class="eyebrow">Your farm</span><h1>Fields & plots</h1><p class="lead">Save each plot once so tasks and crop health notes can be linked to the right place.</p></div><span class="grow-mark" aria-hidden="true">🌱</span></div><div class="field-workspace"><form id="field-form" class="card"><h2>Add a field</h2><label class="f"><span>Field name</span><input name="name" required minlength="2" maxlength="70" placeholder="e.g. North plot"></label><div class="row2"><label class="f"><span>State</span><select name="state">${OPTS.categories.State.map(x=>`<option>${esc(x)}</option>`).join("")}</select></label><label class="f"><span>District</span><input name="district" required minlength="2" maxlength="80" placeholder="District"></label></div><label class="f"><span>Village (optional)</span><input name="village" maxlength="80" placeholder="Village or area"></label><div class="row2"><label class="f"><span>Area</span><input name="area" type="number" min="0.01" step="any" required value="1"></label><label class="f"><span>Unit</span><select name="unit"><option value="hectare">Hectare</option><option value="acre">Acre</option></select></label></div><label class="f"><span>Soil type (optional)</span><input name="soil_type" maxlength="80" placeholder="e.g. Black soil"></label><label class="f"><span>Soil pH (optional)</span><input name="soil_ph" type="number" min="3" max="10" step="any" placeholder="e.g. 6.5"></label><div id="field-error" class="auth-error" role="status"></div><button type="submit">Save field</button></form><section><div class="field-card-grid">${rows.length ? rows.map(r=>`<article class="card field-card"><div class="field-card-head"><span class="grow-mark" aria-hidden="true">🌾</span><button class="ghost" data-delete-field="${r.id}" type="button">Remove</button></div><h2>${esc(r.name)}</h2><p>${esc(r.village ? `${r.village}, ` : "")}${esc(r.district)}, ${esc(r.state)}</p><div class="field-meta"><b>${fmt(r.area_ha,2)} ha</b><span>${esc(r.soil_type || "Soil type not set")}</span>${r.soil_ph ? `<span>pH ${fmt(r.soil_ph,1)}</span>` : ""}</div><a href="#calendar">Plan field tasks →</a></article>`).join("") : `<div class="card empty">No fields yet. Add your first plot to link reminders and crop notes.</div>`}</div></section></div>`;
    $("#field-form").addEventListener("submit", async e=>{
      e.preventDefault(); const form=e.currentTarget, data=Object.fromEntries(new FormData(form)), button=form.querySelector("button"), error=$("#field-error");
      button.disabled=true; error.textContent="";
      try { await api("/api/fields",{method:"POST",body:JSON.stringify({...data,area_ha:Number(data.area)*(data.unit==="acre"?0.404686:1)})}); views.fields(); }
      catch(er){error.textContent=er.message;} finally{button.disabled=false;}
    });
    $("#view").onclick=async e=>{const id=e.target.dataset?.deleteField;if(!id)return;if(!confirm("Remove this field? Its reminders will also be removed."))return;try{await api(`/api/fields/${id}`,{method:"DELETE"});views.fields();}catch(er){alert(er.message);}};
  },
  async calendar() {
    const [fields, reminders] = await Promise.all([api("/api/fields"), api("/api/reminders")]);
    const today = new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
    const taskList = () => reminders.length ? reminders.map(r=>`<article class="reminder-row ${r.completed?"is-done":""}"><span class="reminder-date">${new Date(`${r.due_date}T12:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</span><div class="reminder-info"><b>${esc(r.title)}</b><span>${esc(r.category)}${r.field_name?` · ${esc(r.field_name)}`:""}</span><small>${r.completed?"Completed":r.days_until<0?`${Math.abs(r.days_until)} days overdue`:r.days_until===0?"Due today":`In ${r.days_until} days`}${r.notes?` · ${esc(r.notes)}`:""}</small></div><div class="reminder-actions">${!r.completed?`<button type="button" data-complete-reminder="${r.id}" class="market-select">Done</button>`:""}<button type="button" data-delete-reminder="${r.id}" class="ghost">Delete</button></div></article>`).join("") : `<div class="empty">No farm tasks planned yet.</div>`;
    $("#view").innerHTML = `<div class="page-heading"><div><span class="eyebrow">Plan the season</span><h1>Crop calendar & reminders</h1><p class="lead">Set your own task dates for each field. Dates are reminders, not automatic agronomy prescriptions.</p></div><span class="grow-mark" aria-hidden="true">🗓️</span></div><div class="calendar-layout"><form id="reminder-form" class="card"><h2>Add a farm task</h2><label class="f"><span>Task</span><input name="title" required minlength="2" maxlength="100" placeholder="e.g. Check irrigation channel"></label><div class="row2"><label class="f"><span>Category</span><select name="category"><option>Sowing</option><option>Irrigation</option><option>Fertilizer</option><option>Pest check</option><option>Harvest</option><option>Other</option></select></label><label class="f"><span>Due date</span><input name="due_date" type="date" required value="${today}"></label></div><label class="f"><span>Field (optional)</span><select name="field_id"><option value="">All farm</option>${fields.map(f=>`<option value="${f.id}">${esc(f.name)} · ${esc(f.district)}</option>`).join("")}</select></label><label class="f"><span>Note (optional)</span><input name="notes" maxlength="500" placeholder="Add a short note"></label><div id="reminder-error" class="auth-error" role="status"></div><button type="submit">Save reminder</button><button id="enable-reminders" type="button" class="btn-secondary reminder-enable">Enable browser reminders</button><p class="note">Browser notifications appear when this app is open. Background push reminders are not enabled.</p></form><section class="card reminder-list"><div class="section-title"><div><span class="eyebrow">Your schedule</span><h2>Farm tasks</h2></div><span class="unit-badge">${reminders.filter(r=>!r.completed&&r.days_until<=0).length} due</span></div><div id="reminder-items">${taskList()}</div></section></div>`;
    const notifyDue=()=>{if(!("Notification" in window)||Notification.permission!=="granted")return;reminders.filter(r=>!r.completed&&r.days_until<=0).forEach(r=>{const key=`kisan-reminder-${r.id}-${r.due_date}`;if(localStorage.getItem(key))return;new Notification(`Farm reminder: ${r.title}`,{body:`${r.category}${r.field_name?` · ${r.field_name}`:""}${r.days_until<0?" · overdue":" · due today"}`});localStorage.setItem(key,"1");});};
    if("Notification" in window&&Notification.permission==="granted")notifyDue();
    $("#enable-reminders").onclick=async()=>{if(!("Notification" in window)){alert("Browser notifications are not supported here.");return;}const p=await Notification.requestPermission();if(p==="granted")notifyDue();else alert("Notification permission was not granted. Your reminders are still saved in this calendar.");};
    $("#reminder-form").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,data=Object.fromEntries(new FormData(form)),button=form.querySelector("button[type=submit]"),err=$("#reminder-error");button.disabled=true;err.textContent="";try{await api("/api/reminders",{method:"POST",body:JSON.stringify(data)});views.calendar();}catch(er){err.textContent=er.message;}finally{button.disabled=false;}});
    $("#reminder-items").onclick=async e=>{const complete=e.target.dataset?.completeReminder,remove=e.target.dataset?.deleteReminder;if(!complete&&!remove)return;try{if(complete)await api(`/api/reminders/${complete}`,{method:"PATCH",body:JSON.stringify({completed:true})});if(remove)await api(`/api/reminders/${remove}`,{method:"DELETE"});views.calendar();}catch(er){alert(er.message);}};
  },
  async health() {
    const [fields,cases]=await Promise.all([api("/api/fields"),api("/api/crop-health")]);
    $("#view").innerHTML = `<div class="page-heading"><div><span class="eyebrow">Crop health notes</span><h1>Photo & symptom guide</h1><p class="lead">Save a clear plant photo with symptoms to keep a case record and get cautious next-step guidance.</p></div><span class="grow-mark" aria-hidden="true">🌿</span></div><div class="notice-card"><b>Important:</b> This version does not run an image-recognition model. It uses the symptom you select to suggest possible causes; it cannot diagnose disease or prescribe pesticides. Ask your local KVK/agriculture officer to confirm.</div><div class="health-layout"><form id="health-form" class="card"><h2>New crop health note</h2><label class="f"><span>Crop</span><select name="crop">${OPTS.categories.Crop.map(x=>`<option>${esc(x)}</option>`).join("")}</select></label><label class="f"><span>Field (optional)</span><select name="field_id"><option value="">No linked field</option>${fields.map(f=>`<option value="${f.id}">${esc(f.name)} · ${esc(f.district)}</option>`).join("")}</select></label><label class="f"><span>Main symptom</span><select name="symptom"><option value="yellowing">Leaves turning yellow</option><option value="white-powder">White powder-like patches</option><option value="dark-spots">Dark or brown leaf spots</option><option value="holes">Holes or chewing marks</option><option value="wilting">Plant wilting</option><option value="curl-mosaic">Leaf curling or mosaic pattern</option><option value="other">Other / not sure</option></select></label><label class="f"><span>Plant photo (JPG, PNG, WebP; max 4 MB)</span><input id="health-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" required></label><div id="health-preview" class="health-preview" hidden></div><label class="f"><span>What changed? (optional)</span><textarea name="notes" maxlength="500" rows="3" placeholder="When it started, which leaves, recent rain or spray use"></textarea></label><div id="health-error" class="auth-error" role="status"></div><button type="submit">Save photo & get guidance</button></form><section class="card"><div class="section-title"><div><span class="eyebrow">Saved privately to your account</span><h2>Recent cases</h2></div></div><div class="health-case-list">${cases.length?cases.map(c=>`<article class="health-case"><img src="${API}${esc(c.photo_url)}" alt="Saved crop photo" loading="lazy"><div><span class="eyebrow">${esc(c.crop)}${c.field_name?` · ${esc(c.field_name)}`:""}</span><h3>${esc(c.possible_issue)}</h3><p>${esc(c.guidance)}</p><small>${new Date(c.created_at.replace(" ","T")).toLocaleString("en-IN")} · ${esc(c.symptom)}</small><button class="ghost" data-delete-case="${c.id}" type="button">Delete case</button></div></article>`).join(""):`<div class="empty">No crop health notes saved yet.</div>`}</div></section></div>`;
    const photoInput=$("#health-photo"), preview=$("#health-preview");
    const notesBox=$("#health-form [name=notes]"), voiceButton=document.createElement("button");
    voiceButton.type="button"; voiceButton.className="btn-secondary voice-input"; voiceButton.textContent="🎙 Add note by voice"; notesBox.closest("label").after(voiceButton);
    voiceButton.onclick=()=>{const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SpeechRecognition){$("#health-error").textContent="Voice input is not supported in this browser. You can type the note instead.";return;}const recognition=new SpeechRecognition();recognition.lang=APP_LANGUAGE==="hi"?"hi-IN":"en-IN";recognition.interimResults=false;recognition.onresult=event=>{notesBox.value+=(notesBox.value?" ":"")+event.results[0][0].transcript;};recognition.onerror=()=>{$("#health-error").textContent="Could not capture voice. Check microphone permission or type the note.";};recognition.start();};
    photoInput.addEventListener("change",()=>{const file=photoInput.files[0];if(!file){preview.hidden=true;return;}if(file.size>4*1024*1024){photoInput.value="";preview.hidden=true;$("#health-error").textContent="Photo must be 4 MB or smaller.";return;}preview.innerHTML=`<img src="${URL.createObjectURL(file)}" alt="Selected crop photo preview"><span>${esc(file.name)}</span>`;preview.hidden=false;});
    $("#health-form").addEventListener("submit",async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector("button"),err=$("#health-error");button.disabled=true;err.textContent="";try{const data=await api("/api/crop-health",{method:"POST",body:new FormData(form)});alert(`Saved. Possible issue: ${data.possible_issue}. This is symptom guidance only, not an image diagnosis.`);views.health();}catch(er){err.textContent=er.message;}finally{button.disabled=false;}});
    $("#view").onclick=async e=>{const id=e.target.dataset?.deleteCase;if(!id)return;try{await api(`/api/crop-health/${id}`,{method:"DELETE"});views.health();}catch(er){alert(er.message);}};
  },
  crops() {
    $("#view").innerHTML = layout("Which crop suits your conditions?", "We predict every crop for your inputs and rank them by how far above (or below) its usual yield it comes out.", formHTML(false, "Rank crops"));
    bindForm(d => {
      $("#out").innerHTML = `<div class="card result"><h2>Best matches</h2>
        <div class="scroll"><table><thead><tr><th>#</th><th>Crop</th><th>Predicted (t/ha)</th><th>vs usual</th></tr></thead><tbody>
        ${d.ranking.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.crop)}</b></td><td>${fmt(r.predicted_yield)}</td><td>${r.vs_median == null ? "–" : r.vs_median + "×"}</td></tr>`).join("")}</tbody></table></div>
        <p class="note">${esc(d.method)}. A value of 1.2× means 20% above that crop's median yield. This is a guide, not a guarantee.</p></div>`;
    }, b => api("/api/recommend-crops", { method: "POST", body: JSON.stringify(b) }));
  },
  async analytics() {
    $("#view").innerHTML = `<h1>Analytics</h1><p class="lead">Patterns in the training data, plus a summary of the predictions you have saved.</p><div id="out">Loading…</div>`;
    const a = await api("/api/analytics"), top = a.crop_comparison.slice(0, 12);
    const risk = a.risk_distribution.length ? bars(a.risk_distribution, "risk", "count") : `<p class="empty">Run a prediction to see your risk mix.</p>`;
    $("#out").innerHTML = `<div class="card"><h2>Average yield by crop (top 12)</h2>${bars(top, "crop", "avg_yield", " t/ha")}</div>
      <div class="card"><h2>Yield trend, most common crops</h2>${lines(a.yearly_trend)}</div>
      <div class="card"><h2>Yield by rainfall range</h2>${bars(a.rainfall_vs_yield, "range", "avg_yield", " t/ha", "wheat")}</div>
      <div class="card"><h2>Median fertilizer use by crop (kg/ha)</h2>${bars(a.fertilizer_by_crop.slice(0, 12), "crop", "median_kg_per_ha")}</div>
      <div class="card"><h2>Risk levels of your saved predictions</h2>${risk}<p class="note">${esc(a.source)}</p></div>`;
  },
  async market() {
    $("#view").innerHTML = `<section class="market-hero"><div><span class="market-kicker">AGMARKNET market intelligence</span><h1>Make your next sale with a clearer picture.</h1><p>Compare today's reported mandi prices, track the price history you collect, and estimate your gross selling range.</p></div><div class="market-hero-art" aria-hidden="true"><span>₹</span><i></i><i></i><i></i></div></section><form id="market-search" class="market-filters card"><div class="market-filter-title"><div><span class="eyebrow">Market finder</span><h2>Choose crop and area</h2></div><span class="market-live"><i></i> Daily reported prices</span></div><div class="market-filter-grid">${sel("crop", "Crop", MARKET_CROPS)}${sel("state", "State", OPTS.categories.State)}${field("district", "District (optional)", `<input name="district" placeholder="Filter within state">`)}</div><button type="submit">Find mandi prices <span>→</span></button><p class="note">Live reports currently cover Cotton, Groundnut, Maize, Potato, Rice, Soybean, Sugarcane and Wheat. Rates are reported in ₹ per quintal and may arrive after the market closes.</p></form><div id="market-out"><div class="card empty">Choose a crop and state to load reported mandi prices.</div></div>`;
    const cropSelect=$("#market-search [name=crop]"), stateSelect=$("#market-search [name=state]"), cropStatus=$("#market-search .note");
    const marketSubmit=$("#market-search button[type=submit]"); let cropLoadId=0;
    cropStatus.textContent="Loading crops reported by mandis in the selected state…";
    const loadMarketCrops=async()=>{
      const requestId=++cropLoadId, previous=cropSelect.value, state=stateSelect.value; cropSelect.disabled=true; marketSubmit.disabled=true;
      try{
        const data=await api(`/api/market-crops?state=${encodeURIComponent(state)}`), choices=data.commodities;
        if(requestId!==cropLoadId)return;
        if(choices.length){cropSelect.innerHTML=choices.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");cropSelect.value=choices.includes(previous)?previous:choices[0];cropStatus.textContent=`${choices.length} commodities reported for ${state}. Prices depend on the latest reports available.`+(data.stale?` Saved list from ${data.fetched_at}.`:"");}
        else cropStatus.textContent=`No crop reports are currently listed for ${state}. Try another state.`;
      }catch(er){if(requestId===cropLoadId)cropStatus.textContent=`Could not refresh the state crop list. Showing the common crop options. ${er.message}`;}
      finally{if(requestId===cropLoadId){cropSelect.disabled=false;marketSubmit.disabled=false;}}
    };
    stateSelect.addEventListener("change",loadMarketCrops); loadMarketCrops();
    $("#market-search").addEventListener("submit", async e => {
      e.preventDefault(); const form = e.currentTarget, body = Object.fromEntries(new FormData(form));
      const button = form.querySelector("button[type=submit]"); button.disabled = true; button.textContent = "Loading mandi reports…";
      $("#market-out").innerHTML = `<div class="card loading-state"><span class="weather-illustration">📈</span><b>Fetching reported prices…</b></div>`;
      try {
        const d = await api(`/api/market-prices?crop=${encodeURIComponent(body.crop)}&state=${encodeURIComponent(body.state)}&district=${encodeURIComponent(body.district || "")}`);
        if (!d.records.length) { $("#market-out").innerHTML = `<div class="card empty"><b>No report for this crop and state.</b><br>AGMARKNET may not have a current entry for this selection. Try another supported crop or state, or clear the district filter.</div>`; return; }
        const marketCount = new Set(d.records.map(r => r.market)).size;
        let selected = 0;
        const renderDetail = async () => {
          const market = d.records[selected];
          const historyUrl = `/api/market-history?crop=${encodeURIComponent(d.crop)}&state=${encodeURIComponent(d.state)}&market=${encodeURIComponent(market.market)}&district=${encodeURIComponent(market.district || "")}&variety=${encodeURIComponent(market.variety || "")}&grade=${encodeURIComponent(market.grade || "")}`;
          $("#price-detail").innerHTML = `<div class="card loading-state">Loading recorded price history…</div>`;
          try {
            const h = await api(historyUrl), points = h.prices;
            const quantity = Number($("#sale-quantity")?.value || 0);
            const sale = (p) => fmt(p * quantity, 0);
            $("#price-detail").innerHTML = `<div class="market-insight-grid"><section class="card price-history-card"><div class="section-title"><div><span class="eyebrow">${esc(market.market)}${market.district ? ` · ${esc(market.district)}` : ""}</span><h2>Reported modal price history</h2></div><span class="unit-badge">₹/quintal</span></div>${priceTrendSVG(points)}<p class="source-note">${points.length} report dates recorded here. ${esc(h.history_note)}</p></section><section class="card outlook-card"><span class="eyebrow">Market trend</span><h2>Short-term outlook</h2>${priceOutlook(points)}</section></div><section class="card sell-card"><div class="sell-heading"><div><span class="eyebrow">Selling price information</span><h2>Estimate your gross sale value</h2><p class="note">Use the market's min/modal/max range as a reference. Actual offers vary by quality, grade, moisture, fees and transport.</p></div><label class="quantity-field"><span>Your quantity</span><div><input id="sale-quantity" type="number" min="0" step="any" value="${quantity || 20}"><b>quintal</b></div></label></div><div class="sale-range"><div><span>Lower range</span><b id="sale-min">₹${sale(market.min_price)}</b><small>@ ₹${fmt(market.min_price,0)}/qtl</small></div><div class="sale-modal"><span>Modal reference</span><b id="sale-modal">₹${sale(market.modal_price)}</b><small>@ ₹${fmt(market.modal_price,0)}/qtl</small></div><div><span>Upper range</span><b id="sale-max">₹${sale(market.max_price)}</b><small>@ ₹${fmt(market.max_price,0)}/qtl</small></div></div><p class="source-note">Gross estimate only; charges, quality deductions and transport are not included.</p></section>`;
            $("#sale-quantity").addEventListener("input", ev => { const q = Number(ev.target.value || 0); $("#sale-min").textContent = `₹${fmt(market.min_price*q,0)}`; $("#sale-modal").textContent = `₹${fmt(market.modal_price*q,0)}`; $("#sale-max").textContent = `₹${fmt(market.max_price*q,0)}`; updateNetEstimate(); });
            const transportLabel=document.createElement("label");transportLabel.className="quantity-field";transportLabel.innerHTML=`<span>Transport cost per quintal</span><div><input id="transport-cost" type="number" min="0" step="any" value="0"><b>₹/qtl</b></div>`;$("#price-detail .sell-heading").append(transportLabel);
            const netCard=document.createElement("div");netCard.className="net-sale-estimate";netCard.innerHTML=`<span>Estimated sale after transport</span><b id="sale-net"></b><small>Transport is the only cost deducted. Other charges and quality deductions are not included.</small>`;$("#price-detail .sale-range").after(netCard);
            const updateNetEstimate=()=>{const q=Number($("#sale-quantity").value||0),cost=Number($("#transport-cost").value||0),low=Math.max(0,market.min_price-cost)*q,mid=Math.max(0,market.modal_price-cost)*q,high=Math.max(0,market.max_price-cost)*q;$("#sale-net").textContent=`₹${fmt(low,0)} – ₹${fmt(high,0)} (modal ₹${fmt(mid,0)})`;};
            $("#transport-cost").addEventListener("input",updateNetEstimate);updateNetEstimate();
          } catch (er) { $("#price-detail").innerHTML = `<div class="banner">${esc(er.message)}</div>`; }
        };
        const latest = d.latest_date ? new Date(`${d.latest_date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Not reported";
        $("#market-out").innerHTML = `<div class="market-summary"><div class="summary-chip"><span>Crop</span><b>${esc(d.crop)}</b></div><div class="summary-chip"><span>Mandis reporting</span><b>${fmt(marketCount,0)}</b></div><div class="summary-chip"><span>Latest report date</span><b>${esc(latest)}</b></div><div class="summary-chip"><span>Data source</span><b>AGMARKNET</b></div></div><section class="card mandi-card"><div class="section-title"><div><span class="eyebrow">${esc(d.state)}${d.district ? ` · ${esc(d.district)}` : ""}</span><h2>Compare mandi prices</h2></div><span class="unit-badge">₹ per quintal</span></div><div class="market-table-wrap"><table class="market-table"><thead><tr><th>Mandi</th><th>Variety / grade</th><th>Min</th><th>Modal</th><th>Max</th><th>Report date</th><th></th></tr></thead><tbody>${d.records.slice(0,100).map((r,i)=>`<tr class="${i===selected?"selected-market":""}"><td><b>${esc(r.market)}</b><small>${esc(r.district)}</small></td><td>${esc(r.variety || "—")}<small>${esc(r.grade || "")}</small></td><td>₹${fmt(r.min_price,0)}</td><td><strong>₹${fmt(r.modal_price,0)}</strong></td><td>₹${fmt(r.max_price,0)}</td><td>${new Date(`${r.arrival_date}T00:00:00`).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</td><td><button type="button" class="market-select" data-market="${i}">View</button></td></tr>`).join("")}</tbody></table></div>${d.records.length>100?`<p class="note">Showing first 100 of ${fmt(d.total_records,0)} variety reports, sorted by latest report date.</p>`:""}<p class="source-note">Reported prices are mandi-level wholesale references, not a guaranteed offer. Source: <a href="https://www.data.gov.in/resource/variety-wise-daily-market-prices-data-commodity" target="_blank" rel="noreferrer">Government of India OGD / AGMARKNET</a>.</p></section><div id="price-detail"></div>`;
        if (d.stale) $("#market-out").insertAdjacentHTML("afterbegin", `<div class="market-stale-note" role="status">Live prices could not be refreshed. Showing saved government reports from ${esc(d.cache_fetched_at)}; check each report date before using it.</div>`);
        $("#market-out").querySelectorAll("[data-market]").forEach(b => b.addEventListener("click", () => { selected = Number(b.dataset.market); $("#market-out").querySelectorAll(".market-table tbody tr").forEach((tr,i)=>tr.classList.toggle("selected-market",i===selected)); renderDetail(); }));
        await renderDetail();
      } catch (er) {
        const setup = er.details?.setup_url ? `<p class="note">data.gov.in par login karke apni API key generate karein. <a href="${esc(er.details.setup_url)}" target="_blank" rel="noreferrer">API key help</a>; key milne ke baad yahan ek baar paste karein.</p><form id="market-key-form" class="market-key-form"><label><span>data.gov.in API key</span><input type="password" name="api_key" required minlength="20" autocomplete="off" placeholder="Paste your API key"></label><button type="submit">Connect market data</button><small id="market-key-status" role="status">Key is saved only on this computer in the ignored backend/.env file; it is not kept in browser storage.</small></form>` : "";
        $("#market-out").innerHTML = `<div class="market-error"><span>!</span><div><h2>Market prices could not load</h2><p>${esc(er.message)}</p>${setup}<p class="source-note">This app does not show sample prices as live mandi data.</p></div></div>`;
        const keyForm = $("#market-key-form");
        if (keyForm) keyForm.addEventListener("submit", async ev => {
          ev.preventDefault(); const keyButton = keyForm.querySelector("button"), keyStatus = $("#market-key-status");
          keyButton.disabled = true; keyButton.textContent = "Checking key…"; keyStatus.textContent = "Validating with data.gov.in…";
          try {
            await api("/api/market-key", { method: "POST", body: JSON.stringify({ api_key: new FormData(keyForm).get("api_key") }) });
            keyForm.reset(); keyStatus.textContent = "Connected. Loading mandi prices…";
            $("#market-search").requestSubmit();
          } catch (keyError) { keyStatus.textContent = keyError.message; }
          finally { keyButton.disabled = false; keyButton.textContent = "Connect market data"; }
        });
      } finally { button.disabled = false; button.innerHTML = `Find mandi prices <span>→</span>`; }
    });
  },
  soil() {
    const nutrients = [
      { key: "n", title: "Nitrogen (N)", symbol: "N", unit: "kg/ha" },
      { key: "p", title: "Phosphate (P₂O₅)", symbol: "P", unit: "kg/ha" },
      { key: "k", title: "Potash (K₂O)", symbol: "K", unit: "kg/ha" }
    ];
    const bandOptions = ["Low", "Medium", "High", "Very High"];
    const nutrientCards = nutrients.map(n => `<article class="soil-nutrient"><div class="nutrient-head"><span>${n.symbol}</span><b>${n.title}</b></div><label class="f" data-f="${n.key}_status"><span>Soil test category</span><select name="${n.key}_status" required><option value="">Choose from report</option>${bandOptions.map(x => `<option>${x}</option>`).join("")}</select><small class="err"></small></label><label class="f" data-f="${n.key}_value"><span>Measured test value (optional)</span><input name="${n.key}_value" type="number" step="any" placeholder="Use report units"><small class="err"></small></label><label class="f" data-f="${n.key}_rdf"><span>Local base RDF (${n.unit})</span><input name="${n.key}_rdf" type="number" min="0" max="1000" step="any" required placeholder="From crop guidance"><small class="err"></small></label></article>`).join("");
    const micros = [{ key: "s", label: "Sulphur (S)" }, { key: "zn", label: "Zinc (Zn)" }, { key: "fe", label: "Iron (Fe)" }, { key: "cu", label: "Copper (Cu)" }, { key: "mn", label: "Manganese (Mn)" }, { key: "b", label: "Boron (B)" }].map(n => `<label class="f" data-f="${n.key}_status"><span>${n.label} category (optional)</span><select name="${n.key}_status"><option value="">Not in report</option>${bandOptions.map(x => `<option>${x}</option>`).join("")}</select><small class="err"></small></label>`).join("");
    $("#view").innerHTML = `<div class="page-heading"><div><span class="eyebrow">Soil health</span><h1>Soil test & fertilizer planner</h1><p class="lead">Use categories from your Soil Health Card and a local crop dose to make a clear NPK plan.</p></div><span class="grow-mark" aria-hidden="true">🌱</span></div>
      <div class="notice-card"><b>Use your local soil report.</b> Nutrient bands depend on the lab's test method. Enter the crop's base recommended dose (RDF) from your state agriculture guidance; this tool adjusts it by the report category.</div>
      <form id="soil-form"><div class="soil-meta card"><div class="soil-loc-grid">${sel("crop", "Crop", OPTS.categories.Crop)}${sel("state", "State", OPTS.categories.State)}${field("ph", "Soil pH (optional)", `<input name="ph" type="number" min="3" max="10" step="any" placeholder="As printed on report">`)}${field("organic_carbon", "Organic carbon % (optional)", `<input name="organic_carbon" type="number" min="0" max="100" step="any" placeholder="As printed on report">`)}${field("ec", "EC dS/m (optional)", `<input name="ec" type="number" min="0" step="any" placeholder="As printed on report">`)}</div></div>
      <div class="soil-grid">${nutrientCards}</div><div class="card micronutrients"><h2>Secondary and micro-nutrients</h2><p class="note">Record report bands for deficiency context. Dose for these nutrients should follow the lab/state recommendation.</p><div class="row2">${micros}</div></div>
      <button type="submit">Calculate soil-based plan</button></form><div id="soil-out" aria-live="polite"></div>`;
    $("#soil-form").addEventListener("submit", async e => {
      e.preventDefault();
      document.querySelectorAll("#soil-form .has-err").forEach(x => { x.classList.remove("has-err"); x.querySelector(".err").textContent = ""; });
      const button = e.currentTarget.querySelector("button[type=submit]"); button.disabled = true; button.textContent = "Preparing plan…";
      try {
        const d = await api("/api/soil-advice", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });
        const changeText = p => p > 0 ? `+${p}% from base` : p < 0 ? `${p}% from base` : "No dose for very high band";
        $("#soil-out").innerHTML = `<section class="card result soil-results"><div class="result-title"><div><span class="eyebrow">Plan for ${esc(d.crop)} · ${esc(d.state)}</span><h2>Adjusted nutrient targets</h2></div><span class="grow-mark" aria-hidden="true">🌿</span></div><div class="cards3">${d.recommendations.map(r => `<article class="dose-card"><span class="pill ${r.status === "Low" ? "High" : r.status === "Very High" ? "Moderate" : "Low"}">${esc(r.status)}</span><h3>${esc(r.label)}</h3><strong>${fmt(r.recommended)} <small>kg nutrient/ha</small></strong><p>Base: ${fmt(r.base_rdf)} kg/ha · ${esc(changeText(r.change_percent))}${r.test_value === undefined ? "" : `<br>Lab value: ${fmt(r.test_value)} (report units)`}</p></article>`).join("")}</div><h3 class="subhead">Other reported nutrients</h3><div class="micro-list">${d.micronutrients.map(m => `<span><b>${esc(m.label)}</b><i class="band ${m.status === "Low" ? "band-low" : m.status === "Very High" ? "band-vhigh" : ""}">${esc(m.status)}</i></span>`).join("")}</div><p class="note">Soil card values: pH ${esc(d.ph || "—")} · Organic carbon ${esc(d.organic_carbon || "—")}% · EC ${esc(d.ec || "—")} dS/m.</p><p class="note">${esc(d.basis)} If your Soil Health Card already gives a final crop-specific dose, follow that final dose instead of adjusting it again.</p><p class="source-note">Band method: <a href="https://soilhealth.dac.gov.in/files/Manual/14072023Manual_Class_9_10.pdf" target="_blank" rel="noreferrer">Government of India Soil Sampling & Testing Manual</a>. A local agronomist/KVK can confirm the crop-specific product and timing.</p></section>`;
      } catch (er) {
        if (er.details) for (const [k, message] of Object.entries(er.details)) { const f = e.currentTarget.querySelector(`[data-f="${k}"]`); if (f) { f.classList.add("has-err"); f.querySelector(".err").textContent = message; } }
        $("#soil-out").innerHTML = `<div class="banner">${esc(er.message)}</div>`;
      } finally { button.disabled = false; button.textContent = "Calculate soil-based plan"; }
    });
  },
  async weather() {
    const savedFields = await api("/api/fields");
    let last = null; try { last = JSON.parse(localStorage.getItem("kisanWeatherLocation") || "null"); } catch { last = null; }
    $("#view").innerHTML = `<div class="page-heading"><div><span class="eyebrow">Local forecast</span><h1>Weather for your farm</h1><p class="lead">Check current conditions and the next 7 days before planning fieldwork.</p></div><span class="weather-illustration" aria-hidden="true">☀️</span></div><form id="weather-search" class="weather-search"><label class="f"><span>Town, village or district</span><input name="q" required minlength="2" placeholder="e.g. Kalaburagi" value="${esc(last?.name || "")}"></label><button type="submit">Find location</button><button type="button" class="btn btn-light" id="weather-location">Use my location</button>${savedFields.length?`<label class="f saved-weather-field"><span>Saved field</span><select id="weather-field"><option value="">Choose a field</option>${savedFields.map(f=>`<option value="${f.id}">${esc(f.name)} · ${esc(f.district)}</option>`).join("")}</select></label><button type="button" id="weather-field-forecast">Use field location</button>`:""}</form><div id="weather-out"><div class="card empty">Search for your nearest town, or use your device location to load a forecast.</div></div>`;
    const out = $("#weather-out");
    async function loadWeather(loc) {
      localStorage.setItem("kisanWeatherLocation", JSON.stringify(loc));
      out.innerHTML = `<div class="card loading-state"><span class="weather-illustration">🌦️</span><b>Loading forecast for ${esc(loc.name)}…</b></div>`;
      try {
        const d = await api(`/api/weather?latitude=${encodeURIComponent(loc.latitude)}&longitude=${encodeURIComponent(loc.longitude)}`);
        const c = d.current, daily = d.daily, codeText = weatherDescription(c.weather_code);
        const rain = daily.precipitation_sum?.[0] ?? 0, rainChance = daily.precipitation_probability_max?.[0] ?? 0;
        const alerts = [];
        daily.time.forEach((date, i) => {
          const mm = daily.precipitation_sum[i] || 0, chance = daily.precipitation_probability_max[i] || 0, maxTemp = daily.temperature_2m_max[i], wind = daily.wind_speed_10m_max[i];
          const day = new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
          if (mm >= 30 || chance >= 80) alerts.push(`${day}: heavy rain possible (${fmt(mm, 1)} mm; ${fmt(chance, 0)}% chance). Check drainage and avoid applying fertilizer just before rain.`);
          if (maxTemp >= 40) alerts.push(`${day}: high heat forecast (${fmt(maxTemp, 0)}°C). Avoid heat-sensitive fieldwork at midday.`);
          if (wind >= 40) alerts.push(`${day}: strong wind forecast (${fmt(wind, 0)} km/h). Avoid spraying during windy periods.`);
        });
        const next3Wet = daily.precipitation_sum.slice(0, 3).some(x => x >= 20);
        const next3Hot = daily.temperature_2m_max.slice(0, 3).some(x => x >= 38);
        const sowing = next3Wet ? "Wet conditions may make seedbed preparation difficult. Check field drainage and wait for workable soil." : next3Hot ? "Hot conditions are forecast. Check crop-specific sowing advice and plan fieldwork during cooler hours." : "No major heat or heavy-rain signal in the next few days. Confirm crop-specific dates and soil moisture locally before sowing.";
        const weatherStamp = d._app?.stale ? `Cached forecast · last updated ${d._app.fetched_at}` : `Updated ${c.time.replace("T", " ")}`;
        out.innerHTML = `<div class="weather-location-label">📍 ${esc(loc.name)}${loc.admin1 ? `, ${esc(loc.admin1)}` : ""} <span>· ${esc(weatherStamp)}</span></div><div class="weather-current"><div class="current-main"><span class="weather-illustration">${weatherIcon(c.weather_code)}</span><div><b>${fmt(c.temperature_2m, 0)}°C</b><span>${esc(codeText)}</span></div></div><div class="weather-stat"><span>Humidity</span><b>${fmt(c.relative_humidity_2m, 0)}%</b></div><div class="weather-stat"><span>Wind</span><b>${fmt(c.wind_speed_10m, 0)} km/h</b></div><div class="weather-stat"><span>Rain today</span><b>${fmt(rain, 1)} mm</b><small>${fmt(rainChance, 0)}% chance</small></div></div><div class="weather-week">${daily.time.map((date, i) => `<article class="forecast-day"><span>${new Date(`${date}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short" })}</span><i>${weatherIcon(daily.weather_code[i])}</i><b>${fmt(daily.temperature_2m_max[i], 0)}°</b><small>${fmt(daily.temperature_2m_min[i], 0)}° · ${fmt(daily.precipitation_sum[i], 1)} mm</small><small>Rain chance ${fmt(daily.precipitation_probability_max[i] || 0, 0)}%</small></article>`).join("")}</div><div class="weather-panels"><section class="card"><h2>Weather alerts</h2><p class="note">Forecast-based heads-up, not an official government warning.</p>${alerts.length ? alerts.map(a => `<div class="rec warning"><b>Plan ahead</b><span>${esc(a)}</span></div>`).join("") : `<div class="rec success"><b>No major weather alert in this 7-day forecast</b><span>Keep checking local advisories for fast-changing conditions.</span></div>`}</section><section class="card sowing-card"><span class="eyebrow">Sowing conditions</span><h2>${next3Wet || next3Hot ? "Pause and check conditions" : "Weather looks broadly workable"}</h2><p>${esc(sowing)}</p><small>General weather screen only. Crop, variety, soil moisture and district advisories determine the actual sowing window.</small></section></div><p class="source-note">Forecast by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>. Forecast quality and local conditions can vary.</p>`;
      } catch (er) { out.innerHTML = `<div class="banner">${esc(er.message)}. Check your internet connection and try again.</div>`; }
    }
    $("#weather-search").addEventListener("submit", async e => {
      e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); out.innerHTML = `<div class="card loading-state">Searching locations…</div>`;
      try {
        const results = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
        if (!results.length) { out.innerHTML = `<div class="banner">No Indian town or district found. Try a nearby larger town.</div>`; return; }
        if (results.length === 1) { loadWeather(results[0]); return; }
        out.innerHTML = `<div class="card"><h2>Select your closest location</h2><div class="location-list">${results.map((r, i) => `<button type="button" class="location-choice" data-place="${i}">${esc(r.name)}${r.admin1 ? `, ${esc(r.admin1)}` : ""}<span>Show forecast →</span></button>`).join("")}</div></div>`;
        out.querySelectorAll("[data-place]").forEach(b => b.onclick = () => loadWeather(results[Number(b.dataset.place)]));
      } catch (er) { out.innerHTML = `<div class="banner">${esc(er.message)}. Check your internet connection and try again.</div>`; }
    });
    $("#weather-location").addEventListener("click", () => {
      if (!navigator.geolocation) { out.innerHTML = `<div class="banner">Location is not available in this browser. Search for your nearest town instead.</div>`; return; }
      out.innerHTML = `<div class="card loading-state">Finding your location…</div>`;
      navigator.geolocation.getCurrentPosition(async pos => {
        const loc = { name: "Your location", latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        loadWeather(loc);
      }, () => { out.innerHTML = `<div class="banner">Location permission was unavailable. Search for your nearest town instead.</div>`; }, { timeout: 10000 });
    });
    $("#weather-field-forecast")?.addEventListener("click", async()=>{
      const chosen=savedFields.find(f=>String(f.id)===$("#weather-field").value); if(!chosen){out.innerHTML=`<div class="banner">Choose a saved field first.</div>`;return;}
      out.innerHTML=`<div class="card loading-state">Finding forecast location for ${esc(chosen.district)}…</div>`;
      try{const matches=await api(`/api/geocode?q=${encodeURIComponent(`${chosen.district} ${chosen.state}`)}`);if(!matches.length){out.innerHTML=`<div class="banner">Could not find ${esc(chosen.district)} for the weather forecast. Search for a nearby town instead.</div>`;return;}const match=matches.find(m=>m.name.toLowerCase()===chosen.district.toLowerCase())||matches[0];loadWeather({...match,name:chosen.name,admin1:`${chosen.district}, ${chosen.state}`});}
      catch(er){out.innerHTML=`<div class="banner">${esc(er.message)}</div>`;}
    });
    if (last) loadWeather(last);
  },
  async history() {
    $("#view").innerHTML = `<div class="top"><div><h1>Prediction history</h1><p class="lead" style="margin:.4rem 0 0">Your saved predictions for this farmer account.</p></div><a class="btn" href="${API}/api/history/export" download>Download CSV</a></div><div id="out" role="status"><div class="card loading-state">Loading your saved predictions…</div></div>`;
    let rows;
    try { rows = await api("/api/history"); }
    catch (er) {
      $("#out").innerHTML = `<div class="card history-error"><b>History could not load</b><p>${esc(er.message || "Check your connection and try again.")}</p><button type="button" data-history-retry>Try again</button></div>`;
      $("#out").onclick = e => { if (e.target.closest("[data-history-retry]")) views.history(); };
      return;
    }
    $("#out").innerHTML = rows.length ? `<div class="card scroll"><table><thead><tr><th>Date</th><th>Crop</th><th>Season</th><th>State</th><th>Area (ha)</th><th>Yield (t/ha)</th><th>Production (t)</th><th>Risk</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.created_at.replace("T", " "))}</td><td>${esc(r.crop)}</td><td>${esc(r.season)}</td><td>${esc(r.state)}</td><td>${fmt(r.area_ha)}</td><td>${fmt(r.yield_t_ha)}</td><td>${fmt(r.production_t)}</td><td><span class="pill ${esc(r.risk)}">${esc(r.risk)}</span></td><td><button class="ghost" data-del="${r.id}" aria-label="Delete prediction ${r.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="card empty">No saved predictions yet. Go to <a href="#predict">Predict yield</a> to create one.</div>`;
    $("#out").onclick = async e => {
      const id = e.target.closest("[data-del]")?.dataset.del; if (!id || !confirm("Delete this prediction?")) return;
      try { await api("/api/history/" + id, { method: "DELETE" }); views.history(); } catch (er) { alert(er.message); }
    };
  },
  model() {
    const m = OPTS.metrics, r = OPTS.data_report;
    $("#view").innerHTML = `<h1>About the model</h1><p class="lead">How the predictions are made and how well they performed on data the model had not seen.</p>
      <div class="cards3"><div class="card stat"><b>${fmt(m.R2, 3)}</b><span>R² score (1.0 is perfect)</span></div><div class="card stat"><b>${fmt(m.MAE, 3)}</b><span>Average error, tonnes/ha</span></div><div class="card stat"><b>${fmt(m.RMSE, 3)}</b><span>RMSE, tonnes/ha</span></div><div class="card stat"><b>${fmt(r.rows_clean, 0)}</b><span>Clean rows used (of ${fmt(r.rows_raw, 0)})</span></div></div>
      <div class="card"><h2>Details</h2><p>Model: <b>${esc(OPTS.model)}</b>. Dataset: <b>${esc(OPTS.dataset)}</b>. Trained on ${fmt(m.train_rows, 0)} rows, tested on ${fmt(m.test_rows, 0)}.
      Removed during cleaning: ${fmt(r.duplicate_rows, 0)} duplicate rows; ${fmt(r.missing_values, 0)} missing values found.</p>
      <p class="note">The model uses crop, season, state, year, area, rainfall, fertilizer and pesticide. Soil pH only affects the written advice.</p></div>
      <div class="card"><h2>Feature importance</h2>${bars(Object.entries(OPTS.feature_importance).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ n: nice(k), v: +(v * 100).toFixed(1) })), "n", "v", "%")}</div>`;
  }
};
const NAV = [["dashboard", "Dashboard", "⌂"], ["fields", "My fields", "▦"], ["calendar", "Crop calendar", "▤"], ["predict", "Predict yield", "↗"], ["market", "Market prices", "₹"], ["soil", "Soil & fertilizer", "◉"], ["weather", "Weather & sowing", "☼"], ["health", "Crop health", "✚"], ["crops", "Best crops", "✳"], ["analytics", "Analytics", "▥"], ["history", "History", "◷"], ["model", "About the model", "ⓘ"]];

/* ---------- boot ---------- */
let FARMER = null, AUTH_READY = false;
let APP_LANGUAGE = localStorage.getItem("kisanLanguage") === "hi" ? "hi" : "en";
const HINDI_TEXT = {
  "Dashboard":"डैशबोर्ड", "My fields":"मेरे खेत", "Crop calendar":"फसल कैलेंडर", "Predict yield":"उपज अनुमान",
  "Market prices":"मंडी भाव", "Soil & fertilizer":"मिट्टी और खाद", "Weather & sowing":"मौसम और बुवाई",
  "Crop health":"फसल स्वास्थ्य", "Best crops":"बेहतर फसलें", "Analytics":"विश्लेषण", "History":"इतिहास",
  "About the model":"मॉडल के बारे में", "Fields & plots":"खेत और प्लॉट", "Add a field":"खेत जोड़ें",
  "Field name":"खेत का नाम", "State":"राज्य", "District":"ज़िला", "District (optional)":"ज़िला (वैकल्पिक)",
  "Village (optional)":"गाँव (वैकल्पिक)", "Area":"क्षेत्रफल", "Unit":"इकाई", "Hectare":"हेक्टेयर", "Acre":"एकड़",
  "Soil type (optional)":"मिट्टी का प्रकार (वैकल्पिक)", "Soil pH (optional)":"मिट्टी का pH (वैकल्पिक)",
  "Save field":"खेत सेव करें", "No fields yet. Add your first plot to link reminders and crop notes.":"अभी कोई खेत नहीं है। रिमाइंडर और फसल नोट जोड़ने के लिए पहले खेत जोड़ें।",
  "Crop calendar & reminders":"फसल कैलेंडर और रिमाइंडर", "Add a farm task":"खेत का काम जोड़ें", "Task":"काम",
  "Category":"श्रेणी", "Due date":"तारीख", "Field (optional)":"खेत (वैकल्पिक)", "All farm":"सभी खेत",
  "Note (optional)":"नोट (वैकल्पिक)", "Save reminder":"रिमाइंडर सेव करें", "Enable browser reminders":"ब्राउज़र रिमाइंडर चालू करें",
  "Your schedule":"आपका कैलेंडर", "Farm tasks":"खेत के काम", "No farm tasks planned yet.":"अभी कोई काम तय नहीं है।",
  "Crop health notes":"फसल स्वास्थ्य नोट", "Photo & symptom guide":"फोटो और लक्षण मार्गदर्शिका", "New crop health note":"फसल स्वास्थ्य नोट जोड़ें",
  "Crop":"फसल", "Main symptom":"मुख्य लक्षण", "Plant photo (JPG, PNG, WebP; max 4 MB)":"पौधे की फोटो (JPG, PNG, WebP; अधिकतम 4 MB)",
  "What changed? (optional)":"क्या बदलाव दिखा? (वैकल्पिक)", "Save photo & get guidance":"फोटो सेव करें और सलाह देखें",
  "Recent cases":"हाल के नोट", "Saved privately to your account":"आपके खाते में सुरक्षित सेव", "No crop health notes saved yet.":"अभी कोई फसल स्वास्थ्य नोट सेव नहीं है।",
  "Full name":"पूरा नाम", "Mobile number":"मोबाइल नंबर", "Password":"पासवर्ड", "Confirm password":"पासवर्ड दोबारा लिखें",
  "Create account":"खाता बनाएँ", "Login securely":"सुरक्षित लॉगिन", "Farmer login":"किसान लॉगिन",
  "Create farmer account":"किसान खाता बनाएँ", "Already have an account?":"पहले से खाता है?", "Login":"लॉगिन",
  "Welcome back to your farm.":"आपका फिर से स्वागत है।", "Create your farmer account.":"अपना किसान खाता बनाएँ।",
  "Choose crop and area":"फसल और क्षेत्र चुनें", "Find mandi prices":"मंडी भाव खोजें", "Compare mandi prices":"मंडी भाव की तुलना करें",
  "Compare reported prices":"बताए गए भाव की तुलना करें", "Weather for your farm":"आपके खेत का मौसम", "Local forecast":"स्थानीय मौसम अनुमान",
  "Search for your nearest town, or use your device location to load a forecast.":"अपने पास का शहर खोजें या मौसम जानने के लिए डिवाइस की लोकेशन इस्तेमाल करें।"
};
function translateNodeTree(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes=[];
  while(walker.nextNode()) nodes.push(walker.currentNode);
  for(const node of nodes){
    if(node.__sourceText===undefined) node.__sourceText=node.nodeValue;
    const source=node.__sourceText, trimmed=source.trim(); if(!trimmed)continue;
    const translated=APP_LANGUAGE==="hi"?(HINDI_TEXT[trimmed]||trimmed):trimmed;
    node.nodeValue=source.replace(trimmed,translated);
  }
  document.documentElement.lang=APP_LANGUAGE==="hi"?"hi":"en";
  const languageButton=$("#language-toggle"); if(languageButton)languageButton.textContent=APP_LANGUAGE==="hi"?"English":"हिंदी";
}
const languageObserver=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===Node.ELEMENT_NODE)translateNodeTree(node);else if(node.nodeType===Node.TEXT_NODE)translateNodeTree(node.parentNode);})));
languageObserver.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener("DOMContentLoaded",()=>translateNodeTree(document.body));
let installPrompt = null;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  const button = $("#install-app");
  if (button) button.hidden = false;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  const button = $("#install-app");
  if (button) button.hidden = true;
});
const currentFarmer = () => FARMER;
function publicHeader() {
  $("#public-header").innerHTML = `<a class="public-brand" href="#home"><span class="seed">✳</span> Kisan Saathi</a><nav class="public-links"><a href="#home">Home</a><a href="#features">Tools</a><a class="btn" href="#login">Farmer login</a></nav>`;
}
function showPublic(page) {
  document.body.classList.add("public-mode");
  $("#app-side").hidden = true;
  $("#public-header").hidden = false;
  publicHeader();
  if (page === "register" || page === "login") {
    const registering = page === "register";
    $("#view").innerHTML = `<section class="auth-wrap"><div class="auth-intro"><span class="eyebrow">Your farm, made smarter</span><h1>${registering ? "Create your farmer account." : "Welcome back to your farm."}</h1><p>${registering ? "Save your farm workspace securely and access it again when you return." : "Log in with the mobile number and password used to create your account."}</p></div><div class="auth-card"><h2>${registering ? "Create farmer account" : "Farmer login"}</h2><p class="lead">${registering ? "Your account is stored on this server." : "Enter your account details to continue."}</p><form id="auth-form">${registering ? `<label class="f"><span>Full name</span><input name="name" required minlength="2" maxlength="70" autocomplete="name" placeholder="e.g. Raj Patil"></label>` : ""}<label class="f"><span>Mobile number</span><input name="mobile" required inputmode="tel" maxlength="18" autocomplete="tel" placeholder="10-digit mobile number"></label><label class="f"><span>Password</span><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="${registering ? "new-password" : "current-password"}" placeholder="At least 8 characters"></label>${registering ? `<label class="f"><span>Confirm password</span><input name="password_confirm" type="password" required minlength="8" maxlength="128" autocomplete="new-password" placeholder="Enter password again"></label>` : ""}<button type="submit">${registering ? "Create account" : "Login securely"}</button><div id="auth-error" class="auth-error" role="status"></div></form><div class="auth-toggle">${registering ? `Already have an account? <a href="#login">Login</a>` : `New to Kisan Saathi? <a href="#register">Create account</a>`}</div><p class="auth-note">Passwords are stored as one-way hashes. Phone OTP verification is not enabled.</p></div></section>`;
    $("#auth-form").addEventListener("submit", async e => {
      e.preventDefault();
      const form = e.currentTarget, button = form.querySelector("button"), err = $("#auth-error");
      const formData = Object.fromEntries(new FormData(form));
      button.disabled = true; err.textContent = "";
      if (registering && formData.password !== formData.password_confirm) {
        err.textContent = "The passwords do not match."; button.disabled = false; return;
      }
      delete formData.password_confirm;
      try {
        FARMER = await api(registering ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify(formData) });
        AUTH_READY = true;
        if (registering) {
          $("#view").innerHTML = `<section class="auth-wrap"><div class="auth-intro"><span class="eyebrow">Account created</span><h1>Your farm workspace is ready.</h1><p>Use your mobile number and password to access it again.</p></div><div class="auth-card"><h2>Welcome, ${esc(FARMER.name)}!</h2><p>Your Farmer ID:</p><div class="farmer-id">${esc(FARMER.id)}</div><button id="continue-dashboard">Open my dashboard</button></div></section>`;
          $("#continue-dashboard").addEventListener("click", () => { location.hash = "dashboard"; });
        } else location.hash = "dashboard";
      } catch (failure) { err.textContent = failure.message || "Could not sign in. Please try again."; }
      finally { button.disabled = false; }
    });
    return;
  }
  $("#view").innerHTML = `<section class="landing"><div class="landing-copy"><span class="eyebrow">Practical tools for Indian farmers</span><h1>Grow smarter.<br><span>Harvest better.</span></h1><p>Plan your next crop with yield predictions, farm insights and simple recommendations made for your fields.</p><div class="landing-actions"><a class="btn" href="#register">Create your Farmer ID&nbsp; →</a><a class="btn btn-light" href="#login">I already have an ID</a></div><div class="landing-proof"><span><b>01</b> Predict crop yield</span><span><b>02</b> Compare crop options</span><span><b>03</b> Track your farm history</span></div>${cropSphereHTML()}</section><section class="landing-bottom" id="features"><span class="eyebrow">One simple farm workspace</span><h2>Tools to help you plan with confidence</h2><div class="feature-grid"><article class="feature"><b>Yield forecast</b><p>Estimate crop yield from your farm conditions and review risk insights.</p></article><article class="feature"><b>Crop comparison</b><p>Compare crop options for your season, state and farm inputs.</p></article><article class="feature"><b>Farm dashboard</b><p>Keep your predictions, analytics and saved history in one place.</p></article></div></section>`;
  bindCropSphere($("#view"));
  if (location.hash === "#features") requestAnimationFrame(() => $("#features")?.scrollIntoView({ behavior: "smooth" }));
}
async function route() {
  if (!AUTH_READY) {
    try { FARMER = await api("/api/auth/me"); } catch { FARMER = null; }
    AUTH_READY = true;
  }
  const farmer = currentFarmer();
  const requested = location.hash.slice(1);
  if (!farmer) {
    showPublic(["login", "register"].includes(requested) ? requested : "home");
    return;
  }
  if (requested === "logout") {
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
    FARMER = null; AUTH_READY = true; location.hash = "home"; return;
  }
  document.body.classList.remove("public-mode");
  $("#app-side").hidden = false;
  $("#public-header").hidden = true;
  $("#account").innerHTML = `<span class="farmer-name">${esc(farmer.name)}</span><span>${esc(farmer.id)}</span><div class="account-tools"><button id="language-toggle" type="button">${APP_LANGUAGE==="hi"?"English":"हिंदी"}</button><button id="speak-page" type="button" aria-label="Read this page aloud">🔊</button></div><button id="install-app" ${installPrompt ? "" : "hidden"}>Install app</button> <button id="logout">Log out</button>`;
  $("#language-toggle").onclick=()=>{APP_LANGUAGE=APP_LANGUAGE==="hi"?"en":"hi";localStorage.setItem("kisanLanguage",APP_LANGUAGE);translateNodeTree(document.body);};
  $("#speak-page").onclick=()=>{if(!("speechSynthesis" in window)){alert("Text-to-speech is not supported in this browser.");return;}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance($("#view").innerText);utterance.lang=APP_LANGUAGE==="hi"?"hi-IN":"en-IN";speechSynthesis.speak(utterance);};
  $("#install-app").onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("#install-app").hidden = true;
  };
  $("#logout").onclick = async () => {
    try { await api("/api/auth/logout", { method: "POST" }); } catch {}
    FARMER = null; AUTH_READY = true; location.hash = "home"; route();
  };
  const k = NAV.some(n => n[0] === location.hash.slice(1)) ? location.hash.slice(1) : "dashboard";
  $("#nav").innerHTML = NAV.map(([id, t, icon]) => `<a href="#${id}" ${id === k ? 'aria-current="page"' : ""}><span class="nav-icon" aria-hidden="true">${icon}</span><span>${t}</span></a>`).join("");
  if (!OPTS) { try { OPTS = await api("/api/options"); } catch (er) { return fatal(er); } }
  try { await views[k](); } catch (er) { fatal(er); }
  $("#view").classList.remove("view-enter");
  void $("#view").offsetWidth;
  $("#view").classList.add("view-enter");
  window.scrollTo(0, 0);
}
function fatal(er) {
  $("#status").innerHTML = `<span class="dot off"></span>Backend offline`;
  $("#view").innerHTML = `<h1>Can't load the data</h1><div class="banner" style="margin-top:1rem"><b>${esc(er.message)}</b><br>
    ${er.offline ? `Start the backend in another terminal: <code>cd backend</code> then <code>python app.py</code>, then refresh this page.`
      : `If the model is not trained yet, run <code>python train_model.py</code> inside the <code>backend</code> folder, restart the server, and refresh.`}</div>`;
}
window.addEventListener("hashchange", route);
api("/api/health").then(() => { $("#status").innerHTML = `<span class="dot on"></span>Backend connected`; }).catch(() => {});
route();
