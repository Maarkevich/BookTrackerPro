import { g as _i, s as gi, r as yi, a as mi } from "../core-DnsuMG85.js";
import { b as Ri, c as Si, e as ji, f as Wi, d as ki, d as Oi, h as Di, p as Ui, i as Ii, t as xi } from "../core-DnsuMG85.js";
var Pr = (() => {
  var L;
  var S = typeof document < "u" ? (L = document.currentScript) == null ? void 0 : L.src : void 0;
  return function(Me = {}) {
    var Xr, l = Me, Gr, ur, He = new Promise((e, r) => {
      Gr = e, ur = r;
    }), Ve = typeof window == "object", Be = typeof Bun < "u", Ar = typeof importScripts == "function";
    typeof process == "object" && typeof process.versions == "object" && process.versions.node;
    var qr = Object.assign({}, l), Yr = "./this.program", j = "";
    function Ne(e) {
      return l.locateFile ? l.locateFile(e, j) : j + e;
    }
    var Kr, Fr;
    (Ve || Ar || Be) && (Ar ? j = self.location.href : typeof document < "u" && document.currentScript && (j = document.currentScript.src), S && (j = S), j.startsWith("blob:") ? j = "" : j = j.substr(0, j.replace(/[?#].*/, "").lastIndexOf("/") + 1), Ar && (Fr = (e) => {
      var r = new XMLHttpRequest();
      return r.open("GET", e, !1), r.responseType = "arraybuffer", r.send(null), new Uint8Array(r.response);
    }), Kr = (e) => fetch(e, {
      credentials: "same-origin"
    }).then((r) => r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status + " : " + r.url))));
    var ze = l.print || console.log.bind(console), Z = l.printErr || console.error.bind(console);
    Object.assign(l, qr), qr = null, l.arguments && l.arguments, l.thisProgram && (Yr = l.thisProgram), l.quit && l.quit;
    var Y;
    l.wasmBinary && (Y = l.wasmBinary);
    var lr, Qr = !1, W, P, X, K, H, _, Jr, re;
    function ee() {
      var e = lr.buffer;
      l.HEAP8 = W = new Int8Array(e), l.HEAP16 = X = new Int16Array(e), l.HEAPU8 = P = new Uint8Array(e), l.HEAPU16 = K = new Uint16Array(e), l.HEAP32 = H = new Int32Array(e), l.HEAPU32 = _ = new Uint32Array(e), l.HEAPF32 = Jr = new Float32Array(e), l.HEAPF64 = re = new Float64Array(e);
    }
    var te = [], ne = [], ie = [];
    function Le() {
      if (l.preRun)
        for (typeof l.preRun == "function" && (l.preRun = [l.preRun]); l.preRun.length; )
          Ge(l.preRun.shift());
      Rr(te);
    }
    function Ze() {
      Rr(ne);
    }
    function Xe() {
      if (l.postRun)
        for (typeof l.postRun == "function" && (l.postRun = [l.postRun]); l.postRun.length; )
          Ye(l.postRun.shift());
      Rr(ie);
    }
    function Ge(e) {
      te.unshift(e);
    }
    function qe(e) {
      ne.unshift(e);
    }
    function Ye(e) {
      ie.unshift(e);
    }
    var V = 0, Q = null;
    function Ke(e) {
      var r;
      V++, (r = l.monitorRunDependencies) === null || r === void 0 || r.call(l, V);
    }
    function Qe(e) {
      var r;
      if (V--, (r = l.monitorRunDependencies) === null || r === void 0 || r.call(l, V), V == 0 && Q) {
        var t = Q;
        Q = null, t();
      }
    }
    function Er(e) {
      var r;
      (r = l.onAbort) === null || r === void 0 || r.call(l, e), e = "Aborted(" + e + ")", Z(e), Qr = !0, e += ". Build with -sASSERTIONS for more info.";
      var t = new WebAssembly.RuntimeError(e);
      throw ur(t), t;
    }
    var Je = "data:application/octet-stream;base64,", ae = (e) => e.startsWith(Je);
    function rt() {
      var e = "zxing_reader.wasm";
      return ae(e) ? e : Ne(e);
    }
    var fr;
    function se(e) {
      if (e == fr && Y)
        return new Uint8Array(Y);
      if (Fr)
        return Fr(e);
      throw "both async and sync fetching of the wasm failed";
    }
    function et(e) {
      return Y ? Promise.resolve().then(() => se(e)) : Kr(e).then((r) => new Uint8Array(r), () => se(e));
    }
    function oe(e, r, t) {
      return et(e).then((n) => WebAssembly.instantiate(n, r)).then(t, (n) => {
        Z(`failed to asynchronously prepare wasm: ${n}`), Er(n);
      });
    }
    function tt(e, r, t, n) {
      return !e && typeof WebAssembly.instantiateStreaming == "function" && !ae(r) && typeof fetch == "function" ? fetch(r, {
        credentials: "same-origin"
      }).then((i) => {
        var a = WebAssembly.instantiateStreaming(i, t);
        return a.then(n, function(o) {
          return Z(`wasm streaming compile failed: ${o}`), Z("falling back to ArrayBuffer instantiation"), oe(r, t, n);
        });
      }) : oe(r, t, n);
    }
    function nt() {
      return {
        a: Xn
      };
    }
    function it() {
      var e = nt();
      function r(n, i) {
        return m = n.exports, lr = m.ma, ee(), _e = m.qa, qe(m.na), Qe(), m;
      }
      Ke();
      function t(n) {
        r(n.instance);
      }
      if (l.instantiateWasm)
        try {
          return l.instantiateWasm(e, r);
        } catch (n) {
          Z(`Module.instantiateWasm callback failed with error: ${n}`), ur(n);
        }
      return fr || (fr = rt()), tt(Y, fr, e, t).catch(ur), {};
    }
    var Rr = (e) => {
      for (; e.length > 0; )
        e.shift()(l);
    };
    l.noExitRuntime;
    var b = (e) => Fe(e), w = () => Ee(), cr = [], vr = 0, at = (e) => {
      var r = new Sr(e);
      return r.get_caught() || (r.set_caught(!0), vr--), r.set_rethrown(!1), cr.push(r), Se(r.excPtr), r.get_exception_ptr();
    }, D = 0, st = () => {
      g(0, 0);
      var e = cr.pop();
      Re(e.excPtr), D = 0;
    };
    class Sr {
      constructor(r) {
        this.excPtr = r, this.ptr = r - 24;
      }
      set_type(r) {
        _[this.ptr + 4 >> 2] = r;
      }
      get_type() {
        return _[this.ptr + 4 >> 2];
      }
      set_destructor(r) {
        _[this.ptr + 8 >> 2] = r;
      }
      get_destructor() {
        return _[this.ptr + 8 >> 2];
      }
      set_caught(r) {
        r = r ? 1 : 0, W[this.ptr + 12] = r;
      }
      get_caught() {
        return W[this.ptr + 12] != 0;
      }
      set_rethrown(r) {
        r = r ? 1 : 0, W[this.ptr + 13] = r;
      }
      get_rethrown() {
        return W[this.ptr + 13] != 0;
      }
      init(r, t) {
        this.set_adjusted_ptr(0), this.set_type(r), this.set_destructor(t);
      }
      set_adjusted_ptr(r) {
        _[this.ptr + 16 >> 2] = r;
      }
      get_adjusted_ptr() {
        return _[this.ptr + 16 >> 2];
      }
      get_exception_ptr() {
        var r = We(this.get_type());
        if (r)
          return _[this.excPtr >> 2];
        var t = this.get_adjusted_ptr();
        return t !== 0 ? t : this.excPtr;
      }
    }
    var ot = (e) => {
      throw D || (D = e), D;
    }, dr = (e) => Ae(e), jr = (e) => {
      var r = D;
      if (!r)
        return dr(0), 0;
      var t = new Sr(r);
      t.set_adjusted_ptr(r);
      var n = t.get_type();
      if (!n)
        return dr(0), r;
      for (var i of e) {
        if (i === 0 || i === n)
          break;
        var a = t.ptr + 16;
        if (je(i, n, a))
          return dr(i), r;
      }
      return dr(n), r;
    }, ut = () => jr([]), lt = (e) => jr([e]), ft = (e, r) => jr([e, r]), ct = () => {
      var e = cr.pop();
      e || Er("no exception to throw");
      var r = e.excPtr;
      throw e.get_rethrown() || (cr.push(e), e.set_rethrown(!0), e.set_caught(!1), vr++), D = r, D;
    }, vt = (e, r, t) => {
      var n = new Sr(e);
      throw n.init(r, t), D = e, vr++, D;
    }, dt = () => vr, pt = () => {
      Er("");
    }, pr = {}, Wr = (e) => {
      for (; e.length; ) {
        var r = e.pop(), t = e.pop();
        t(r);
      }
    };
    function J(e) {
      return this.fromWireType(_[e >> 2]);
    }
    var G = {}, B = {}, hr = {}, ue, _r = (e) => {
      throw new ue(e);
    }, N = (e, r, t) => {
      e.forEach(function(s) {
        hr[s] = r;
      });
      function n(s) {
        var u = t(s);
        u.length !== e.length && _r("Mismatched type converter count");
        for (var f = 0; f < e.length; ++f)
          k(e[f], u[f]);
      }
      var i = new Array(r.length), a = [], o = 0;
      r.forEach((s, u) => {
        B.hasOwnProperty(s) ? i[u] = B[s] : (a.push(s), G.hasOwnProperty(s) || (G[s] = []), G[s].push(() => {
          i[u] = B[s], ++o, o === a.length && n(i);
        }));
      }), a.length === 0 && n(i);
    }, ht = (e) => {
      var r = pr[e];
      delete pr[e];
      var t = r.rawConstructor, n = r.rawDestructor, i = r.fields, a = i.map((o) => o.getterReturnType).concat(i.map((o) => o.setterArgumentType));
      N([e], a, (o) => {
        var s = {};
        return i.forEach((u, f) => {
          var c = u.fieldName, v = o[f], d = u.getter, p = u.getterContext, T = o[f + i.length], A = u.setter, $ = u.setterContext;
          s[c] = {
            read: (F) => v.fromWireType(d(p, F)),
            write: (F, z) => {
              var E = [];
              A($, F, T.toWireType(E, z)), Wr(E);
            }
          };
        }), [{
          name: r.name,
          fromWireType: (u) => {
            var f = {};
            for (var c in s)
              f[c] = s[c].read(u);
            return n(u), f;
          },
          toWireType: (u, f) => {
            for (var c in s)
              if (!(c in f))
                throw new TypeError(`Missing field: "${c}"`);
            var v = t();
            for (c in s)
              s[c].write(v, f[c]);
            return u !== null && u.push(n, v), v;
          },
          argPackAdvance: O,
          readValueFromPointer: J,
          destructorFunction: n
        }];
      });
    }, _t = (e, r, t, n, i) => {
    }, gt = () => {
      for (var e = new Array(256), r = 0; r < 256; ++r)
        e[r] = String.fromCharCode(r);
      le = e;
    }, le, C = (e) => {
      for (var r = "", t = e; P[t]; )
        r += le[P[t++]];
      return r;
    }, q, h = (e) => {
      throw new q(e);
    };
    function yt(e, r) {
      let t = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
      var n = r.name;
      if (e || h(`type "${n}" must have a positive integer typeid pointer`), B.hasOwnProperty(e)) {
        if (t.ignoreDuplicateRegistrations)
          return;
        h(`Cannot register type '${n}' twice`);
      }
      if (B[e] = r, delete hr[e], G.hasOwnProperty(e)) {
        var i = G[e];
        delete G[e], i.forEach((a) => a());
      }
    }
    function k(e, r) {
      let t = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
      if (!("argPackAdvance" in r))
        throw new TypeError("registerType registeredInstance requires argPackAdvance");
      return yt(e, r, t);
    }
    var O = 8, mt = (e, r, t, n) => {
      r = C(r), k(e, {
        name: r,
        fromWireType: function(i) {
          return !!i;
        },
        toWireType: function(i, a) {
          return a ? t : n;
        },
        argPackAdvance: O,
        readValueFromPointer: function(i) {
          return this.fromWireType(P[i]);
        },
        destructorFunction: null
      });
    }, $t = (e) => ({
      count: e.count,
      deleteScheduled: e.deleteScheduled,
      preservePointerOnDelete: e.preservePointerOnDelete,
      ptr: e.ptr,
      ptrType: e.ptrType,
      smartPtr: e.smartPtr,
      smartPtrType: e.smartPtrType
    }), kr = (e) => {
      function r(t) {
        return t.$$.ptrType.registeredClass.name;
      }
      h(r(e) + " instance already deleted");
    }, Or = !1, fe = (e) => {
    }, bt = (e) => {
      e.smartPtr ? e.smartPtrType.rawDestructor(e.smartPtr) : e.ptrType.registeredClass.rawDestructor(e.ptr);
    }, ce = (e) => {
      e.count.value -= 1;
      var r = e.count.value === 0;
      r && bt(e);
    }, ve = (e, r, t) => {
      if (r === t)
        return e;
      if (t.baseClass === void 0)
        return null;
      var n = ve(e, r, t.baseClass);
      return n === null ? null : t.downcast(n);
    }, de = {}, wt = () => Object.keys(tr).length, Tt = () => {
      var e = [];
      for (var r in tr)
        tr.hasOwnProperty(r) && e.push(tr[r]);
      return e;
    }, rr = [], Dr = () => {
      for (; rr.length; ) {
        var e = rr.pop();
        e.$$.deleteScheduled = !1, e.delete();
      }
    }, er, Ct = (e) => {
      er = e, rr.length && er && er(Dr);
    }, Pt = () => {
      l.getInheritedInstanceCount = wt, l.getLiveInheritedInstances = Tt, l.flushPendingDeletes = Dr, l.setDelayFunction = Ct;
    }, tr = {}, At = (e, r) => {
      for (r === void 0 && h("ptr should not be undefined"); e.baseClass; )
        r = e.upcast(r), e = e.baseClass;
      return r;
    }, Ft = (e, r) => (r = At(e, r), tr[r]), gr = (e, r) => {
      (!r.ptrType || !r.ptr) && _r("makeClassHandle requires ptr and ptrType");
      var t = !!r.smartPtrType, n = !!r.smartPtr;
      return t !== n && _r("Both smartPtrType and smartPtr must be specified"), r.count = {
        value: 1
      }, nr(Object.create(e, {
        $$: {
          value: r,
          writable: !0
        }
      }));
    };
    function Et(e) {
      var r = this.getPointee(e);
      if (!r)
        return this.destructor(e), null;
      var t = Ft(this.registeredClass, r);
      if (t !== void 0) {
        if (t.$$.count.value === 0)
          return t.$$.ptr = r, t.$$.smartPtr = e, t.clone();
        var n = t.clone();
        return this.destructor(e), n;
      }
      function i() {
        return this.isSmartPointer ? gr(this.registeredClass.instancePrototype, {
          ptrType: this.pointeeType,
          ptr: r,
          smartPtrType: this,
          smartPtr: e
        }) : gr(this.registeredClass.instancePrototype, {
          ptrType: this,
          ptr: e
        });
      }
      var a = this.registeredClass.getActualType(r), o = de[a];
      if (!o)
        return i.call(this);
      var s;
      this.isConst ? s = o.constPointerType : s = o.pointerType;
      var u = ve(r, this.registeredClass, s.registeredClass);
      return u === null ? i.call(this) : this.isSmartPointer ? gr(s.registeredClass.instancePrototype, {
        ptrType: s,
        ptr: u,
        smartPtrType: this,
        smartPtr: e
      }) : gr(s.registeredClass.instancePrototype, {
        ptrType: s,
        ptr: u
      });
    }
    var nr = (e) => typeof FinalizationRegistry > "u" ? (nr = (r) => r, e) : (Or = new FinalizationRegistry((r) => {
      ce(r.$$);
    }), nr = (r) => {
      var t = r.$$, n = !!t.smartPtr;
      if (n) {
        var i = {
          $$: t
        };
        Or.register(r, i, r);
      }
      return r;
    }, fe = (r) => Or.unregister(r), nr(e)), Rt = () => {
      Object.assign(yr.prototype, {
        isAliasOf(e) {
          if (!(this instanceof yr) || !(e instanceof yr))
            return !1;
          var r = this.$$.ptrType.registeredClass, t = this.$$.ptr;
          e.$$ = e.$$;
          for (var n = e.$$.ptrType.registeredClass, i = e.$$.ptr; r.baseClass; )
            t = r.upcast(t), r = r.baseClass;
          for (; n.baseClass; )
            i = n.upcast(i), n = n.baseClass;
          return r === n && t === i;
        },
        clone() {
          if (this.$$.ptr || kr(this), this.$$.preservePointerOnDelete)
            return this.$$.count.value += 1, this;
          var e = nr(Object.create(Object.getPrototypeOf(this), {
            $$: {
              value: $t(this.$$)
            }
          }));
          return e.$$.count.value += 1, e.$$.deleteScheduled = !1, e;
        },
        delete() {
          this.$$.ptr || kr(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && h("Object already scheduled for deletion"), fe(this), ce(this.$$), this.$$.preservePointerOnDelete || (this.$$.smartPtr = void 0, this.$$.ptr = void 0);
        },
        isDeleted() {
          return !this.$$.ptr;
        },
        deleteLater() {
          return this.$$.ptr || kr(this), this.$$.deleteScheduled && !this.$$.preservePointerOnDelete && h("Object already scheduled for deletion"), rr.push(this), rr.length === 1 && er && er(Dr), this.$$.deleteScheduled = !0, this;
        }
      });
    };
    function yr() {
    }
    var ir = (e, r) => Object.defineProperty(r, "name", {
      value: e
    }), pe = (e, r, t) => {
      if (e[r].overloadTable === void 0) {
        var n = e[r];
        e[r] = function() {
          for (var i = arguments.length, a = new Array(i), o = 0; o < i; o++)
            a[o] = arguments[o];
          return e[r].overloadTable.hasOwnProperty(a.length) || h(`Function '${t}' called with an invalid number of arguments (${a.length}) - expects one of (${e[r].overloadTable})!`), e[r].overloadTable[a.length].apply(this, a);
        }, e[r].overloadTable = [], e[r].overloadTable[n.argCount] = n;
      }
    }, Ur = (e, r, t) => {
      l.hasOwnProperty(e) ? ((t === void 0 || l[e].overloadTable !== void 0 && l[e].overloadTable[t] !== void 0) && h(`Cannot register public name '${e}' twice`), pe(l, e, e), l.hasOwnProperty(t) && h(`Cannot register multiple overloads of a function with the same number of arguments (${t})!`), l[e].overloadTable[t] = r) : (l[e] = r, t !== void 0 && (l[e].numArguments = t));
    }, St = 48, jt = 57, Wt = (e) => {
      if (e === void 0)
        return "_unknown";
      e = e.replace(/[^a-zA-Z0-9_]/g, "$");
      var r = e.charCodeAt(0);
      return r >= St && r <= jt ? `_${e}` : e;
    };
    function kt(e, r, t, n, i, a, o, s) {
      this.name = e, this.constructor = r, this.instancePrototype = t, this.rawDestructor = n, this.baseClass = i, this.getActualType = a, this.upcast = o, this.downcast = s, this.pureVirtualFunctions = [];
    }
    var Ir = (e, r, t) => {
      for (; r !== t; )
        r.upcast || h(`Expected null or instance of ${t.name}, got an instance of ${r.name}`), e = r.upcast(e), r = r.baseClass;
      return e;
    };
    function Ot(e, r) {
      if (r === null)
        return this.isReference && h(`null is not a valid ${this.name}`), 0;
      r.$$ || h(`Cannot pass "${Nr(r)}" as a ${this.name}`), r.$$.ptr || h(`Cannot pass deleted object as a pointer of type ${this.name}`);
      var t = r.$$.ptrType.registeredClass, n = Ir(r.$$.ptr, t, this.registeredClass);
      return n;
    }
    function Dt(e, r) {
      var t;
      if (r === null)
        return this.isReference && h(`null is not a valid ${this.name}`), this.isSmartPointer ? (t = this.rawConstructor(), e !== null && e.push(this.rawDestructor, t), t) : 0;
      (!r || !r.$$) && h(`Cannot pass "${Nr(r)}" as a ${this.name}`), r.$$.ptr || h(`Cannot pass deleted object as a pointer of type ${this.name}`), !this.isConst && r.$$.ptrType.isConst && h(`Cannot convert argument of type ${r.$$.smartPtrType ? r.$$.smartPtrType.name : r.$$.ptrType.name} to parameter type ${this.name}`);
      var n = r.$$.ptrType.registeredClass;
      if (t = Ir(r.$$.ptr, n, this.registeredClass), this.isSmartPointer)
        switch (r.$$.smartPtr === void 0 && h("Passing raw pointer to smart pointer is illegal"), this.sharingPolicy) {
          case 0:
            r.$$.smartPtrType === this ? t = r.$$.smartPtr : h(`Cannot convert argument of type ${r.$$.smartPtrType ? r.$$.smartPtrType.name : r.$$.ptrType.name} to parameter type ${this.name}`);
            break;
          case 1:
            t = r.$$.smartPtr;
            break;
          case 2:
            if (r.$$.smartPtrType === this)
              t = r.$$.smartPtr;
            else {
              var i = r.clone();
              t = this.rawShare(t, I.toHandle(() => i.delete())), e !== null && e.push(this.rawDestructor, t);
            }
            break;
          default:
            h("Unsupporting sharing policy");
        }
      return t;
    }
    function Ut(e, r) {
      if (r === null)
        return this.isReference && h(`null is not a valid ${this.name}`), 0;
      r.$$ || h(`Cannot pass "${Nr(r)}" as a ${this.name}`), r.$$.ptr || h(`Cannot pass deleted object as a pointer of type ${this.name}`), r.$$.ptrType.isConst && h(`Cannot convert argument of type ${r.$$.ptrType.name} to parameter type ${this.name}`);
      var t = r.$$.ptrType.registeredClass, n = Ir(r.$$.ptr, t, this.registeredClass);
      return n;
    }
    var It = () => {
      Object.assign(mr.prototype, {
        getPointee(e) {
          return this.rawGetPointee && (e = this.rawGetPointee(e)), e;
        },
        destructor(e) {
          var r;
          (r = this.rawDestructor) === null || r === void 0 || r.call(this, e);
        },
        argPackAdvance: O,
        readValueFromPointer: J,
        fromWireType: Et
      });
    };
    function mr(e, r, t, n, i, a, o, s, u, f, c) {
      this.name = e, this.registeredClass = r, this.isReference = t, this.isConst = n, this.isSmartPointer = i, this.pointeeType = a, this.sharingPolicy = o, this.rawGetPointee = s, this.rawConstructor = u, this.rawShare = f, this.rawDestructor = c, !i && r.baseClass === void 0 ? n ? (this.toWireType = Ot, this.destructorFunction = null) : (this.toWireType = Ut, this.destructorFunction = null) : this.toWireType = Dt;
    }
    var he = (e, r, t) => {
      l.hasOwnProperty(e) || _r("Replacing nonexistent public symbol"), l[e].overloadTable !== void 0 && t !== void 0 ? l[e].overloadTable[t] = r : (l[e] = r, l[e].argCount = t);
    }, xt = (e, r, t) => {
      e = e.replace(/p/g, "i");
      var n = l["dynCall_" + e];
      return n(r, ...t);
    }, $r = [], _e, y = (e) => {
      var r = $r[e];
      return r || (e >= $r.length && ($r.length = e + 1), $r[e] = r = _e.get(e)), r;
    }, Mt = function(e, r) {
      let t = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : [];
      if (e.includes("j"))
        return xt(e, r, t);
      var n = y(r)(...t);
      return n;
    }, Ht = (e, r) => function() {
      for (var t = arguments.length, n = new Array(t), i = 0; i < t; i++)
        n[i] = arguments[i];
      return Mt(e, r, n);
    }, R = (e, r) => {
      e = C(e);
      function t() {
        return e.includes("j") ? Ht(e, r) : y(r);
      }
      var n = t();
      return typeof n != "function" && h(`unknown function pointer with signature ${e}: ${r}`), n;
    }, Vt = (e, r) => {
      var t = ir(r, function(n) {
        this.name = r, this.message = n;
        var i = new Error(n).stack;
        i !== void 0 && (this.stack = this.toString() + `
` + i.replace(/^Error(:[^\n]*)?\n/, ""));
      });
      return t.prototype = Object.create(e.prototype), t.prototype.constructor = t, t.prototype.toString = function() {
        return this.message === void 0 ? this.name : `${this.name}: ${this.message}`;
      }, t;
    }, ge, ye = (e) => {
      var r = Pe(e), t = C(r);
      return x(r), t;
    }, br = (e, r) => {
      var t = [], n = {};
      function i(a) {
        if (!n[a] && !B[a]) {
          if (hr[a]) {
            hr[a].forEach(i);
            return;
          }
          t.push(a), n[a] = !0;
        }
      }
      throw r.forEach(i), new ge(`${e}: ` + t.map(ye).join([", "]));
    }, Bt = (e, r, t, n, i, a, o, s, u, f, c, v, d) => {
      c = C(c), a = R(i, a), s && (s = R(o, s)), f && (f = R(u, f)), d = R(v, d);
      var p = Wt(c);
      Ur(p, function() {
        br(`Cannot construct ${c} due to unbound types`, [n]);
      }), N([e, r, t], n ? [n] : [], (T) => {
        T = T[0];
        var A, $;
        n ? (A = T.registeredClass, $ = A.instancePrototype) : $ = yr.prototype;
        var F = ir(c, function() {
          if (Object.getPrototypeOf(this) !== z)
            throw new q("Use 'new' to construct " + c);
          if (E.constructor_body === void 0)
            throw new q(c + " has no accessible constructor");
          for (var Ie = arguments.length, Tr = new Array(Ie), Cr = 0; Cr < Ie; Cr++)
            Tr[Cr] = arguments[Cr];
          var xe = E.constructor_body[Tr.length];
          if (xe === void 0)
            throw new q(`Tried to invoke ctor of ${c} with invalid number of parameters (${Tr.length}) - expected (${Object.keys(E.constructor_body).toString()}) parameters instead!`);
          return xe.apply(this, Tr);
        }), z = Object.create($, {
          constructor: {
            value: F
          }
        });
        F.prototype = z;
        var E = new kt(c, F, z, d, A, a, s, f);
        if (E.baseClass) {
          var M, or;
          (or = (M = E.baseClass).__derivedClasses) !== null && or !== void 0 || (M.__derivedClasses = []), E.baseClass.__derivedClasses.push(E);
        }
        var hi = new mr(c, E, !0, !1, !1), De = new mr(c + "*", E, !1, !1, !1), Ue = new mr(c + " const*", E, !1, !0, !1);
        return de[e] = {
          pointerType: De,
          constPointerType: Ue
        }, he(p, F), [hi, De, Ue];
      });
    }, xr = (e, r) => {
      for (var t = [], n = 0; n < e; n++)
        t.push(_[r + n * 4 >> 2]);
      return t;
    };
    function Nt(e) {
      for (var r = 1; r < e.length; ++r)
        if (e[r] !== null && e[r].destructorFunction === void 0)
          return !0;
      return !1;
    }
    function Mr(e, r, t, n, i, a) {
      var o = r.length;
      o < 2 && h("argTypes array size mismatch! Must at least get return value and 'this' types!");
      var s = r[1] !== null && t !== null, u = Nt(r), f = r[0].name !== "void", c = o - 2, v = new Array(c), d = [], p = [], T = function() {
        arguments.length !== c && h(`function ${e} called with ${arguments.length} arguments, expected ${c}`), p.length = 0;
        var A;
        d.length = s ? 2 : 1, d[0] = i, s && (A = r[1].toWireType(p, this), d[1] = A);
        for (var $ = 0; $ < c; ++$)
          v[$] = r[$ + 2].toWireType(p, $ < 0 || arguments.length <= $ ? void 0 : arguments[$]), d.push(v[$]);
        var F = n(...d);
        function z(E) {
          if (u)
            Wr(p);
          else
            for (var M = s ? 1 : 2; M < r.length; M++) {
              var or = M === 1 ? A : v[M - 2];
              r[M].destructorFunction !== null && r[M].destructorFunction(or);
            }
          if (f)
            return r[0].fromWireType(E);
        }
        return z(F);
      };
      return ir(e, T);
    }
    var zt = (e, r, t, n, i, a) => {
      var o = xr(r, t);
      i = R(n, i), N([], [e], (s) => {
        s = s[0];
        var u = `constructor ${s.name}`;
        if (s.registeredClass.constructor_body === void 0 && (s.registeredClass.constructor_body = []), s.registeredClass.constructor_body[r - 1] !== void 0)
          throw new q(`Cannot register multiple constructors with identical number of parameters (${r - 1}) for class '${s.name}'! Overload resolution is currently only performed using the parameter count, not actual type info!`);
        return s.registeredClass.constructor_body[r - 1] = () => {
          br(`Cannot construct ${s.name} due to unbound types`, o);
        }, N([], o, (f) => (f.splice(1, 0, null), s.registeredClass.constructor_body[r - 1] = Mr(u, f, null, i, a), [])), [];
      });
    }, me = (e) => {
      e = e.trim();
      const r = e.indexOf("(");
      return r !== -1 ? e.substr(0, r) : e;
    }, Lt = (e, r, t, n, i, a, o, s, u) => {
      var f = xr(t, n);
      r = C(r), r = me(r), a = R(i, a), N([], [e], (c) => {
        c = c[0];
        var v = `${c.name}.${r}`;
        r.startsWith("@@") && (r = Symbol[r.substring(2)]), s && c.registeredClass.pureVirtualFunctions.push(r);
        function d() {
          br(`Cannot call ${v} due to unbound types`, f);
        }
        var p = c.registeredClass.instancePrototype, T = p[r];
        return T === void 0 || T.overloadTable === void 0 && T.className !== c.name && T.argCount === t - 2 ? (d.argCount = t - 2, d.className = c.name, p[r] = d) : (pe(p, r, v), p[r].overloadTable[t - 2] = d), N([], f, (A) => {
          var $ = Mr(v, A, c, a, o);
          return p[r].overloadTable === void 0 ? ($.argCount = t - 2, p[r] = $) : p[r].overloadTable[t - 2] = $, [];
        }), [];
      });
    }, Hr = [], U = [], Vr = (e) => {
      e > 9 && --U[e + 1] === 0 && (U[e] = void 0, Hr.push(e));
    }, Zt = () => U.length / 2 - 5 - Hr.length, Xt = () => {
      U.push(0, 1, void 0, 1, null, 1, !0, 1, !1, 1), l.count_emval_handles = Zt;
    }, I = {
      toValue: (e) => (e || h("Cannot use deleted val. handle = " + e), U[e]),
      toHandle: (e) => {
        switch (e) {
          case void 0:
            return 2;
          case null:
            return 4;
          case !0:
            return 6;
          case !1:
            return 8;
          default: {
            const r = Hr.pop() || U.length;
            return U[r] = e, U[r + 1] = 1, r;
          }
        }
      }
    }, Gt = {
      name: "emscripten::val",
      fromWireType: (e) => {
        var r = I.toValue(e);
        return Vr(e), r;
      },
      toWireType: (e, r) => I.toHandle(r),
      argPackAdvance: O,
      readValueFromPointer: J,
      destructorFunction: null
    }, $e = (e) => k(e, Gt), qt = (e, r, t) => {
      switch (r) {
        case 1:
          return t ? function(n) {
            return this.fromWireType(W[n]);
          } : function(n) {
            return this.fromWireType(P[n]);
          };
        case 2:
          return t ? function(n) {
            return this.fromWireType(X[n >> 1]);
          } : function(n) {
            return this.fromWireType(K[n >> 1]);
          };
        case 4:
          return t ? function(n) {
            return this.fromWireType(H[n >> 2]);
          } : function(n) {
            return this.fromWireType(_[n >> 2]);
          };
        default:
          throw new TypeError(`invalid integer width (${r}): ${e}`);
      }
    }, Yt = (e, r, t, n) => {
      r = C(r);
      function i() {
      }
      i.values = {}, k(e, {
        name: r,
        constructor: i,
        fromWireType: function(a) {
          return this.constructor.values[a];
        },
        toWireType: (a, o) => o.value,
        argPackAdvance: O,
        readValueFromPointer: qt(r, t, n),
        destructorFunction: null
      }), Ur(r, i);
    }, Br = (e, r) => {
      var t = B[e];
      return t === void 0 && h(`${r} has unknown type ${ye(e)}`), t;
    }, Kt = (e, r, t) => {
      var n = Br(e, "enum");
      r = C(r);
      var i = n.constructor, a = Object.create(n.constructor.prototype, {
        value: {
          value: t
        },
        constructor: {
          value: ir(`${n.name}_${r}`, function() {
          })
        }
      });
      i.values[t] = a, i[r] = a;
    }, Nr = (e) => {
      if (e === null)
        return "null";
      var r = typeof e;
      return r === "object" || r === "array" || r === "function" ? e.toString() : "" + e;
    }, Qt = (e, r) => {
      switch (r) {
        case 4:
          return function(t) {
            return this.fromWireType(Jr[t >> 2]);
          };
        case 8:
          return function(t) {
            return this.fromWireType(re[t >> 3]);
          };
        default:
          throw new TypeError(`invalid float width (${r}): ${e}`);
      }
    }, Jt = (e, r, t) => {
      r = C(r), k(e, {
        name: r,
        fromWireType: (n) => n,
        toWireType: (n, i) => i,
        argPackAdvance: O,
        readValueFromPointer: Qt(r, t),
        destructorFunction: null
      });
    }, rn = (e, r, t, n, i, a, o) => {
      var s = xr(r, t);
      e = C(e), e = me(e), i = R(n, i), Ur(e, function() {
        br(`Cannot call ${e} due to unbound types`, s);
      }, r - 1), N([], s, (u) => {
        var f = [u[0], null].concat(u.slice(1));
        return he(e, Mr(e, f, null, i, a), r - 1), [];
      });
    }, en = (e, r, t) => {
      switch (r) {
        case 1:
          return t ? (n) => W[n] : (n) => P[n];
        case 2:
          return t ? (n) => X[n >> 1] : (n) => K[n >> 1];
        case 4:
          return t ? (n) => H[n >> 2] : (n) => _[n >> 2];
        default:
          throw new TypeError(`invalid integer width (${r}): ${e}`);
      }
    }, tn = (e, r, t, n, i) => {
      r = C(r);
      var a = (c) => c;
      if (n === 0) {
        var o = 32 - 8 * t;
        a = (c) => c << o >>> o;
      }
      var s = r.includes("unsigned"), u = (c, v) => {
      }, f;
      s ? f = function(c, v) {
        return u(v, this.name), v >>> 0;
      } : f = function(c, v) {
        return u(v, this.name), v;
      }, k(e, {
        name: r,
        fromWireType: a,
        toWireType: f,
        argPackAdvance: O,
        readValueFromPointer: en(r, t, n !== 0),
        destructorFunction: null
      });
    }, nn = (e, r, t) => {
      var n = [Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array], i = n[r];
      function a(o) {
        var s = _[o >> 2], u = _[o + 4 >> 2];
        return new i(W.buffer, u, s);
      }
      t = C(t), k(e, {
        name: t,
        fromWireType: a,
        argPackAdvance: O,
        readValueFromPointer: a
      }, {
        ignoreDuplicateRegistrations: !0
      });
    }, an = (e, r) => {
      $e(e);
    }, sn = (e, r, t, n) => {
      if (!(n > 0)) return 0;
      for (var i = t, a = t + n - 1, o = 0; o < e.length; ++o) {
        var s = e.charCodeAt(o);
        if (s >= 55296 && s <= 57343) {
          var u = e.charCodeAt(++o);
          s = 65536 + ((s & 1023) << 10) | u & 1023;
        }
        if (s <= 127) {
          if (t >= a) break;
          r[t++] = s;
        } else if (s <= 2047) {
          if (t + 1 >= a) break;
          r[t++] = 192 | s >> 6, r[t++] = 128 | s & 63;
        } else if (s <= 65535) {
          if (t + 2 >= a) break;
          r[t++] = 224 | s >> 12, r[t++] = 128 | s >> 6 & 63, r[t++] = 128 | s & 63;
        } else {
          if (t + 3 >= a) break;
          r[t++] = 240 | s >> 18, r[t++] = 128 | s >> 12 & 63, r[t++] = 128 | s >> 6 & 63, r[t++] = 128 | s & 63;
        }
      }
      return r[t] = 0, t - i;
    }, ar = (e, r, t) => sn(e, P, r, t), on = (e) => {
      for (var r = 0, t = 0; t < e.length; ++t) {
        var n = e.charCodeAt(t);
        n <= 127 ? r++ : n <= 2047 ? r += 2 : n >= 55296 && n <= 57343 ? (r += 4, ++t) : r += 3;
      }
      return r;
    }, be = typeof TextDecoder < "u" ? new TextDecoder() : void 0, we = (e, r, t) => {
      for (var n = r + t, i = r; e[i] && !(i >= n); ) ++i;
      if (i - r > 16 && e.buffer && be)
        return be.decode(e.subarray(r, i));
      for (var a = ""; r < i; ) {
        var o = e[r++];
        if (!(o & 128)) {
          a += String.fromCharCode(o);
          continue;
        }
        var s = e[r++] & 63;
        if ((o & 224) == 192) {
          a += String.fromCharCode((o & 31) << 6 | s);
          continue;
        }
        var u = e[r++] & 63;
        if ((o & 240) == 224 ? o = (o & 15) << 12 | s << 6 | u : o = (o & 7) << 18 | s << 12 | u << 6 | e[r++] & 63, o < 65536)
          a += String.fromCharCode(o);
        else {
          var f = o - 65536;
          a += String.fromCharCode(55296 | f >> 10, 56320 | f & 1023);
        }
      }
      return a;
    }, un = (e, r) => e ? we(P, e, r) : "", ln = (e, r) => {
      r = C(r);
      var t = r === "std::string";
      k(e, {
        name: r,
        fromWireType(n) {
          var i = _[n >> 2], a = n + 4, o;
          if (t)
            for (var s = a, u = 0; u <= i; ++u) {
              var f = a + u;
              if (u == i || P[f] == 0) {
                var c = f - s, v = un(s, c);
                o === void 0 ? o = v : (o += "\0", o += v), s = f + 1;
              }
            }
          else {
            for (var d = new Array(i), u = 0; u < i; ++u)
              d[u] = String.fromCharCode(P[a + u]);
            o = d.join("");
          }
          return x(n), o;
        },
        toWireType(n, i) {
          i instanceof ArrayBuffer && (i = new Uint8Array(i));
          var a, o = typeof i == "string";
          o || i instanceof Uint8Array || i instanceof Uint8ClampedArray || i instanceof Int8Array || h("Cannot pass non-string to std::string"), t && o ? a = on(i) : a = i.length;
          var s = Zr(4 + a + 1), u = s + 4;
          if (_[s >> 2] = a, t && o)
            ar(i, u, a + 1);
          else if (o)
            for (var f = 0; f < a; ++f) {
              var c = i.charCodeAt(f);
              c > 255 && (x(u), h("String has UTF-16 code units that do not fit in 8 bits")), P[u + f] = c;
            }
          else
            for (var f = 0; f < a; ++f)
              P[u + f] = i[f];
          return n !== null && n.push(x, s), s;
        },
        argPackAdvance: O,
        readValueFromPointer: J,
        destructorFunction(n) {
          x(n);
        }
      });
    }, Te = typeof TextDecoder < "u" ? new TextDecoder("utf-16le") : void 0, fn = (e, r) => {
      for (var t = e, n = t >> 1, i = n + r / 2; !(n >= i) && K[n]; ) ++n;
      if (t = n << 1, t - e > 32 && Te) return Te.decode(P.subarray(e, t));
      for (var a = "", o = 0; !(o >= r / 2); ++o) {
        var s = X[e + o * 2 >> 1];
        if (s == 0) break;
        a += String.fromCharCode(s);
      }
      return a;
    }, cn = (e, r, t) => {
      var n;
      if ((n = t) !== null && n !== void 0 || (t = 2147483647), t < 2) return 0;
      t -= 2;
      for (var i = r, a = t < e.length * 2 ? t / 2 : e.length, o = 0; o < a; ++o) {
        var s = e.charCodeAt(o);
        X[r >> 1] = s, r += 2;
      }
      return X[r >> 1] = 0, r - i;
    }, vn = (e) => e.length * 2, dn = (e, r) => {
      for (var t = 0, n = ""; !(t >= r / 4); ) {
        var i = H[e + t * 4 >> 2];
        if (i == 0) break;
        if (++t, i >= 65536) {
          var a = i - 65536;
          n += String.fromCharCode(55296 | a >> 10, 56320 | a & 1023);
        } else
          n += String.fromCharCode(i);
      }
      return n;
    }, pn = (e, r, t) => {
      var n;
      if ((n = t) !== null && n !== void 0 || (t = 2147483647), t < 4) return 0;
      for (var i = r, a = i + t - 4, o = 0; o < e.length; ++o) {
        var s = e.charCodeAt(o);
        if (s >= 55296 && s <= 57343) {
          var u = e.charCodeAt(++o);
          s = 65536 + ((s & 1023) << 10) | u & 1023;
        }
        if (H[r >> 2] = s, r += 4, r + 4 > a) break;
      }
      return H[r >> 2] = 0, r - i;
    }, hn = (e) => {
      for (var r = 0, t = 0; t < e.length; ++t) {
        var n = e.charCodeAt(t);
        n >= 55296 && n <= 57343 && ++t, r += 4;
      }
      return r;
    }, _n = (e, r, t) => {
      t = C(t);
      var n, i, a, o;
      r === 2 ? (n = fn, i = cn, o = vn, a = (s) => K[s >> 1]) : r === 4 && (n = dn, i = pn, o = hn, a = (s) => _[s >> 2]), k(e, {
        name: t,
        fromWireType: (s) => {
          for (var u = _[s >> 2], f, c = s + 4, v = 0; v <= u; ++v) {
            var d = s + 4 + v * r;
            if (v == u || a(d) == 0) {
              var p = d - c, T = n(c, p);
              f === void 0 ? f = T : (f += "\0", f += T), c = d + r;
            }
          }
          return x(s), f;
        },
        toWireType: (s, u) => {
          typeof u != "string" && h(`Cannot pass non-string to C++ string type ${t}`);
          var f = o(u), c = Zr(4 + f + r);
          return _[c >> 2] = f / r, i(u, c + 4, f + r), s !== null && s.push(x, c), c;
        },
        argPackAdvance: O,
        readValueFromPointer: J,
        destructorFunction(s) {
          x(s);
        }
      });
    }, gn = (e, r, t, n, i, a) => {
      pr[e] = {
        name: C(r),
        rawConstructor: R(t, n),
        rawDestructor: R(i, a),
        fields: []
      };
    }, yn = (e, r, t, n, i, a, o, s, u, f) => {
      pr[e].fields.push({
        fieldName: C(r),
        getterReturnType: t,
        getter: R(n, i),
        getterContext: a,
        setterArgumentType: o,
        setter: R(s, u),
        setterContext: f
      });
    }, mn = (e, r) => {
      r = C(r), k(e, {
        isVoid: !0,
        name: r,
        argPackAdvance: 0,
        fromWireType: () => {
        },
        toWireType: (t, n) => {
        }
      });
    }, $n = (e, r, t) => P.copyWithin(e, r, r + t), zr = [], bn = (e, r, t, n) => (e = zr[e], r = I.toValue(r), e(null, r, t, n)), wn = {}, Tn = (e) => {
      var r = wn[e];
      return r === void 0 ? C(e) : r;
    }, Ce = () => {
      if (typeof globalThis == "object")
        return globalThis;
      function e(r) {
        r.$$$embind_global$$$ = r;
        var t = typeof $$$embind_global$$$ == "object" && r.$$$embind_global$$$ == r;
        return t || delete r.$$$embind_global$$$, t;
      }
      if (typeof $$$embind_global$$$ == "object" || (typeof global == "object" && e(global) ? $$$embind_global$$$ = global : typeof self == "object" && e(self) && ($$$embind_global$$$ = self), typeof $$$embind_global$$$ == "object"))
        return $$$embind_global$$$;
      throw Error("unable to get global object.");
    }, Cn = (e) => e === 0 ? I.toHandle(Ce()) : (e = Tn(e), I.toHandle(Ce()[e])), Pn = (e) => {
      var r = zr.length;
      return zr.push(e), r;
    }, An = (e, r) => {
      for (var t = new Array(e), n = 0; n < e; ++n)
        t[n] = Br(_[r + n * 4 >> 2], "parameter " + n);
      return t;
    }, Fn = Reflect.construct, En = (e, r, t) => {
      var n = [], i = e.toWireType(n, t);
      return n.length && (_[r >> 2] = I.toHandle(n)), i;
    }, Rn = (e, r, t) => {
      var n = An(e, r), i = n.shift();
      e--;
      var a = new Array(e), o = (u, f, c, v) => {
        for (var d = 0, p = 0; p < e; ++p)
          a[p] = n[p].readValueFromPointer(v + d), d += n[p].argPackAdvance;
        var T = t === 1 ? Fn(f, a) : f.apply(u, a);
        return En(i, c, T);
      }, s = `methodCaller<(${n.map((u) => u.name).join(", ")}) => ${i.name}>`;
      return Pn(ir(s, o));
    }, Sn = (e) => {
      e > 9 && (U[e + 1] += 1);
    }, jn = (e) => {
      var r = I.toValue(e);
      Wr(r), Vr(e);
    }, Wn = (e, r) => {
      e = Br(e, "_emval_take_value");
      var t = e.readValueFromPointer(r);
      return I.toHandle(t);
    }, kn = (e, r, t, n) => {
      var i = (/* @__PURE__ */ new Date()).getFullYear(), a = new Date(i, 0, 1), o = new Date(i, 6, 1), s = a.getTimezoneOffset(), u = o.getTimezoneOffset(), f = Math.max(s, u);
      _[e >> 2] = f * 60, H[r >> 2] = +(s != u);
      var c = (p) => {
        var T = p >= 0 ? "-" : "+", A = Math.abs(p), $ = String(Math.floor(A / 60)).padStart(2, "0"), F = String(A % 60).padStart(2, "0");
        return `UTC${T}${$}${F}`;
      }, v = c(s), d = c(u);
      u < s ? (ar(v, t, 17), ar(d, n, 17)) : (ar(v, n, 17), ar(d, t, 17));
    }, On = () => 2147483648, Dn = (e) => {
      var r = lr.buffer, t = (e - r.byteLength + 65535) / 65536;
      try {
        return lr.grow(t), ee(), 1;
      } catch {
      }
    }, Un = (e) => {
      var r = P.length;
      e >>>= 0;
      var t = On();
      if (e > t)
        return !1;
      for (var n = (u, f) => u + (f - u % f) % f, i = 1; i <= 4; i *= 2) {
        var a = r * (1 + 0.2 / i);
        a = Math.min(a, e + 100663296);
        var o = Math.min(t, n(Math.max(e, a), 65536)), s = Dn(o);
        if (s)
          return !0;
      }
      return !1;
    }, Lr = {}, In = () => Yr || "./this.program", sr = () => {
      if (!sr.strings) {
        var e = (typeof navigator == "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8", r = {
          USER: "web_user",
          LOGNAME: "web_user",
          PATH: "/",
          PWD: "/",
          HOME: "/home/web_user",
          LANG: e,
          _: In()
        };
        for (var t in Lr)
          Lr[t] === void 0 ? delete r[t] : r[t] = Lr[t];
        var n = [];
        for (var t in r)
          n.push(`${t}=${r[t]}`);
        sr.strings = n;
      }
      return sr.strings;
    }, xn = (e, r) => {
      for (var t = 0; t < e.length; ++t)
        W[r++] = e.charCodeAt(t);
      W[r] = 0;
    }, Mn = (e, r) => {
      var t = 0;
      return sr().forEach((n, i) => {
        var a = r + t;
        _[e + i * 4 >> 2] = a, xn(n, a), t += n.length + 1;
      }), 0;
    }, Hn = (e, r) => {
      var t = sr();
      _[e >> 2] = t.length;
      var n = 0;
      return t.forEach((i) => n += i.length + 1), _[r >> 2] = n, 0;
    }, Vn = (e) => 52;
    function Bn(e, r, t, n, i) {
      return 70;
    }
    var Nn = [null, [], []], zn = (e, r) => {
      var t = Nn[e];
      r === 0 || r === 10 ? ((e === 1 ? ze : Z)(we(t, 0)), t.length = 0) : t.push(r);
    }, Ln = (e, r, t, n) => {
      for (var i = 0, a = 0; a < t; a++) {
        var o = _[r >> 2], s = _[r + 4 >> 2];
        r += 8;
        for (var u = 0; u < s; u++)
          zn(e, P[o + u]);
        i += s;
      }
      return _[n >> 2] = i, 0;
    }, Zn = (e) => e;
    ue = l.InternalError = class extends Error {
      constructor(r) {
        super(r), this.name = "InternalError";
      }
    }, gt(), q = l.BindingError = class extends Error {
      constructor(r) {
        super(r), this.name = "BindingError";
      }
    }, Rt(), Pt(), It(), ge = l.UnboundTypeError = Vt(Error, "UnboundTypeError"), Xt();
    var Xn = {
      s: at,
      v: st,
      b: ut,
      g: lt,
      q: ft,
      Y: ct,
      f: vt,
      X: dt,
      e: ot,
      T: pt,
      ha: ht,
      S: _t,
      ba: mt,
      fa: Bt,
      ea: zt,
      w: Lt,
      aa: $e,
      x: Yt,
      h: Kt,
      M: Jt,
      N: rn,
      t: tn,
      o: nn,
      ga: an,
      L: ln,
      C: _n,
      B: gn,
      ia: yn,
      ca: mn,
      $: $n,
      E: bn,
      ka: Vr,
      la: Cn,
      K: Rn,
      O: Sn,
      P: jn,
      da: Wn,
      U: kn,
      Z: Un,
      V: Mn,
      W: Hn,
      _: Vn,
      R: Bn,
      J: Ln,
      F: li,
      D: Qn,
      G: ui,
      n: fi,
      a: Gn,
      d: ri,
      p: Kn,
      j: oi,
      I: ai,
      u: ii,
      H: si,
      z: vi,
      Q: pi,
      l: ei,
      k: Jn,
      c: Yn,
      m: qn,
      A: ni,
      r: ci,
      i: ti,
      y: di,
      ja: Zn
    }, m = it(), Pe = (e) => (Pe = m.oa)(e), x = l._free = (e) => (x = l._free = m.pa)(e), Zr = l._malloc = (e) => (Zr = l._malloc = m.ra)(e), g = (e, r) => (g = m.sa)(e, r), Ae = (e) => (Ae = m.ta)(e), Fe = (e) => (Fe = m.ua)(e), Ee = () => (Ee = m.va)(), Re = (e) => (Re = m.wa)(e), Se = (e) => (Se = m.xa)(e), je = (e, r, t) => (je = m.ya)(e, r, t), We = (e) => (We = m.za)(e);
    l.dynCall_viijii = (e, r, t, n, i, a, o) => (l.dynCall_viijii = m.Aa)(e, r, t, n, i, a, o), l.dynCall_jiji = (e, r, t, n, i) => (l.dynCall_jiji = m.Ba)(e, r, t, n, i);
    var ke = l.dynCall_jiiii = (e, r, t, n, i) => (ke = l.dynCall_jiiii = m.Ca)(e, r, t, n, i);
    l.dynCall_iiiiij = (e, r, t, n, i, a, o) => (l.dynCall_iiiiij = m.Da)(e, r, t, n, i, a, o), l.dynCall_iiiiijj = (e, r, t, n, i, a, o, s, u) => (l.dynCall_iiiiijj = m.Ea)(e, r, t, n, i, a, o, s, u), l.dynCall_iiiiiijj = (e, r, t, n, i, a, o, s, u, f) => (l.dynCall_iiiiiijj = m.Fa)(e, r, t, n, i, a, o, s, u, f);
    function Gn(e, r) {
      var t = w();
      try {
        return y(e)(r);
      } catch (n) {
        if (b(t), n !== n + 0) throw n;
        g(1, 0);
      }
    }
    function qn(e, r, t, n) {
      var i = w();
      try {
        y(e)(r, t, n);
      } catch (a) {
        if (b(i), a !== a + 0) throw a;
        g(1, 0);
      }
    }
    function Yn(e, r, t) {
      var n = w();
      try {
        y(e)(r, t);
      } catch (i) {
        if (b(n), i !== i + 0) throw i;
        g(1, 0);
      }
    }
    function Kn(e, r, t, n) {
      var i = w();
      try {
        return y(e)(r, t, n);
      } catch (a) {
        if (b(i), a !== a + 0) throw a;
        g(1, 0);
      }
    }
    function Qn(e, r, t, n, i) {
      var a = w();
      try {
        return y(e)(r, t, n, i);
      } catch (o) {
        if (b(a), o !== o + 0) throw o;
        g(1, 0);
      }
    }
    function Jn(e, r) {
      var t = w();
      try {
        y(e)(r);
      } catch (n) {
        if (b(t), n !== n + 0) throw n;
        g(1, 0);
      }
    }
    function ri(e, r, t) {
      var n = w();
      try {
        return y(e)(r, t);
      } catch (i) {
        if (b(n), i !== i + 0) throw i;
        g(1, 0);
      }
    }
    function ei(e) {
      var r = w();
      try {
        y(e)();
      } catch (t) {
        if (b(r), t !== t + 0) throw t;
        g(1, 0);
      }
    }
    function ti(e, r, t, n, i, a, o, s, u, f, c) {
      var v = w();
      try {
        y(e)(r, t, n, i, a, o, s, u, f, c);
      } catch (d) {
        if (b(v), d !== d + 0) throw d;
        g(1, 0);
      }
    }
    function ni(e, r, t, n, i) {
      var a = w();
      try {
        y(e)(r, t, n, i);
      } catch (o) {
        if (b(a), o !== o + 0) throw o;
        g(1, 0);
      }
    }
    function ii(e, r, t, n, i, a, o) {
      var s = w();
      try {
        return y(e)(r, t, n, i, a, o);
      } catch (u) {
        if (b(s), u !== u + 0) throw u;
        g(1, 0);
      }
    }
    function ai(e, r, t, n, i, a) {
      var o = w();
      try {
        return y(e)(r, t, n, i, a);
      } catch (s) {
        if (b(o), s !== s + 0) throw s;
        g(1, 0);
      }
    }
    function si(e, r, t, n, i, a, o, s) {
      var u = w();
      try {
        return y(e)(r, t, n, i, a, o, s);
      } catch (f) {
        if (b(u), f !== f + 0) throw f;
        g(1, 0);
      }
    }
    function oi(e, r, t, n, i) {
      var a = w();
      try {
        return y(e)(r, t, n, i);
      } catch (o) {
        if (b(a), o !== o + 0) throw o;
        g(1, 0);
      }
    }
    function ui(e, r, t, n) {
      var i = w();
      try {
        return y(e)(r, t, n);
      } catch (a) {
        if (b(i), a !== a + 0) throw a;
        g(1, 0);
      }
    }
    function li(e, r, t, n) {
      var i = w();
      try {
        return y(e)(r, t, n);
      } catch (a) {
        if (b(i), a !== a + 0) throw a;
        g(1, 0);
      }
    }
    function fi(e) {
      var r = w();
      try {
        return y(e)();
      } catch (t) {
        if (b(r), t !== t + 0) throw t;
        g(1, 0);
      }
    }
    function ci(e, r, t, n, i, a, o, s) {
      var u = w();
      try {
        y(e)(r, t, n, i, a, o, s);
      } catch (f) {
        if (b(u), f !== f + 0) throw f;
        g(1, 0);
      }
    }
    function vi(e, r, t, n, i, a, o, s, u, f, c, v) {
      var d = w();
      try {
        return y(e)(r, t, n, i, a, o, s, u, f, c, v);
      } catch (p) {
        if (b(d), p !== p + 0) throw p;
        g(1, 0);
      }
    }
    function di(e, r, t, n, i, a, o, s, u, f, c, v, d, p, T, A) {
      var $ = w();
      try {
        y(e)(r, t, n, i, a, o, s, u, f, c, v, d, p, T, A);
      } catch (F) {
        if (b($), F !== F + 0) throw F;
        g(1, 0);
      }
    }
    function pi(e, r, t, n, i) {
      var a = w();
      try {
        return ke(e, r, t, n, i);
      } catch (o) {
        if (b(a), o !== o + 0) throw o;
        g(1, 0);
      }
    }
    var wr;
    Q = function e() {
      wr || Oe(), wr || (Q = e);
    };
    function Oe() {
      if (V > 0 || (Le(), V > 0))
        return;
      function e() {
        var r;
        wr || (wr = !0, l.calledRun = !0, !Qr && (Ze(), Gr(l), (r = l.onRuntimeInitialized) === null || r === void 0 || r.call(l), Xe()));
      }
      l.setStatus ? (l.setStatus("Running..."), setTimeout(function() {
        setTimeout(function() {
          l.setStatus("");
        }, 1), e();
      }, 1)) : e();
    }
    if (l.preInit)
      for (typeof l.preInit == "function" && (l.preInit = [l.preInit]); l.preInit.length > 0; )
        l.preInit.pop()();
    return Oe(), Xr = He, Xr;
  };
})();
function Ti(S) {
  return _i(
    Pr,
    S
  );
}
function Ci(S) {
  return gi(
    Pr,
    S
  );
}
async function Pi(S, L) {
  return yi(
    Pr,
    S,
    L
  );
}
async function Ai(S, L) {
  return mi(
    Pr,
    S,
    L
  );
}
export {
  Ri as barcodeFormats,
  Si as binarizers,
  ji as characterSets,
  Wi as contentTypes,
  ki as defaultDecodeHints,
  Oi as defaultReaderOptions,
  Di as eanAddOnSymbols,
  Ti as getZXingModule,
  Ui as purgeZXingModule,
  Ai as readBarcodesFromImageData,
  Pi as readBarcodesFromImageFile,
  Ii as readOutputEccLevels,
  Ci as setZXingModuleOverrides,
  xi as textModes
};
