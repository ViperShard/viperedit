/* ============================================================
   ViperEdit — configuration
   ============================================================

   Paste your Google OAuth 2.0 Web Client ID below to enable
   "Sign in with Google". Leave blank to run the app in local
   guest mode (all data stays in this browser's IndexedDB).

   HOW TO GET A CLIENT ID (free, ~5 min):
     1. https://console.cloud.google.com/apis/credentials
     2. Pick or create a project.
     3. "Create Credentials" → "OAuth 2.0 Client ID" → Web Application.
     4. Under "Authorized JavaScript origins" add:
          - Your hosted URL (e.g. https://you.github.io)
          - http://localhost:8000  (for local testing)
     5. Copy the Client ID and paste it below.

   NOTE: Google Sign-in requires an https:// origin (or localhost).
   The rest of ViperEdit works over file:// with no network at all.
   ============================================================ */

window.VE_CONFIG = {
  googleClientId: ''   // e.g. '1234567890-abcxyz.apps.googleusercontent.com'
};
