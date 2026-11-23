// Moderation page: asks for INTAKE_TOKEN once (sessionStorage), lists the queue, Approve / Reject.
(function () {
  "use strict";
  var KEY = "matchamap-intake-token";
  var gate = document.getElementById("gate"), queue = document.getElementById("queue"), msg = document.getElementById("msg");
  function getToken() { try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return window.__tok || ""; } }
  function setToken(t) { try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch (e) { window.__tok = t; } }
  function api(path, opts) {
    opts = opts || {}; opts.headers = Object.assign({ authorization: "Bearer " + getToken(), "content-type": "application/json" }, opts.headers || {});
    return fetch(path, opts).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ("Error " + r.status)); return j; }); });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function line(box, label, v) { if (v && String(v).length) box.appendChild(el("p", "", label + ": " + (Array.isArray(v) ? v.join(", ") : v))); }

  function card(item, pending) {
    var f = item.fields || {}, box = el("div", "rv-item");
    box.appendChild(el("h3", "", (f.brand || "(no brand)") + (f.handle ? "  @" + f.handle : "")));
    box.appendChild(el("p", "rv-meta", "id " + item.id + " - sent " + (item.at || "").slice(0, 16).replace("T", " ")));
    line(box, "When", [f.date, f.start && (f.start + (f.end ? "-" + f.end : ""))].filter(Boolean).join(" "));
    line(box, "Where", [f.venue, f.address, [f.city, f.state].filter(Boolean).join(", ")].filter(Boolean).join(" | "));
    line(box, "Menu", f.drinks); line(box, "Price", f.price); line(box, "Notes", f.notes); line(box, "Email", f.email);
    if (f.url) { var p = el("p"), a = el("a", "", f.url); a.href = /^https?:/.test(f.url) ? f.url : "#"; a.rel = "noopener noreferrer"; a.target = "_blank"; p.appendChild(document.createTextNode("Link: ")); p.appendChild(a); box.appendChild(p); }
    if (pending) {
      var act = el("div", "rv-act");
      [["approve", "Approve", ""], ["reject", "Reject", "alt"]].forEach(function (b) {
        var btn = el("button", "fm-btn " + b[2], b[1]); btn.type = "button";
        btn.addEventListener("click", function () {
          btn.disabled = true;
          api("/api/approve", { method: "POST", body: JSON.stringify({ id: item.id, action: b[0] }) }).then(load).catch(function (e) { msg.textContent = e.message; btn.disabled = false; });
        });
        act.appendChild(btn);
      });
      box.appendChild(act);
    }
    return box;
  }
  // Featured requests (kind "featured"): brand, event link, week, free or paid, email. Approve / Reject; "Mark paid" once approved.
  function post(body, btn) {
    btn.disabled = true;
    return api("/api/approve", { method: "POST", body: JSON.stringify(body) }).then(load).catch(function (e) { msg.textContent = e.message; btn.disabled = false; });
  }
  function featCard(item, approved) {
    var box = el("div", "rv-item");
    box.appendChild(el("h3", "", (item.brand || "(no brand)") + "  " + (item.plan === "paid" ? "paid" : "free") + (item.paid ? " (paid in)" : "")));
    box.appendChild(el("p", "rv-meta", "id " + item.id + " - sent " + (item.at || "").slice(0, 16).replace("T", " ")));
    var p = el("p"), a = el("a", "", "Pop-up " + item.event);
    a.href = /^[a-f0-9]{12}$/.test(item.event || "") ? "/?event=" + item.event : "#"; a.rel = "noopener noreferrer"; a.target = "_blank";
    p.appendChild(document.createTextNode("Event: ")); p.appendChild(a); box.appendChild(p);
    line(box, "Week from", item.week); if (approved) line(box, "Shown until", (item.until || "").slice(0, 10));
    line(box, "Email", item.email); line(box, "Notes", item.notes); line(box, "Paid at", item.paid_at && item.paid_at.slice(0, 16).replace("T", " "));
    var act = el("div", "rv-act");
    var defs = approved ? (item.paid ? [] : [["Mark paid", "", { patch: { paid: true }, action: "edit" }]]) : [["Approve", "", { action: "approve" }], ["Reject", "alt", { action: "reject" }]];
    defs.forEach(function (d) {
      var btn = el("button", "fm-btn " + d[1], d[0]); btn.type = "button";
      btn.addEventListener("click", function () { post(Object.assign({ id: item.id, kind: "featured" }, d[2]), btn); });
      act.appendChild(btn);
    });
    if (defs.length) box.appendChild(act);
    return box;
  }
  function fillFeat(id, items, approved) {
    var c = document.getElementById(id); c.textContent = "";
    if (!items.length) c.appendChild(el("p", "fm-note", "Nothing here."));
    items.forEach(function (i) { c.appendChild(featCard(i, approved)); });
  }
  function fill(id, items, pending) {
    var c = document.getElementById(id); c.textContent = "";
    if (!items.length) c.appendChild(el("p", "fm-note", "Nothing here."));
    items.forEach(function (i) { c.appendChild(card(i, pending)); });
  }
  function load() {
    msg.textContent = "";
    return api("/api/queue?kinds=pending,approved,featured,featured-ok").then(function (j) {
      gate.hidden = true; queue.hidden = false;
      fill("pending", j.pending || [], true); fill("approved", j.approved || [], false);
      fillFeat("feat-pending", j.featured || [], false); fillFeat("feat-ok", j["featured-ok"] || [], true);
      if (j.pending_more || j.approved_more || j.featured_more || j["featured-ok_more"]) msg.textContent = "More than 40 waiting: handle these, then reload.";
    }).catch(function (e) {
      queue.hidden = true; gate.hidden = false; msg.textContent = e.message;
      if (/not allowed/i.test(e.message)) setToken("");
    });
  }
  document.getElementById("token-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var t = document.getElementById("token").value.trim();
    if (!t) return;
    setToken(t); document.getElementById("token").value = ""; load();
  });
  document.getElementById("reload").addEventListener("click", load);
  document.getElementById("forget").addEventListener("click", function () { setToken(""); queue.hidden = true; gate.hidden = false; });
  if (getToken()) load();
})();
