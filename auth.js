/* ============================================================
   ViperEdit — Google Sign-in (Google Identity Services)
   Exposes window.VE_Auth with:
     user        — { sub, name, email, picture } when signed in, else null
     namespace() — 'u_<sub>' when signed in, 'guest' otherwise
     init()      — loads the GIS script and restores saved session
     renderButton(el)  — draws the official Google button into an element
     signOut()
     onChange(fn)      — register a listener for user-change events
   ============================================================ */

(function () {
  'use strict';

  const USER_KEY = 'viperedit:user:v1';

  const Auth = window.VE_Auth = {
    user: null,
    ready: false,
    _listeners: [],

    namespace() { return this.user ? 'u_' + this.user.sub : 'guest'; },

    onChange(fn) { this._listeners.push(fn); },
    _emit() {
      for (const fn of this._listeners) {
        try { fn(this.user); } catch (e) { console.warn(e); }
      }
    },

    init() {
      // 1. Restore any saved session first (so we render signed-in UI immediately).
      try {
        const raw = localStorage.getItem(USER_KEY);
        if (raw) this.user = JSON.parse(raw);
      } catch { /* ignore */ }

      // 2. If a Client ID is configured, load Google Identity Services.
      const cid = (window.VE_CONFIG && window.VE_CONFIG.googleClientId) || '';
      if (!cid) {
        this.ready = true;
        return;
      }

      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => this._bootGIS(cid);
      s.onerror = () => { console.warn('Google Identity Services failed to load.'); this.ready = true; };
      document.head.appendChild(s);
    },

    _bootGIS(cid) {
      if (!window.google || !google.accounts || !google.accounts.id) return;
      try {
        google.accounts.id.initialize({
          client_id: cid,
          callback: (r) => this._onCredential(r),
          auto_select: true,
          cancel_on_tap_outside: false
        });
      } catch (e) {
        console.warn('GIS init failed', e);
      }
      this.ready = true;
      this._emit();   // re-render any UI that was waiting for ready state

      // Offer one-tap login only if the user isn't already signed in.
      if (!this.user) {
        try { google.accounts.id.prompt(); } catch {}
      }
    },

    renderButton(container) {
      if (!container) return;
      container.innerHTML = '';
      if (!(window.google && google.accounts && google.accounts.id)) {
        const cid = (window.VE_CONFIG && window.VE_CONFIG.googleClientId) || '';
        container.innerHTML = cid
          ? '<div class="auth-hint">Loading Google Sign-in…</div>'
          : '<div class="auth-hint">Sign-in unavailable — a Google Client ID has not been set up for this install. See config.js.</div>';
        return;
      }
      try {
        google.accounts.id.renderButton(container, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          shape: 'pill',
          text: 'signin_with',
          logo_alignment: 'left'
        });
      } catch (e) { console.warn('renderButton failed', e); }
    },

    _onCredential(response) {
      const jwt = response && response.credential;
      if (!jwt) return;
      const p = parseJWT(jwt);
      if (!p || !p.sub) return;

      this.user = {
        sub:     p.sub,
        name:    p.name || '',
        email:   p.email || '',
        picture: p.picture || ''
      };
      try { localStorage.setItem(USER_KEY, JSON.stringify(this.user)); } catch {}

      // Ask the browser to keep our storage around even under pressure.
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }
      this._emit();
    },

    signOut() {
      try {
        if (window.google && google.accounts && google.accounts.id) {
          google.accounts.id.disableAutoSelect();
        }
      } catch {}
      this.user = null;
      try { localStorage.removeItem(USER_KEY); } catch {}
      this._emit();
    }
  };

  function parseJWT(token) {
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(part).split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join(''));
      return JSON.parse(json);
    } catch { return null; }
  }
})();
