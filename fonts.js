/* ============================================================
   ViperEdit — Font catalog
   Each font has: name, family (CSS value), gf (Google Fonts
   query fragment, omitted for system fonts).
   ============================================================ */

window.VE_FONTS = {
  system: [
    { name: 'System UI',       family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
    { name: 'Arial',           family: 'Arial, sans-serif' },
    { name: 'Helvetica',       family: 'Helvetica, Arial, sans-serif' },
    { name: 'Georgia',         family: 'Georgia, serif' },
    { name: 'Times New Roman', family: '"Times New Roman", Times, serif' },
    { name: 'Courier New',     family: '"Courier New", Courier, monospace' },
    { name: 'Verdana',         family: 'Verdana, sans-serif' },
    { name: 'Tahoma',          family: 'Tahoma, sans-serif' },
    { name: 'Palatino',        family: '"Palatino Linotype", Palatino, serif' }
  ],

  sans: [
    { name: 'Inter',          family: '"Inter", sans-serif',          gf: 'Inter:wght@300;400;500;600;700;800' },
    { name: 'Roboto',         family: '"Roboto", sans-serif',         gf: 'Roboto:wght@300;400;500;700' },
    { name: 'Open Sans',      family: '"Open Sans", sans-serif',      gf: 'Open+Sans:wght@400;500;600;700' },
    { name: 'Lato',           family: '"Lato", sans-serif',           gf: 'Lato:wght@300;400;700' },
    { name: 'Montserrat',     family: '"Montserrat", sans-serif',     gf: 'Montserrat:wght@300;400;500;600;700' },
    { name: 'Poppins',        family: '"Poppins", sans-serif',        gf: 'Poppins:wght@300;400;500;600;700' },
    { name: 'Nunito',         family: '"Nunito", sans-serif',         gf: 'Nunito:wght@300;400;600;700' },
    { name: 'Work Sans',      family: '"Work Sans", sans-serif',      gf: 'Work+Sans:wght@300;400;500;600;700' },
    { name: 'DM Sans',        family: '"DM Sans", sans-serif',        gf: 'DM+Sans:wght@400;500;700' },
    { name: 'Manrope',        family: '"Manrope", sans-serif',        gf: 'Manrope:wght@300;400;500;600;700' },
    { name: 'Raleway',        family: '"Raleway", sans-serif',        gf: 'Raleway:wght@300;400;500;600;700' },
    { name: 'Source Sans 3',  family: '"Source Sans 3", sans-serif',  gf: 'Source+Sans+3:wght@300;400;600;700' },
    { name: 'Rubik',          family: '"Rubik", sans-serif',          gf: 'Rubik:wght@300;400;500;600;700' },
    { name: 'Karla',          family: '"Karla", sans-serif',          gf: 'Karla:wght@400;500;600;700' },
    { name: 'Quicksand',      family: '"Quicksand", sans-serif',      gf: 'Quicksand:wght@400;500;600;700' }
  ],

  serif: [
    { name: 'Merriweather',       family: '"Merriweather", serif',       gf: 'Merriweather:wght@300;400;700' },
    { name: 'Lora',               family: '"Lora", serif',               gf: 'Lora:wght@400;500;600;700' },
    { name: 'Playfair Display',   family: '"Playfair Display", serif',   gf: 'Playfair+Display:wght@400;600;700;800' },
    { name: 'EB Garamond',        family: '"EB Garamond", serif',        gf: 'EB+Garamond:wght@400;500;600;700' },
    { name: 'Crimson Pro',        family: '"Crimson Pro", serif',        gf: 'Crimson+Pro:wght@400;500;600;700' },
    { name: 'PT Serif',           family: '"PT Serif", serif',           gf: 'PT+Serif:wght@400;700' },
    { name: 'Bitter',             family: '"Bitter", serif',             gf: 'Bitter:wght@300;400;500;700' },
    { name: 'Libre Baskerville',  family: '"Libre Baskerville", serif',  gf: 'Libre+Baskerville:wght@400;700' },
    { name: 'Cormorant Garamond', family: '"Cormorant Garamond", serif', gf: 'Cormorant+Garamond:wght@400;500;600;700' },
    { name: 'Spectral',           family: '"Spectral", serif',           gf: 'Spectral:wght@300;400;500;600;700' },
    { name: 'Source Serif 4',     family: '"Source Serif 4", serif',     gf: 'Source+Serif+4:wght@400;600;700' }
  ],

  display: [
    { name: 'Bebas Neue',      family: '"Bebas Neue", sans-serif',      gf: 'Bebas+Neue' },
    { name: 'Oswald',          family: '"Oswald", sans-serif',          gf: 'Oswald:wght@300;400;500;600;700' },
    { name: 'Abril Fatface',   family: '"Abril Fatface", serif',        gf: 'Abril+Fatface' },
    { name: 'Fjalla One',      family: '"Fjalla One", sans-serif',      gf: 'Fjalla+One' },
    { name: 'Archivo Black',   family: '"Archivo Black", sans-serif',   gf: 'Archivo+Black' },
    { name: 'Anton',           family: '"Anton", sans-serif',           gf: 'Anton' },
    { name: 'Righteous',       family: '"Righteous", cursive',          gf: 'Righteous' }
  ],

  mono: [
    { name: 'JetBrains Mono',  family: '"JetBrains Mono", monospace',   gf: 'JetBrains+Mono:wght@400;500;600;700' },
    { name: 'Fira Code',       family: '"Fira Code", monospace',        gf: 'Fira+Code:wght@400;500;600' },
    { name: 'IBM Plex Mono',   family: '"IBM Plex Mono", monospace',    gf: 'IBM+Plex+Mono:wght@400;500;600' },
    { name: 'Source Code Pro', family: '"Source Code Pro", monospace',  gf: 'Source+Code+Pro:wght@400;500;600;700' },
    { name: 'Space Mono',      family: '"Space Mono", monospace',       gf: 'Space+Mono:wght@400;700' },
    { name: 'Roboto Mono',     family: '"Roboto Mono", monospace',      gf: 'Roboto+Mono:wght@400;500;700' }
  ],

  handwriting: [
    { name: 'Caveat',          family: '"Caveat", cursive',             gf: 'Caveat:wght@400;500;600;700' },
    { name: 'Dancing Script',  family: '"Dancing Script", cursive',     gf: 'Dancing+Script:wght@400;500;600;700' },
    { name: 'Pacifico',        family: '"Pacifico", cursive',           gf: 'Pacifico' },
    { name: 'Satisfy',         family: '"Satisfy", cursive',            gf: 'Satisfy' },
    { name: 'Kalam',           family: '"Kalam", cursive',              gf: 'Kalam:wght@400;700' },
    { name: 'Shadows Into Light', family: '"Shadows Into Light", cursive', gf: 'Shadows+Into+Light' },
    { name: 'Indie Flower',    family: '"Indie Flower", cursive',       gf: 'Indie+Flower' },
    { name: 'Permanent Marker', family: '"Permanent Marker", cursive',  gf: 'Permanent+Marker' }
  ]
};

/* Build a single Google Fonts <link> URL for all web fonts at once. */
window.VE_buildFontsURL = function () {
  const parts = [];
  const cats = ['sans', 'serif', 'display', 'mono', 'handwriting'];
  for (const cat of cats) {
    for (const f of window.VE_FONTS[cat]) {
      if (f.gf) parts.push('family=' + f.gf);
    }
  }
  parts.push('display=swap');
  return 'https://fonts.googleapis.com/css2?' + parts.join('&');
};

/* Flat list useful for dropdowns and the palette. */
window.VE_allFonts = function () {
  const out = [];
  for (const group of ['sans', 'serif', 'display', 'mono', 'handwriting', 'system']) {
    for (const f of window.VE_FONTS[group]) out.push({ ...f, group });
  }
  return out;
};
