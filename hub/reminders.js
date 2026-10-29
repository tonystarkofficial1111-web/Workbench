// ---- Reminders: what needs doing, worked out from the Work data ----------------------------
// One plain function shared by the app (Home's "Needs attention", the bell, the banners) and the
// Workbench Hub on the rig (phone notifications while the app is closed), so both always agree.
// Each reminder has a stable key: the same job and reason give the same key on every device,
// which is how a reminder is shown (and pushed) once instead of every time it is worked out.
function __wbReminders(D, now) {
  now = now || Date.now();
  let day = (plus) => {
      let d = new Date(now + (plus || 0) * 864e5);
      return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    },
    today = day(0),
    at = (d) => new Date(String(d).length === 10 ? d + "T12:00:00" : d).getTime(),
    days = (d) => (d ? Math.floor((now - at(d)) / 864e5) : 1e9),
    fmt = (d) => (d ? new Date(at(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""),
    money = (n) => (n < 0 ? "-$" : "$") + Math.round(Math.abs(n || 0)).toLocaleString("en-US"),
    live = (a) => (a || []).filter((r) => r && !r.del),
    S = D.settings || {},
    stock = S.stock || {},
    C = live(D.companies),
    O = live(D.orders),
    E = live(D.expenses),
    co = (id) => C.find((c) => c.id === id),
    stages = ["Talking", "In progress", "Done"],
    old = { Quote: "Talking", Designing: "In progress", Approved: "In progress", Printing: "In progress", Installed: "Done", Paid: "Done" },
    stage = (s) => (s === "Cancelled" ? s : stages.includes(s) ? s : old[s] || "Talking"),
    totals = (o) => {
      let sub = (o.items || []).reduce((s, it) => s + (+it.q || 0) * (+it.p || 0), 0),
        net = sub - (+o.disc || 0),
        total = net + (o.taxExempt ? 0 : (net * (+o.taxRate || 0)) / 100),
        paid = (o.payments || []).reduce((s, p) => s + (+p.amount || 0), 0);
      return { total, balance: total - paid };
    },
    out = [];
  for (let o of O) {
    if (o.status === "Cancelled") continue;
    let c = co(o.companyId),
      name = c ? c.name : "No customer",
      T = totals(o),
      sd = o.statusDates || {},
      st = stage(o.status),
      what = o.title || String(o.want || "").slice(0, 50) || o.jobType || "",
      lastT = Math.max((o.log && o.log[0] && o.log[0].t) || 0, at(sd[st] || o.created) || 0),
      quiet = Math.floor((now - lastT) / 864e5),
      base = { ord: o.id };
    if (o.follow && o.follow.date && o.follow.date <= today && st !== "Done")
      out.push({ ...base, key: "fu:" + o.id + ":" + o.follow.date, kind: "followup", p: 95, text: o.follow.text ? "Follow up: " + o.follow.text : "Follow up with " + name, sub: o.no + " · " + name + (o.follow.date < today ? " · planned for " + fmt(o.follow.date) : " · today"), chip: "Follow up", cls: "w" });
    if (o.due && st !== "Done") {
      let d = days(o.due);
      if (d > 0) out.push({ ...base, key: "over:" + o.id + ":" + o.due, kind: "overdue", p: 100, text: o.no + " is overdue" + (what ? ": " + what : ""), sub: name + " · was due " + fmt(o.due), chip: "Overdue", cls: "r" });
      else if (d >= -3) out.push({ ...base, key: "due:" + o.id + ":" + o.due, kind: "due", p: 80, text: o.no + " is due " + (d === 0 ? "today" : fmt(o.due)), sub: name + " · " + what, chip: "Due", cls: "w" });
    }
    if (st === "Talking" && quiet >= 5 && !(o.follow && o.follow.date > today))
      out.push({ ...base, key: "quiet:" + o.id + ":" + Math.floor(lastT / 864e5), kind: "followup", p: 70, text: "Follow up with " + name, sub: o.no + " · " + what + " · no word in " + quiet + " days", chip: "Follow up", cls: "w" });
    if (st === "In progress" && quiet >= 7) out.push({ ...base, key: "stale:" + o.id + ":" + Math.floor(lastT / 864e5), kind: "stale", p: 55, text: "Check on " + o.no, sub: name + " · " + what + " · no update in " + quiet + " days", chip: "Update", cls: "d" });
    if (st === "Done" && T.total > 0.005 && T.balance > 0.005) {
      if (!o.invNo) out.push({ ...base, key: "inv:" + o.id, kind: "money", p: 85, text: "Send the invoice for " + o.no, sub: name + " · " + what, chip: money(T.balance), cls: "g" });
      else if (days(o.invDate || sd.Done || o.created) >= 7) out.push({ ...base, key: "collect:" + o.id + ":" + o.invNo, kind: "money", p: 90, text: "Collect payment for " + o.no, sub: name + " · invoiced " + fmt(o.invDate), chip: money(T.balance), cls: "g" });
    }
  }
  for (let c of C) {
    let since = days(c.lastContact),
      base = { co: c.id, lead: c.stage !== "customer" };
    if (c.follow && c.follow.date && c.follow.date <= today)
      out.push({ ...base, key: "fu:" + c.id + ":" + c.follow.date, kind: "followup", p: 94, text: c.follow.text ? "Follow up: " + c.follow.text : "Follow up with " + c.name, sub: c.name + (c.follow.date < today ? " · planned for " + fmt(c.follow.date) : " · today"), chip: "Follow up", cls: "w" });
    if (c.stage !== "customer") {
      if (c.leadStatus === "Quoted" && since >= 7) out.push({ ...base, key: "lead-q:" + c.id + ":" + (c.lastContact || ""), kind: "lead", p: 65, text: "Follow up with " + c.name, sub: "Quoted " + (since < 1e8 ? since + " days ago" : ""), chip: "Quoted", cls: "w" });
      else if (c.leadStatus === "Called" && since >= 7) out.push({ ...base, key: "lead-c:" + c.id + ":" + (c.lastContact || ""), kind: "lead", p: 50, text: "Visit " + c.name + " with samples", sub: "Called " + since + " days ago", chip: "Visit", cls: "d" });
    } else {
      let last = O.filter((o) => o.companyId === c.id)
        .map((o) => o.created)
        .sort()
        .pop();
      last && days(last) >= 60 && since >= 30 && out.push({ ...base, key: "checkin:" + c.id + ":" + last, kind: "customer", p: 40, text: "Check in with " + c.name, sub: "Last job " + fmt(last), chip: "Check in", cls: "d" });
    }
  }
  if (S.trackStock && (+stock.spools || 0) <= (+stock.spoolsAt || 0) && (stock.spoolsAt || 0) > 0) out.push({ key: "stock:vinyl", kind: "stock", settings: 1, p: 75, text: "Reorder vinyl", sub: stock.spools + " spools left", chip: "Stock", cls: "w" });
  if (S.trackStock && (+stock.inkBags || 0) <= (+stock.inkAt || 0) && (stock.inkAt || 0) > 0) out.push({ key: "stock:ink", kind: "stock", settings: 1, p: 74, text: "Reorder ink", sub: stock.inkBags + " sets of 4 left", chip: "Stock", cls: "w" });
  // a few leads to call, nearest first
  if (out.length < 6) {
    let fresh = C.filter((c) => c.stage !== "customer" && c.leadStatus === "Not contacted").sort((a, b) => String(a.area).localeCompare(String(b.area)));
    for (let c of fresh.slice(0, 6 - out.length)) out.push({ co: c.id, lead: !0, key: "call:" + c.id, kind: "lead", p: 30, text: "Call " + c.name, sub: [c.profession, c.area].filter(Boolean).join(" · "), chip: c.phone ? "Call" : "Walk in", cls: "g" });
  }
  E.length; // expenses are not reminders (yet)
  return out.sort((a, b) => b.p - a.p);
}
if (typeof module === "object" && module && module.exports && typeof window === "undefined") module.exports = { __wbReminders };
