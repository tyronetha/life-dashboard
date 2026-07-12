/*
 * Tiny runtime that renders the original Claude Design (.dc.html) template
 * as-is: it understands <sc-for list as>, <sc-if value>, {{ expr }} text /
 * attribute interpolation, and onClick / onKeyDown / onInput handlers.
 * Expressions are limited to `identifier`, `scope.prop`, and true/false —
 * exactly what the L I F E Dashboard template uses.
 *
 * Rendering rebuilds a detached tree from the template each update, then
 * morphs the live DOM to match it so focus / caret in text inputs survive.
 */
(function () {
  var EVENT_PROPS = ['onclick', 'oninput', 'onkeydown', 'onkeypress', 'onchange', 'onkeyup'];

  // Resolve `expr` against a stack of scopes (innermost last).
  function resolve(expr, scopes) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    var parts = expr.split('.');
    var cur, found = false;
    for (var i = scopes.length - 1; i >= 0; i--) {
      if (scopes[i] != null && parts[0] in scopes[i]) { cur = scopes[i][parts[0]]; found = true; break; }
    }
    if (!found) return undefined;
    for (var j = 1; j < parts.length && cur != null; j++) cur = cur[parts[j]];
    return cur;
  }

  // Interpolate a string. If the whole string is a single {{ }}, return the raw
  // value (may be a function / boolean); otherwise return a coerced string.
  function interp(str, scopes) {
    var single = str.match(/^\{\{([^}]*)\}\}$/);
    if (single) return resolve(single[1], scopes);
    return str.replace(/\{\{([^}]*)\}\}/g, function (_, e) {
      var v = resolve(e, scopes);
      return v == null ? '' : String(v);
    });
  }

  function processChildren(srcParent, scopes, destParent) {
    var kids = srcParent.childNodes;
    for (var i = 0; i < kids.length; i++) processNode(kids[i], scopes, destParent);
  }

  function processNode(node, scopes, destParent) {
    if (node.nodeType === 3) { // text
      var t = node.data;
      if (t.indexOf('{{') === -1) { destParent.appendChild(document.createTextNode(t)); return; }
      var v = interp(t, scopes);
      destParent.appendChild(document.createTextNode(v == null ? '' : String(v)));
      return;
    }
    if (node.nodeType !== 1) return; // ignore comments etc.

    var tag = node.tagName.toLowerCase();

    if (tag === 'sc-for') {
      var list = interp(node.getAttribute('list') || '', scopes);
      var asName = node.getAttribute('as') || 'item';
      if (Array.isArray(list)) {
        for (var k = 0; k < list.length; k++) {
          var frame = {}; frame[asName] = list[k]; frame['$index'] = k;
          processChildren(node, scopes.concat([frame]), destParent);
        }
      }
      return;
    }
    if (tag === 'sc-if') {
      if (interp(node.getAttribute('value') || '', scopes)) processChildren(node, scopes, destParent);
      return;
    }

    // Ordinary element: shallow-clone (preserves SVG namespace + static attrs).
    var el = node.cloneNode(false);

    // Process attributes.
    var attrs = Array.prototype.slice.call(el.attributes);
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name, val = attrs[a].value;
      if (EVENT_PROPS.indexOf(name) !== -1) {
        var handler = interp(val, scopes);
        el.removeAttribute(name);
        el[name] = (typeof handler === 'function') ? handler : null;
      } else if (name.indexOf('hint-') === 0) {
        el.removeAttribute(name);
      } else if (name === 'value') {
        el.__val = interp(val, scopes);
        el.removeAttribute('value');
        try { el.value = el.__val == null ? '' : el.__val; } catch (e) {}
      } else if (val.indexOf('{{') !== -1) {
        var iv = interp(val, scopes);
        el.setAttribute(name, iv == null ? '' : String(iv));
      }
    }

    processChildren(node, scopes, el);
    destParent.appendChild(el);
  }

  // Morph `from` (live) to look like `to` (detached), reusing nodes in place.
  function morph(from, to) {
    if (from.nodeType === 3) { if (from.data !== to.data) from.data = to.data; return; }
    if (from.nodeType !== 1) return;
    if (from.tagName !== to.tagName) { from.replaceWith(to); return; }

    // Attributes
    var fa = from.attributes;
    for (var i = fa.length - 1; i >= 0; i--) {
      if (!to.hasAttribute(fa[i].name)) from.removeAttribute(fa[i].name);
    }
    var ta = to.attributes;
    for (var j = 0; j < ta.length; j++) {
      if (from.getAttribute(ta[j].name) !== ta[j].value) from.setAttribute(ta[j].name, ta[j].value);
    }

    // Event handler props
    for (var e = 0; e < EVENT_PROPS.length; e++) {
      var p = EVENT_PROPS[e];
      if (from[p] !== to[p]) from[p] = to[p] || null;
    }

    // Bound input value (don't clobber while the user is typing in it)
    if (to.__val !== undefined) {
      var nv = to.__val == null ? '' : to.__val;
      if (from !== document.activeElement && from.value !== nv) from.value = nv;
      from.__val = to.__val;
    }

    // Children, by position
    var fc = from.firstChild, tc = to.firstChild;
    while (fc && tc) {
      var nf = fc.nextSibling, nt = tc.nextSibling;
      if (fc.nodeType !== tc.nodeType || (fc.nodeType === 1 && fc.tagName !== tc.tagName)) {
        from.replaceChild(tc, fc);
      } else {
        morph(fc, tc);
      }
      fc = nf; tc = nt;
    }
    while (fc) { var d = fc.nextSibling; from.removeChild(fc); fc = d; }
    while (tc) { var n = tc.nextSibling; from.appendChild(tc); tc = n; }
  }

  // Minimal React-ish base class for the design's Component logic.
  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
    this._cbs = [];
    this._pending = false;
  }
  DCLogic.prototype.setState = function (patch, cb) {
    var next = (typeof patch === 'function') ? patch(this.state) : patch;
    this.state = Object.assign({}, this.state, next);
    if (cb) this._cbs.push(cb);
    this._schedule();
  };
  DCLogic.prototype._schedule = function () {
    if (this._pending) return;
    this._pending = true;
    var self = this;
    Promise.resolve().then(function () {
      self._pending = false;
      self._render();
      var cbs = self._cbs; self._cbs = [];
      for (var i = 0; i < cbs.length; i++) { try { cbs[i](); } catch (e) { console.error(e); } }
    });
  };
  DCLogic.prototype._render = function () {
    var V = this.renderVals();
    var next = document.createElement('div');
    processChildren(this._tpl, [V], next);
    morph(this._app, next);
  };
  // Wire the instance to a template root + a live mount node, render, then mount.
  DCLogic.prototype.$mount = function (tplRoot, appEl) {
    this._tpl = tplRoot;
    this._app = appEl;
    this._render();
    if (this.componentDidMount) this.componentDidMount();
  };

  window.DCLogic = DCLogic;
})();
