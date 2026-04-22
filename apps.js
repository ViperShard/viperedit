/* ============================================================
   ViperShard — app registry
   Add new apps here as you ship them. The app launcher in the
   ViperEdit chrome will pick them up automatically.

   Each entry:
     id       — unique slug
     name     — display name
     desc     — short subtitle
     icon     — single character / emoji shown in the card
     accent   — CSS color for the icon tile
     url      — href; null means "this app, current" (not clickable)
     current  — true for the app we're currently inside
     comingSoon — true → disabled card
   ============================================================ */

window.VIPERSHARD_APPS = [
  {
    id: 'viperedit',
    name: 'ViperEdit',
    desc: 'Document editor',
    icon: '✎',
    accent: '#6d28d9',
    url: null,
    current: true
  }

  // Example future entries — uncomment / replace when the apps exist:
  //
  // { id: 'vipersheet', name: 'ViperSheet', desc: 'Spreadsheets',
  //   icon: '▦', accent: '#0891b2', url: 'https://your-domain/vipersheet/' },
  //
  // { id: 'viperslide', name: 'ViperSlide', desc: 'Presentations',
  //   icon: '▭', accent: '#dc2626', url: 'https://your-domain/viperslide/' },
  //
  // { id: 'viperdraw',  name: 'ViperDraw',  desc: 'Vector diagrams',
  //   icon: '✦', accent: '#059669', url: null, comingSoon: true }
];
